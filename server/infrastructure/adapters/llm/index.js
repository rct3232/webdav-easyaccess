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
 *   - `createClient`  — dialect client factory (the default here serves the
 *     built-in embedded engine only).
 *   - `probeRole`     — the probe suite hook; the adapter owns the debounced
 *     re-probe TRIGGER, the suite itself is the probe owner's.
 *   - `provisioner`   — the provision module (in-place run on an override
 *     clear).
 *   - `presetFor`     — preset-manifest row seam for budgets/profile and the
 *     capability matrix.
 *   - `fetchImpl`     — transport seam for the remote-embed conformance probe
 *     (defaults to the global fetch; tests inject a fake endpoint).
 *
 * Activation gates (llmAdapter.md §2.4): a remote `embed` role is configured
 * only when the checked-in EG2 reference kit passes `evaluateConformance`
 * against the endpoint — the verdict is cached by config signature. Every
 * probe outcome feeds `evaluateCapabilityMatrix`, whose effective set is
 * published to `probeState` for the enrichment hook and admin surfaces.
 *
 * No module-level singletons: `createLlmAdapter(deps)` is constructed once by
 * the boot wiring and handed to its consumers.
 */

const crypto = require('crypto');

const { classifyLlmError, createBreaker, createLimiter, resolveBudget } = require('./budget');
const probeState = require('./probeState');
const { LLM_ROLE } = require('@webdav-easyaccess/shared/constants');

/** Server role → the matrix capability key it toggles. */
const CAPABILITY_BY_ROLE = {
  embed: 'text_embed',
  chat: 'chat',
  vision: 'vision_chat',
  asr: 'asr',
};

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
 * The default dialect factory: the built-in embedded engine (in-process ONNX)
 * and the remote OpenAI-compatible dialect (llama.cpp / OpenAI-compatible
 * presets). Remote media rides the profile `requestShape`; text prefixes and
 * pooling are profile properties, never provider-name branches.
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
      async embedMedia(buffers, opts = {}) {
        const vectors = await onnx.embedMedia(buffers, {
          mediaType: opts.mediaType,
          modelDir,
          lock,
        });
        return { vectors, dim: vectors[0] ? vectors[0].length : lock.dim };
      },
      async embedWrappedText(text) {
        const vector = await onnx.embedControlText(text, { modelDir, lock });
        return { vectors: [vector], dim: vector.length };
      },
    };
  }
  if (spec.engine === 'remote') {
    // Lazy require: no network/dialect module work at construction time.
    // eslint-disable-next-line global-require
    const { createOpenAiCompatibleClient } = require('./clients/openai-compatible');
    return createOpenAiCompatibleClient({
      baseUrl: spec.baseUrl,
      apiKey: spec.apiKey,
      model: spec.model,
      profile: spec.preset?.profile ?? null,
      kwargs: spec.preset?.kwargs ?? null,
      fetchImpl: spec.fetchImpl ?? null,
    });
  }
  throw classifiedError(
    'config',
    'no_client_dialect',
    `no client dialect for engine '${spec.engine}'`
  );
}

/**
 * Default built-in positive control: the existing embedded-onnx kit pass over
 * the provisioned lockfile weights. Loaded lazily so unit tests and boots that
 * never probe the embedded engine do not import onnxruntime.
 */
function defaultEmbeddedPositiveControl({ modelDir, lock }) {
  // eslint-disable-next-line global-require
  const onnx = require('./clients/embedded-onnx');
  return onnx.positiveControl({
    modelDir,
    lock,
    kitPath: require.resolve('./eg2-reference-kit.json'),
  });
}

