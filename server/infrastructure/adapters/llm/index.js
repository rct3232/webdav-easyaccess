'use strict';

/**
 * llmAdapter core — the single gateway to every LLM provider
 * (docs/spec/server/infrastructure/llmAdapter.md §2.2, §2.3, §2.5, §2.9).
 *
 * Per-call config interpretation (T2 dbOnly keys via the configResolver —
 * hot, no restart), signature-keyed client cache with hot re-probe, role
 * clients, the budget chain + breaker (budget.js), usage accounting into
 * `ai_usage_daily` and the model-registry sync.
 *
 * Seams (injected, defaulting to the real modules):
 *   - `createClient`  — dialect client factory (remote dialects land with the
 *     preset manifest, T1.1a; the default here serves the built-in embedded
 *     engine only).
 *   - `probeRole`     — the probe suite hook (T1.1a); the adapter owns the
 *     debounced re-probe TRIGGER, the suite itself is the probe owner's.
 *   - `provisioner`   — the T1.0a provision module (in-place run on an
 *     override clear).
 *   - `presetFor`     — preset-manifest row seam (T1.1a) for budgets/profile.
 *
 * No module-level singletons: `createLlmAdapter(deps)` is constructed once by
 * the boot wiring and handed to its consumers.
 */

const crypto = require('crypto');

const { classifyLlmError, createBreaker, createLimiter, resolveBudget } = require('./budget');

const ROLES = ['embed', 'chat', 'vision', 'asr'];

const ROLE_KEYS = {
  embed: ['LLM_EMBED_BASE_URL', 'LLM_EMBED_API_KEY', 'LLM_EMBED_MODEL'],
  chat: ['LLM_CHAT_BASE_URL', 'LLM_CHAT_API_KEY', 'LLM_CHAT_MODEL'],
  vision: ['LLM_VISION_BASE_URL', 'LLM_VISION_API_KEY', 'LLM_VISION_MODEL'],
  asr: ['LLM_ASR_BASE_URL', 'LLM_ASR_API_KEY', 'LLM_ASR_MODEL'],
};

// §2.6 char→token safety factor (release constant shipped in the profile; the
// registry has no per-role token ledger — the daily TOKEN cap estimates
// tokens from the recorded input_chars through this factor).
const DEFAULT_CHARS_PER_TOKEN = 1.7;

function isSet(value) {
  return value !== undefined && value !== null && value !== '';
}