/**
 * @param {object} deps
 * @param {{getConfig: Function}} deps.configResolver  per-call T2 resolver
 * @param {Function} [deps.createClient]              ({role,engine,baseUrl,apiKey,model,preset}) => client
 * @param {Function} [deps.embeddedPositiveControl]   ({modelDir,lock}) => {median,min,dim} (built-in kit pass)
 * @param {Function} [deps.probeRole]                 async ({role}) => probe outcome (probe suite)
 * @param {object}   [deps.provisioner]               {runProvision, weightsPresent, loadLock, resolveModelDir}
 * @param {object}   [deps.llmModelsStore]            registry facade (default: server/store/llmModelsStore)
 * @param {object}   [deps.aiUsageDailyStore]         ledger facade (default: server/store/aiUsageDailyStore)
 * @param {object}   [deps.health]                    backendHealth-like {report(key, patch)}
 * @param {Function} [deps.presetFor]                 (role) => manifest row fragment | null (T1.1a)
 * @param {Function} [deps.fetchPublishedMetadata]    async (role, resolved) => number|null (budget step 2)
 * @param {Function} [deps.fetchImpl]                 fetch seam for the remote-embed conformance probe
 * @param {object}   [deps.clock]                     {now()}
 * @param {object}   [deps.timers]                    {setTimeout, clearTimeout}
 * @param {number}   [deps.charsPerToken]             §2.6 safety factor for the token-cap estimate
 */
function createLlmAdapter(deps = {}) {
  const {
    configResolver,
    createClient = defaultCreateClient,
    embeddedPositiveControl = defaultEmbeddedPositiveControl,
    probeRole: probeSuite = null,
    provisioner = require('./provision'),
    llmModelsStore = null,
    aiUsageDailyStore = null,
    health = null,
    presetFor = () => null,
    fetchPublishedMetadata = null,
    fetchImpl = null,
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

  // Probe/conformance verdicts keyed by the RESOLVED config signature (§2.2):
  // one activation pass per signature — never per call — invalidated by
  // observeRole when the signature changes.
  const probeCache = new Map(); // signature → { conformance }
  const conformanceSignature = new Map(); // role → signature of the cached verdict

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

  /** Test/ops seam: the built-in embed model is intentionally unavailable. */
  function embedModelDisabled() {
    return typeof provisioner?.isEmbedModelDisabled === 'function'
      ? provisioner.isEmbedModelDisabled()
      : false;
  }

  async function resolveRoleConfig(role) {
    const keys = ROLE_KEYS[role];
    const [baseUrl, apiKey, model] = await Promise.all(
      keys.map((k) => configResolver.getConfig(k))
    );
    // Remote ⇒ non-empty {base_url, model} (§2.3 roleConfigured): a partial
    // triple is NOT a remote config. Embed falls back to the built-in
    // embedded provider unless the model is intentionally disabled; every
    // other role without a triple is unconfigured.
    const engine =
      isSet(baseUrl) && isSet(model)
        ? 'remote'
        : role === 'embed' && !embedModelDisabled()
          ? 'embedded'
          : null;
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
    if (embedModelDisabled()) return false;
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
    if (embedModelDisabled() || provisioning) return;
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
        Promise.resolve(probeRoleNow(role)).catch(() => {
          /* probe failures are the probe layer's surface (backendHealth) */
        });
      }, tunables.reprobeDebounceS * 1000)
    );
  }

  // ── probe authority: conformance gate + effective capabilities (§2.4) ────

  /**
   * Publish a role's effective capabilities: `evaluateCapabilityMatrix` is the
   * authority rule (declared ≠ probed ⇒ OFF), and `probeState` is what the
   * enrichment hook reads. The embed role publishes its text + media
   * sub-capabilities together so a failed media probe can switch ONLY that
   * capability OFF. Declared-but-failed also lands an `ai.<role>` warning hint
   * for the admin card.
   *
   * @param {string} role
   * @param {object} probeResults capability key → { pass, reason? }
   */
  async function publishRoleCapabilities(role, probeResults) {
    const { evaluateCapabilityMatrix } = require('./presets');
    const capability = CAPABILITY_BY_ROLE[role];
    if (!capability) return null;

    const preset = await Promise.resolve(presetFor(role));
    const results = probeResults || {};
    const matrix = evaluateCapabilityMatrix(preset, results).map((entry) => ({
      ...entry,
      reason: results[entry.capability]?.reason ?? null,
    }));
    const stored = probeState.setRoleCapabilities(role, matrix);
    const primary = stored.find((entry) => entry.capability === capability) || null;

    const failed = stored.find((entry) => entry.note === 'probe-failed');
    const mediaFailed = stored.some(
      (entry) =>
        entry.capability !== 'text_embed' && entry.probed === true && entry.enabled !== true
    );
    if (health && role === 'embed') {
      // Text is the role's primary capability: a failed text_embed is a
      // terminal role failure (admin `probe_failed`). A media-only failure
      // leaves the role usable: status ok + hint renders as admin `partial`.
      if (primary && primary.probed && !primary.enabled) {
        health.report('ai.embed', {
          ok: false,
          code: 'probe_failed',
          ...(primary.reason ? { reason: String(primary.reason).slice(0, 120) } : {}),
          hint: 'serverErrors.ai.providerProbeFailed',
        });
      } else if (mediaFailed) {
        health.report('ai.embed', {
          ok: true,
          hint: 'serverErrors.ai.providerProbeFailed',
        });
      } else if (primary && primary.enabled) {
        health.report('ai.embed', { ok: true });
      }
    } else if (failed && health) {
      health.report(`ai.${role}`, {
        ok: false,
        code: 'probe_failed',
        ...(failed.reason ? { reason: String(failed.reason).slice(0, 120) } : {}),
        hint: 'serverErrors.ai.providerProbeFailed',
      });
    }
    return primary;
  }

  /** Back-compat single-capability publisher (chat/vision/asr + embed text). */
  async function publishRoleCapability(role, outcome) {
    const capability = CAPABILITY_BY_ROLE[role];
    if (!capability) return null;
    return publishRoleCapabilities(role, {
      [capability]: { pass: outcome.ok === true, reason: outcome.reason ?? null },
    });
  }

  /**
   * Run the §2.4 media positive controls against the active embed client and
   * cache the verdict per resolved-config signature (one activation pass per
   * signature, never per call). Text is published independently, so a media
   * failure never blocks `text_embed`.
   */
  async function mediaVerdict(resolved) {
    const signature = signatureOf(resolved);
    const cached = probeCache.get(signature);
    if (cached && cached.media) return cached.media;

    const { entry } = await observeRole('embed');
    const client = entry && entry.client;
    let media = null;
    if (client && typeof client.embedMedia === 'function') {
      let captionImage = null;
      try {
        const visionConfig = await resolveRoleConfig('vision');
        if (visionConfig.engine) {
          const visionObservation = await observeRole('vision');
          const visionClient = visionObservation.entry && visionObservation.entry.client;
          if (visionClient && typeof visionClient.visionCaption === 'function') {
            captionImage = (frames) =>
              visionClient.visionCaption(frames, {
                prompt: 'Describe the main content of this photo in English.',
              });
          }
        }
      } catch {
        /* optional cross-check: caption sanity is advisory */
      }
      // Lazy require: probe fixtures are read only during a probe.
      // eslint-disable-next-line global-require
      const { runEmbedMediaProbes } = require('./mediaProbe');
      media = await runEmbedMediaProbes({
        embed: (...args) => client.embed(...args),
        embedMedia: (...args) => client.embedMedia(...args),
        ...(typeof client.embedWrappedText === 'function'
          ? { embedWrappedText: (...args) => client.embedWrappedText(...args) }
          : {}),
        ...(captionImage ? { captionImage } : {}),
      });
    }
    probeCache.set(signature, { ...(cached || {}), media });
    return media;
  }

  /**
   * In-domain text-embed verdict (§2.4): non-empty vectors, profile dim,
   * non-degeneracy, optional pooling-shape match, plus the built-in engine's
   * checked-in positive control. Cached per resolved-config signature — it is
   * an activation probe, NEVER a per-request one.
   */
  async function textVerdict(resolved) {
    const signature = signatureOf(resolved);
    const cached = probeCache.get(signature);
    if (cached && cached.text) return cached.text;

    const { entry } = await observeRole('embed');
    const client = entry && entry.client;
    let text;
    if (!client || typeof client.embed !== 'function') {
      text = {
        capability: 'text_embed',
        pass: false,
        reason: 'not_configured',
        measurements: {},
      };
    } else {
      const { runEmbedTextProbe, fetchServerPooling } = require('./probe');
      // Lazy require: presets is a leaf module (kit/threshold accessor).
      const { kit } = require('./presets');
      const preset = await Promise.resolve(presetFor('embed'));
      const lock = resolved.engine === 'embedded' ? provisioner.loadLock() : null;
      const dim = preset?.profile?.dim ?? (lock ? lock.dim : null);
      const pooling = preset?.profile?.pooling ?? null;
      const serverPooling =
        resolved.engine === 'remote' && pooling
          ? await fetchServerPooling({
              baseUrl: resolved.baseUrl,
              apiKey: resolved.apiKey,
              ...(fetchImpl ? { fetchImpl } : {}),
            })
          : null;

      text = await runEmbedTextProbe({
        embed: (samples) => client.embed(samples),
        dim,
        pooling,
        serverPooling,
      });

      if (text.pass && resolved.engine === 'embedded') {
        try {
          const pass = await embeddedPositiveControl({
            modelDir: provisioner.resolveModelDir(),
            lock,
          });
          const threshold = kit().threshold;
          if (!pass || (dim && pass.dim !== dim)) {
            text = {
              capability: 'text_embed',
              pass: false,
              reason: 'wrongDim',
              measurements: {
                expectedDim: dim,
                observedDim: pass ? pass.dim : null,
              },
            };
          } else if (!Number.isFinite(pass.median) || pass.median < threshold) {
            text = {
              capability: 'text_embed',
              pass: false,
              reason: 'positiveControlFailed',
              measurements: { median: pass.median, threshold },
            };
          } else {
            text.measurements = {
              ...text.measurements,
              positiveControl: { median: pass.median, threshold },
            };
          }
        } catch (err) {
          text = {
            capability: 'text_embed',
            pass: false,
            reason: 'positiveControlFailed',
            measurements: { error: err && err.message ? err.message : String(err) },
          };
        }
      }
    }
    probeCache.set(signature, { ...(cached || {}), text });
    return text;
  }

  /**
   * The §2.4 EG2 activation gate for a remote embed endpoint: embed the
   * checked-in reference-kit strings through the endpoint and compare the
   * observed space to the canonical vectors (`evaluateConformance`). The
   * verdict is cached by config signature; a transport fault is NOT an
   * identity verdict and is retried on the next activation/debounced pass.
   */
  async function conformanceVerdict(resolved) {
    const signature = signatureOf(resolved);
    const previous = conformanceSignature.get('embed');
    if (previous && previous !== signature) probeCache.delete(previous);
    conformanceSignature.set('embed', signature);

    const cached = probeCache.get(signature);
    if (cached && cached.conformance) return cached.conformance;

    let verdict;
    try {
      // Lazy require: presets/probe are leaf modules; no boot-time cost.
      const { probeEmbedConformance } = require('./probe');
      verdict = await probeEmbedConformance({
        baseUrl: resolved.baseUrl,
        apiKey: resolved.apiKey,
        model: resolved.model,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
    } catch (err) {
      verdict = {
        dimOk: false,
        median: null,
        threshold: null,
        pass: false,
        reason: 'transport',
        error: err && err.message ? err.message : String(err),
      };
      if (health) {
        health.report('ai.embed', {
          ok: false,
          code: 'probe_failed',
          reason: 'transport',
          hint: 'serverErrors.ai.nonConformingEndpoint',
        });
      }
      await publishRoleCapabilities('embed', {
        text_embed: { pass: false, reason: 'transport' },
        image_embed: { pass: false, reason: 'text_embed_off' },
        audio_embed: { pass: false, reason: 'text_embed_off' },
        video_embed: { pass: false, reason: 'text_embed_off' },
      });
      return verdict;
    }

    probeCache.set(signature, { ...(cached || {}), conformance: verdict });
    if (health) {
      if (verdict.pass) {
        health.report('ai.embed', { ok: true });
      } else {
        health.report('ai.embed', {
          ok: false,
          code: 'probe_failed',
          reason: verdict.reason || 'nonConformingEndpoint',
          hint: 'serverErrors.ai.nonConformingEndpoint',
        });
      }
    }
    if (verdict.pass) {
      await publishRoleCapability('embed', { ok: true, reason: null });
    } else {
      const reason = verdict.reason || 'nonConformingEndpoint';
      await publishRoleCapabilities('embed', {
        text_embed: { pass: false, reason },
        image_embed: { pass: false, reason: 'text_embed_off' },
        audio_embed: { pass: false, reason: 'text_embed_off' },
        video_embed: { pass: false, reason: 'text_embed_off' },
      });
    }
    return verdict;
  }

  /**
   * The probe suite entry point per role. Embed is the activation gate owner
   * (conformance, HTTP to the endpoint); chat/vision/asr delegate to the
   * injected suite and publish the resulting effective capability.
   */
  async function probeRoleNow(role) {
    if (!LLM_ROLE.isValid(role)) return { ok: false, role, reason: 'unknown role' };

    if (role === 'embed') {
      const resolved = await resolveRoleConfig('embed');
      if (resolved.engine === 'remote') {
        const verdict = await conformanceVerdict(resolved);
        if (!verdict.pass) {
          return {
            ok: false,
            role,
            reason: verdict.reason || 'nonConformingEndpoint',
            median: verdict.median,
            threshold: verdict.threshold,
          };
        }
        const text = await textVerdict(resolved);
        const media = await mediaVerdict(resolved);
        await publishRoleCapabilities('embed', {
          text_embed: { pass: text.pass === true, reason: text.reason ?? null },
          ...(media || {}),
        });
        return {
          ok: text.pass === true,
          role,
          reason: text.pass === true ? null : text.reason,
          median: verdict.median,
          threshold: verdict.threshold,
          text,
          ...(media ? { media } : {}),
        };
      }
      if (embedModelDisabled()) {
        probeState.clearRoleCapability('embed');
        return { ok: false, role, reason: 'disabled', exempt: true };
      }
      if (provisioning) return { ok: false, role, reason: 'preparing' };
      const present = await embeddedPresent();
      if (!present) {
        await publishRoleCapabilities('embed', {
          text_embed: { pass: false, reason: 'notProvisioned' },
          image_embed: { pass: false, reason: 'notProvisioned' },
          audio_embed: { pass: false, reason: 'notProvisioned' },
          video_embed: { pass: false, reason: 'notProvisioned' },
        });
        return { ok: false, role, reason: 'notProvisioned', exempt: true };
      }
      const text = await textVerdict(resolved);
      const media = await mediaVerdict(resolved);
      await publishRoleCapabilities('embed', {
        text_embed: { pass: text.pass === true, reason: text.reason ?? null },
        ...(media || {}),
      });
      return {
        ok: text.pass === true,
        role,
        reason: text.pass === true ? null : text.reason,
        exempt: true,
        text,
        ...(media ? { media } : {}),
      };
    }

    const resolved = await resolveRoleConfig(role);
    if (!resolved.engine) return { ok: false, role, reason: 'unconfigured' };

    let outcome;
    if (probeSuite) {
      try {
        outcome = (await probeSuite({ role })) || {
          ok: false,
          role,
          reason: 'probe failed',
        };
      } catch (err) {
        outcome = {
          ok: false,
          role,
          reason: (err && (err.reason || err.message)) || 'probe failed',
        };
      }
    } else {
      // No suite installed: declared-but-unprobed ⇒ capability OFF (honest).
      outcome = { ok: false, role, reason: 'no probe suite' };
    }
    await publishRoleCapability(role, outcome);
    return outcome;
  }

  /**
   * Boot/initial probe (llmAdapter.md §2.4 — the startup probe is the INITIAL
   * probe): every CONFIGURED role runs once. Unconfigured roles are skipped
   * (capability OFF, no warning). Failures never throw.
   */
  async function probeConfiguredRoles() {
    const outcomes = {};
    for (const role of LLM_ROLE.ALL) {
      const resolved = await resolveRoleConfig(role);
      if (!resolved.engine) continue;
      try {
        outcomes[role] = await probeRoleNow(role);
      } catch (err) {
        outcomes[role] = {
          ok: false,
          role,
          reason: (err && (err.reason || err.message)) || 'probe failed',
        };
      }
    }
    return outcomes;
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
        const client = await createClient({
          ...resolved,
          preset,
          ...(fetchImpl ? { fetchImpl } : {}),
        });
        clients.set(role, { signature, client, spec: resolved });
      }
      lastSignature.set(role, signature);
      return { resolved, entry: clients.get(role) ?? entry };
    }

    // Signature change — §2.2: budget breakers reset on reconfig (usage
    // history is DB truth and is never touched); the limiter's per-model
    // budget resets with it. Probe/conformance verdicts of the previous
    // signature are dropped: the next activation pass re-probes exactly once.
    breaker.reset(role);
    limiter.reset(role);
    const previousSignature = lastSignature.get(role);
    if (previousSignature) probeCache.delete(previousSignature);

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
      const client = await createClient({
        ...resolved,
        preset,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      clients.set(role, { signature, client, spec: resolved });
      // C6: a rebuild of the embed client is a model-identity event for the
      // registry too. Sync ONLY the embed row in place (non-recursive, no
      // provider metadata GET on the hot path); an identity change resets the
      // boot-frozen vector store. The debounced probe below is the only
      // provider work this signature change schedules.
      if (role === 'embed') {
        try {
          await syncRoleRegistry('embed', { metadata: false });
        } catch {
          /* registry sync must never block config adoption */
        }
      }
    } else {
      clients.delete(role);
      // An unconfigured role carries no capability and no probe warning.
      probeState.clearRoleCapability(role);
    }
    await scheduleReprobe(role);
    lastSignature.set(role, signature);
    return { resolved, entry: clients.get(role) };
  }

  /**
   * Readiness of a role for a consumer that needs a reason, not just a boolean
   * (search's semantic leg is the first): `{ configured, reason }` where the
   * reason is `null` when configured and one of `not_configured`, `preparing`,
   * `provisioning_failed`, `probe_failed`, or `non_conforming` otherwise.
   * Provider-call-free: remote embed reuses the cached conformance verdict;
   * embedded checks the in-place provisioning flag + local weights.
   */
  async function getRoleReadiness(role) {
    if (role === 'embed') {
      const resolved = await resolveRoleConfig('embed');
      if (resolved.engine === 'remote') {
        const verdict = await conformanceVerdict(resolved);
        if (!verdict.pass) {
          return {
            configured: false,
            reason: verdict.reason === 'nonConformingEndpoint' ? 'non_conforming' : 'probe_failed',
          };
        }
        // The text verdict is an activation-time cache entry: if it already
        // ran and failed (non-degenerate/dim/pooling), the semantic text leg
        // must not use this endpoint. No probe is triggered from readiness.
        const text = probeCache.get(signatureOf(resolved))?.text;
        if (text && text.pass !== true) {
          return { configured: false, reason: 'probe_failed' };
        }
        try {
          // Prime the client cache/readiness bookkeeping; a dialect factory
          // failure is a call-path config error, not an activation verdict.
          await observeRole('embed');
        } catch (err) {
          /* role stays gate-configured; the call path degrades honestly */
        }
        return { configured: true, reason: null };
      }
      if (resolved.engine === 'embedded') {
        // observeRole owns the override-clear in-place provisioning trigger;
        // without this call the readiness probe would report a failure reason
        // but never start the run.
        try {
          await observeRole('embed');
        } catch {
          /* role stays gate-configured; the call path degrades honestly */
        }
        if (provisioning) return { configured: false, reason: 'preparing' };
        if (!(await embeddedPresent())) {
          return { configured: false, reason: 'provisioning_failed' };
        }
        return { configured: true, reason: null };
      }
      return { configured: false, reason: 'not_configured' };
    }

    const { resolved } = await observeRole(role);
    if (resolved.engine === 'remote') return { configured: true, reason: null };
    if (resolved.engine === 'embedded') {
      if (provisioning) return { configured: false, reason: 'preparing' };
      const present = await embeddedPresent();
      return { configured: present, reason: present ? null : 'provisioning_failed' };
    }
    return { configured: false, reason: 'not_configured' };
  }

  async function roleConfigured(role) {
    const readiness = await getRoleReadiness(role);
    return readiness.configured === true;
  }

  async function getRoleClient(role) {
    const { resolved, entry } = await observeRole(role);
    if (!entry) return null;
    if (entry.spec.engine === 'embedded' && !(await embeddedPresent())) return null;
    if (role === 'embed' && resolved.engine === 'remote') {
      // Fail closed: no embed call may leave a non-conforming endpoint.
      const verdict = await conformanceVerdict(resolved);
      if (!verdict.pass) return null;
    }
    return entry.client;
  }

  // ── budget chain + caps ────────────────────────────────────────────────────

  async function getBudget(role, { metadata: allowMetadata = true } = {}) {
    const resolved = await resolveRoleConfig(role);
    const preset = await Promise.resolve(presetFor(role));
    const metadata =
      allowMetadata && fetchPublishedMetadata ? await fetchPublishedMetadata(role, resolved) : null;
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
    for (const role of LLM_ROLE.ALL) {
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

  /**
   * V1/V3 direct media embed (§2.3 `embedMedia`): same embed role, media
   * carries NO text prefix, usage accounting mirrors `embed`.
   */
  async function embedMedia(buffers, opts = {}) {
    const inputChars = (buffers || []).reduce(
      (n, buffer) => n + ((buffer && buffer.length) || 0),
      0
    );
    const result = await invokeRole('embed', 'embedMedia', [buffers, opts], { inputChars });
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
   * Upsert ONE role's `llm_models` row (§2.3). NO dim column exists (DDL 001
   * is closed): the dim is runtime-derived from the model profile and
   * persisted per-row on the embeddings rows.
   *
   * `metadata:false` is the HOT path: registry sync must not issue provider
   * metadata GETs beyond the probe already scheduled for the new signature.
   */
  async function syncRoleRegistry(role, { metadata = true } = {}) {
    const resolved = await resolveRoleConfig(role);
    if (!resolved.engine) return { rows: 0 };
    if (resolved.engine === 'embedded' && !(await embeddedPresent())) return { rows: 0 };

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
      maxInputChars: (await getBudget(role, { metadata })).maxInputChars,
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
    if (!sameIdentity) {
      // An embed model identity change invalidates the boot-frozen vector
      // engine (space key + runtime dim); the next init() rebuilds the
      // derived artifact at the new dim (vectorStore.md §2.1/§2.4).
      if (role === 'embed') {
        try {
          require('../../../domains/ai/vectorStoreRuntime').resetVectorStore();
        } catch {
          /* vector seam not loaded in this process — nothing to reset */
        }
      }
      return { rows: 1 };
    }
    return { rows: 0 };
  }

  /**
   * Boot registry sync: upsert every configured role (llmAdapter.md §2.3).
   * Hot embed config changes call `syncRoleRegistry('embed')` directly from
   * `observeRole` — never through this whole-role loop (no double boot work).
   */
  async function syncModelRegistry({ metadata = true } = {}) {
    let rows = 0;
    for (const role of LLM_ROLE.ALL) {
      rows += (await syncRoleRegistry(role, { metadata })).rows;
    }
    return { rows };
  }

  return {
    roleConfigured,
    getRoleReadiness,
    getRoleClient,
    probeRole: probeRoleNow,
    probeConfiguredRoles,
    getEffectiveCapabilities: () => probeState.getEffectiveCapabilities(),
    embed,
    embedMedia,
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