/** Server-local `YYYY-MM-DD` of the call (aiUsageDailyStore §1 day format). */
function dayString(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function classifiedError(errorClass, reason, message) {
  const err = new Error(message);
  err.class = errorClass;
  err.reason = reason;
  return err;
}

/**
 * The default dialect factory: the built-in embedded engine only. Remote
 * dialect clients land with the preset manifest (T1.1a) — until then a
 * remote resolution here is a config-class failure, never a silent fallthrough.
 */
function defaultCreateClient(spec) {
  if (spec.engine === 'embedded') {
    // Lazy requires: no engine/network work at factory-construction time.
    // eslint-disable-next-line global-require
    const onnx = require('./clients/embedded-onnx');
    // eslint-disable-next-line global-require
    const provisioner = require('./provision');
    const lock = provisioner.loadLock();
    const modelDir = provisioner.resolveModelDir();
    return {
      spec,
      async embed(texts, opts = {}) {
        const vectors = await onnx.embedDocuments(texts, {
          modelDir,
          lock,
          batchSize: opts.batchSize,
        });
        return { vectors, dim: vectors[0] ? vectors[0].length : lock.dim };
      },
      async embedQuery(text) {
        const vector = await onnx.embedQuery(text, { modelDir, lock });
        return { vectors: [vector], dim: vector.length };
      },
    };
  }
  throw classifiedError(
    'config',
    'no_client_dialect',
    `no client dialect for engine '${spec.engine}' (remote dialects land with the preset manifest, T1.1a)`
  );
}

/**
 * @param {object} deps
 * @param {{getConfig: Function}} deps.configResolver  per-call T2 resolver
 * @param {Function} [deps.createClient]              ({role,engine,baseUrl,apiKey,model,preset}) => client
 * @param {Function} [deps.probeRole]                 async ({role}) => probe outcome (T1.1a suite)
 * @param {object}   [deps.provisioner]               {runProvision, weightsPresent, loadLock, resolveModelDir}
 * @param {object}   [deps.llmModelsStore]            registry facade (default: server/store/llmModelsStore)
 * @param {object}   [deps.aiUsageDailyStore]         ledger facade (default: server/store/aiUsageDailyStore)
 * @param {object}   [deps.health]                    backendHealth-like {report(key, patch)}
 * @param {Function} [deps.presetFor]                 (role) => manifest row fragment | null (T1.1a)
 * @param {Function} [deps.fetchPublishedMetadata]    async (role, resolved) => number|null (budget step 2)
 * @param {object}   [deps.clock]                     {now()}
 * @param {object}   [deps.timers]                    {setTimeout, clearTimeout}
 * @param {number}   [deps.charsPerToken]             §2.6 safety factor for the token-cap estimate
 */
function createLlmAdapter(deps = {}) {
  const {
    configResolver,
    createClient = defaultCreateClient,
    probeRole = null,
    provisioner = require('./provision'),
    llmModelsStore = null,
    aiUsageDailyStore = null,
    health = null,
    presetFor = () => null,
    fetchPublishedMetadata = null,
    clock = { now: () => Date.now() },
    timers = {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (id) => clearTimeout(id),
    },
    charsPerToken = DEFAULT_CHARS_PER_TOKEN,
  } = deps;

  if (!configResolver || typeof configResolver.getConfig !== 'function') {
    throw new TypeError('configResolver with getConfig(key) is required');
  }

  // Lazy store defaults (no DB connection at factory-construction time).
  let modelsStoreRef = llmModelsStore;
  function modelsStore() {
    if (!modelsStoreRef) {
      // eslint-disable-next-line global-require
      modelsStoreRef = require('../../../store/llmModelsStore');
    }
    return modelsStoreRef;
  }
  let usageStoreRef = aiUsageDailyStore;
  function usageStore() {
    if (!usageStoreRef) {
      // eslint-disable-next-line global-require
      usageStoreRef = require('../../../store/aiUsageDailyStore');
    }
    return usageStoreRef;
  }

  // Hot T2 tunables — refreshed on every role observation (resolver TTL cache
  // makes this cheap); the breaker reads them through these live getters.
  const tunables = { threshold: 5, cooldownS: 300, reprobeDebounceS: 60 };
  const breaker = createBreaker({
    getThreshold: () => tunables.threshold,
    getCooldownS: () => tunables.cooldownS,
    now: () => clock.now(),
  });
  const limiter = createLimiter();

  // Per-role runtime state.
  const clients = new Map(); // role → { signature, client, spec }
  const lastSignature = new Map(); // role → last resolved signature (incl. unconfigured)
  const modelIds = new Map(); // role → llm_models.id (set by syncModelRegistry)
  const reprobeTimers = new Map(); // role → timer id
  let provisioning = false; // embed in-place provisioning in flight

  async function numCap(key) {
    const raw = await configResolver.getConfig(key);
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  async function refreshTunables() {
    const [threshold, cooldownS, reprobeDebounceS] = await Promise.all([
      numCap('LLM_BREAKER_THRESHOLD'),
      numCap('LLM_BREAKER_COOLDOWN_S'),
      numCap('LLM_REPROBE_DEBOUNCE_S'),
    ]);
    if (threshold > 0) tunables.threshold = threshold;
    if (cooldownS > 0) tunables.cooldownS = cooldownS;
    if (reprobeDebounceS > 0) tunables.reprobeDebounceS = reprobeDebounceS;
  }

  async function resolveRoleConfig(role) {
    const keys = ROLE_KEYS[role];
    const [baseUrl, apiKey, model] = await Promise.all(
      keys.map((k) => configResolver.getConfig(k))
    );
    // Remote ⇒ non-empty {base_url, model} (§2.3 roleConfigured): a partial
    // triple is NOT a remote config. Embed falls back to the built-in
    // embedded provider; every other role without a triple is unconfigured.
    const engine = isSet(baseUrl) && isSet(model) ? 'remote' : role === 'embed' ? 'embedded' : null;
    return { role, baseUrl, apiKey, model, engine };
  }

  function signatureOf(resolved) {
    return crypto
      .createHash('sha256')
      .update(
        [
          resolved.baseUrl ?? '',
          resolved.model ?? '',
          resolved.apiKey ?? '',
          resolved.engine ?? '',
        ].join('\u0000')
      )
      .digest('hex');
  }

  async function embeddedPresent() {
    const lock = provisioner.loadLock();
    if (!lock) return false;
    return provisioner.weightsPresent(provisioner.resolveModelDir(), lock);
  }

  /**
   * In-place provisioning run (server-non-blocking) — the remote-override
   * clear trigger (§2.1/§2.2): the role reports `preparing` until done and is
   * NOT configured while it runs (consumers park, never claim-and-fail).
   */
  async function triggerInPlaceProvision() {
    if (provisioning) return;
    const lock = provisioner.loadLock();
    const modelDir = provisioner.resolveModelDir();
    if (await provisioner.weightsPresent(modelDir, lock)) return; // instant return to built-in
    provisioning = true;
    if (health) {
      health.report('ai.embed', {
        preparing: true,
        phase: 'provisioning',
        progress: `0/${lock.files?.length ?? 0} files`,
      });
    }
    provisioner
      .runProvision({
        mode: 'in-place',
        setupComplete: true,
        remoteOverrideActive: false,
        modelDir,
        lock,
        health,
      })
      .catch(() => {
        // §2.8 `provisioning`: the outcome (caps OFF + reason) is reported by
        // the provisioner itself through the health tracker.
      })
      .finally(() => {
        provisioning = false;
      });
  }

  async function scheduleReprobe(role) {
    await refreshTunables();
    const existing = reprobeTimers.get(role);
    if (existing) timers.clearTimeout(existing); // debounce: latest change wins
    reprobeTimers.set(
      role,
      timers.setTimeout(() => {
        reprobeTimers.delete(role);
        if (!probeRole) return;
        Promise.resolve(probeRole({ role })).catch(() => {
          /* probe failures are the probe layer's surface (backendHealth) */
        });
      }, tunables.reprobeDebounceS * 1000)
    );
  }

  /**
   * Per-call config interpretation: resolve the role, compare the resolved
   * signature, and on change rebuild the client, reset the breaker/limiter
   * (§2.2 reconfig semantics) and schedule the debounced re-probe. Awaiting
   * this in every entry point is what makes the adapter restart-free.
   */
  async function observeRole(role) {
    const resolved = await resolveRoleConfig(role);
    await refreshTunables();
    const signature = signatureOf(resolved);
    const entry = clients.get(role);
    const changed = lastSignature.has(role) && lastSignature.get(role) !== signature;

    if (!changed) {
      if (!entry && resolved.engine) {
        // First observation of a configured role (or rebuilt after a null
        // entry): build the client without reset/probe side effects.
        const preset = await Promise.resolve(presetFor(role));
        const client = await createClient({ ...resolved, preset });
        clients.set(role, { signature, client, spec: resolved });
      }
      lastSignature.set(role, signature);
      return { resolved, entry: clients.get(role) ?? entry };
    }

    // Signature change — §2.2: budget breakers reset on reconfig (usage
    // history is DB truth and is never touched); the limiter's per-model
    // budget resets with it.
    breaker.reset(role);
    limiter.reset(role);

    if (
      role === 'embed' &&
      entry &&
      entry.spec.engine === 'remote' &&
      resolved.engine === 'embedded'
    ) {
      await triggerInPlaceProvision();
    }

    if (resolved.engine) {
      const preset = await Promise.resolve(presetFor(role));
      const client = await createClient({ ...resolved, preset });
      clients.set(role, { signature, client, spec: resolved });
    } else {
      clients.delete(role);
    }
    await scheduleReprobe(role);
    lastSignature.set(role, signature);
    return { resolved, entry: clients.get(role) };
  }

  async function roleConfigured(role) {
    const { resolved } = await observeRole(role);
    if (resolved.engine === 'remote') return true;
    if (resolved.engine === 'embedded') {
      if (provisioning) return false; // §2.3: in-place run ⇒ NOT configured (park)
      return embeddedPresent();
    }
    return false;
  }

  async function getRoleClient(role) {
    const { entry } = await observeRole(role);
    if (!entry) return null;
    if (entry.spec.engine === 'embedded' && !(await embeddedPresent())) return null;
    return entry.client;
  }

  // ── budget chain + caps ────────────────────────────────────────────────────

  async function getBudget(role) {
    const resolved = await resolveRoleConfig(role);
    const preset = await Promise.resolve(presetFor(role));
    const metadata = fetchPublishedMetadata ? await fetchPublishedMetadata(role, resolved) : null;
    const chain = resolveBudget({
      adminCap: await configResolver.getConfig('LLM_MAX_INPUT_CHARS'),
      publishedMetadata: metadata,
      presetDefault: preset?.budgets?.maxInputCharsDefault ?? null,
    });
    const limited = limiter.getBudget(role);
    if (limited !== null && (chain.maxInputChars === null || limited <= chain.maxInputChars)) {
      return { maxInputChars: limited, source: 'limiter' };
    }
    return chain;
  }

  async function assertDailyCaps(role) {
    const callCap = await numCap('LLM_DAILY_CALL_CAP');
    const tokenCap = await numCap('LLM_DAILY_TOKEN_CAP');
    if (!callCap && !tokenCap) return;
    const rows = await usageStore().getByDay(dayString(clock.now()));
    const row = rows.find((r) => r.role === role);
    if (callCap && (row?.calls ?? 0) >= callCap) {
      throw classifiedError('budget', 'call_cap', `llm role ${role}: daily call cap reached`);
    }
    if (tokenCap && (row?.inputChars ?? 0) / charsPerToken >= tokenCap) {
      throw classifiedError('budget', 'token_cap', `llm role ${role}: daily token cap reached`);
    }
  }

  async function breakerState(role) {
    await observeRole(role);
    try {
      await assertDailyCaps(role);
    } catch (err) {
      if (err.class === 'budget') return { status: 'budget_paused', reason: err.reason };
      throw err;
    }
    return breaker.state(role);
  }

  async function budgetStatus() {
    const out = {};
    for (const role of ROLES) {
      out[role] = {
        ...(await breakerState(role)),
        budget: await getBudget(role),
      };
    }
    return out;
  }

  // ── usage accounting (§2.9) ───────────────────────────────────────────────

  async function recordUsage(delta) {
    try {
      await usageStore().recordUsage({ day: dayString(clock.now()), ...delta });
    } catch (err) {
      // Telemetry must never mask the provider outcome.
    }
  }

  // ── the call path: breaker gate → provider call → usage record ────────────

  async function invokeRole(role, method, args, meta = {}) {
    const client = await getRoleClient(role);
    if (!client) {
      // Capability degrades, never fatal: a classified error the caller can
      // catch and fall back from (§2.8).
      throw classifiedError('config', 'not_configured', `llm role ${role} is not configured`);
    }
    await assertDailyCaps(role);
    if (!breaker.admit(role)) {
      throw classifiedError('transport', 'breaker_open', `llm role ${role}: breaker open`);
    }

    try {
      const result = await client[method](...args);
      breaker.recordSuccess(role);
      limiter.noteSuccess(role);
      await recordUsage({ role, calls: 1, inputChars: meta.inputChars ?? 0 });
      return result;
    } catch (err) {
      const classified = classifyLlmError(err);
      // transport + rate are breaker-relevant (§2.8); length feeds the
      // §2.5 step-4 limiter instead.
      if (classified.class === 'transport' || classified.class === 'rate') {
        breaker.recordFailure(role);
      }
      if (classified.class === 'length') {
        limiter.noteLengthFailure(role, meta.inputChars ?? 0);
      }
      if (classified.class !== 'transport' && classified.class !== 'rate') {
        // Non-breaker-relevant outcome during a half-open probe: settle the
        // probe slot without a breaker state change (length errors neither
        // close nor re-open the circuit).
        breaker.settleProbe(role);
      }
      await recordUsage({
        role,
        calls: 1,
        inputChars: meta.inputChars ?? 0,
        ...(classified.class === 'rate' ? { failed429: 1 } : {}),
      });
      throw classified;
    }
  }

  // ── public API (§2.3) ─────────────────────────────────────────────────────

  async function embed(texts, opts = {}) {
    const inputChars = (texts || []).reduce((n, t) => n + String(t ?? '').length, 0);
    const result = await invokeRole('embed', 'embed', [texts, opts], { inputChars });
    const preset = await Promise.resolve(presetFor('embed'));
    return {
      vectors: result.vectors ?? [],
      dim: result.dim ?? preset?.profile?.dim ?? null,
      modelId: modelIds.get('embed') ?? null,
      ...(result.degraded ? { degraded: true } : {}),
    };
  }

  async function embedQuery(query) {
    const result = await invokeRole('embed', 'embedQuery', [query], {
      inputChars: String(query ?? '').length,
    });
    const preset = await Promise.resolve(presetFor('embed'));
    return {
      vectors: result.vectors ?? [],
      dim: result.dim ?? preset?.profile?.dim ?? null,
      modelId: modelIds.get('embed') ?? null,
      ...(result.degraded ? { degraded: true } : {}),
    };
  }

  async function chat(messages, opts = {}) {
    const inputChars = JSON.stringify(messages ?? []).length;
    return invokeRole('chat', 'chat', [messages, opts], { inputChars });
  }

  async function visionCaption(frames, opts = {}) {
    const bytes = (frames || []).reduce((n, f) => n + ((f && f.length) || 0), 0);
    return invokeRole('vision', 'visionCaption', [frames, opts], { inputChars: bytes });
  }

  async function asrTranscribe(audioBuffer, opts = {}) {
    return invokeRole('asr', 'asrTranscribe', [audioBuffer, opts], {
      inputChars: (audioBuffer && audioBuffer.length) || 0,
    });
  }

  /**
   * Upsert `llm_models` rows from the resolved configs (§2.3). NO dim column
   * exists (DDL 001 is closed): the dim is runtime-derived from the model
   * profile and persisted per-row on the embeddings rows.
   */
  async function syncModelRegistry() {
    let rows = 0;
    for (const role of ROLES) {
      const resolved = await resolveRoleConfig(role);
      if (!resolved.engine) continue;
      if (resolved.engine === 'embedded' && !(await embeddedPresent())) continue;

      const preset = await Promise.resolve(presetFor(role));
      const lock = resolved.engine === 'embedded' ? provisioner.loadLock() : null;
      const spec = {
        role,
        provider: resolved.engine === 'embedded' ? 'embedded' : (preset?.family ?? 'remote'),
        engine: resolved.engine,
        baseUrlKey: resolved.engine === 'remote' ? ROLE_KEYS[role][0] : '',
        modelName:
          resolved.engine === 'embedded' ? String(lock.repo).split('/').pop() : resolved.model,
        modelRevision: resolved.engine === 'embedded' ? (lock.revision ?? null) : null,
        precision: resolved.engine === 'embedded' ? (lock.dtype ?? null) : null,
        maxInputChars: (await getBudget(role)).maxInputChars,
        chunkBudget:
          preset?.budgets?.chunkBudget ??
          (Number(await configResolver.getConfig('LLM_CHUNK_BUDGET')) || 4),
        batchSize: preset?.budgets?.batchSize ?? null,
        enabled: true,
      };

      const before = await modelsStore().getActiveByRole(role);
      const sameIdentity =
        before &&
        before.engine === spec.engine &&
        before.baseUrlKey === spec.baseUrlKey &&
        before.modelName === spec.modelName &&
        (before.modelRevision ?? null) === (spec.modelRevision ?? null);
      const { id } = await modelsStore().upsertModel(spec);
      modelIds.set(role, id);
      if (!sameIdentity) rows += 1;
    }
    return { rows };
  }

  return {
    roleConfigured,
    getRoleClient,
    embed,
    embedQuery,
    chat,
    visionCaption,
    asrTranscribe,
    breakerState,
    budgetStatus,
    getBudget,
    syncModelRegistry,
  };
}

module.exports = { createLlmAdapter };
