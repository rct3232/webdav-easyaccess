'use strict';

/**
 * Boot wiring for the llmAdapter role seams (llmAdapter.md §2.2/§2.3):
 * `presetFor` (manifest row per role + resolved embed engine) and
 * `probeRole` (per-role re-probe through the T1.1c probe suite — the suite
 * reports its terminal outcome to the `ai.<role>` tracker rows itself).
 *
 * Kept out of server/index.js so the boot path stays declarative; tests can
 * exercise the seam functions without booting the app.
 */

const DEFAULT_METADATA_TTL_MS = 5 * 60 * 1000;

function isSet(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
}

function positiveNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function firstPositive(...values) {
  for (const value of values) {
    const n = positiveNumber(value);
    if (n !== null) return n;
  }
  return null;
}

/** `/v1/models` row metadata: OpenAI `max_input_tokens` / llama.cpp `n_ctx`. */
function readModelsBudget(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  for (const row of rows) {
    const n = firstPositive(
      row?.max_input_tokens,
      row?.max_input_chars,
      row?.n_ctx,
      row?.context_length,
      row?.meta?.n_ctx,
      row?.meta?.n_ctx_train
    );
    if (n !== null) return n;
  }
  return null;
}

/** llama.cpp `/props` default-generation settings carry the served context. */
function readPropsBudget(payload) {
  return firstPositive(
    payload?.default_generation_settings?.n_ctx,
    payload?.n_ctx,
    payload?.context_length,
    payload?.max_input_tokens
  );
}

/** Ollama `/api/show` model_info / parameters carry the context length. */
function readOllamaBudget(payload) {
  const info = payload?.model_info;
  if (info && typeof info === 'object') {
    for (const [key, value] of Object.entries(info)) {
      if (/context_length|num_ctx/i.test(key)) {
        const n = positiveNumber(value);
        if (n !== null) return n;
      }
    }
  }
  const parameters = payload?.parameters;
  if (typeof parameters === 'string') {
    const match = parameters.match(/(?:^|\n)\s*num_ctx\s+(\d+)/i);
    if (match) return positiveNumber(match[1]);
  }
  return firstPositive(payload?.details?.context_length, payload?.context_length);
}

/**
 * Budget-chain step 2 (llmAdapter.md §2.5): published endpoint metadata over
 * FREE GETs only. Resolves the role triple through the T2 resolver, then reads
 * the family-appropriate endpoint (`/v1/models` then `/props` for
 * llama.cpp/OpenAI-compatible; `/api/show` for ollama). The numeric result is
 * cached by config signature for a short TTL; every transport/HTTP/parse
 * failure resolves `null` — this seam NEVER throws into the adapter.
 *
 * @param {{getConfig: Function}} resolver
 * @param {Object} [opts]
 * @param {Function} [opts.fetchImpl] transport seam
 * @param {Function} [opts.presetFor] (role) => manifest row | null (family source)
 * @param {number} [opts.ttlMs] cache TTL (default 5 min)
 * @param {Function} [opts.now] clock seam
 * @returns {(role: string, resolved: Object) => Promise<number|null>}
 */
function createPublishedMetadataFetcher(resolver, opts = {}) {
  const doFetch = typeof opts.fetchImpl === 'function' ? opts.fetchImpl : fetch;
  const presetFor = typeof opts.presetFor === 'function' ? opts.presetFor : null;
  const ttlMs = positiveNumber(opts.ttlMs) ?? DEFAULT_METADATA_TTL_MS;
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now();
  const cache = new Map();

  function baseHeaders(apiKey) {
    return isSet(apiKey) ? { authorization: `Bearer ${apiKey}` } : {};
  }

  async function getJson(url, apiKey) {
    const response = await doFetch(url, { method: 'GET', headers: baseHeaders(apiKey) });
    if (!response || response.ok !== true) {
      throw new Error(`metadata GET ${url} HTTP ${response?.status ?? 'error'}`);
    }
    return response.json();
  }

  async function resolveFamily(role) {
    if (!presetFor) return 'llama.cpp';
    try {
      const preset = await Promise.resolve(presetFor(role));
      return preset?.family || 'llama.cpp';
    } catch {
      return 'llama.cpp';
    }
  }

  async function fetchBudget(role, resolved) {
    if (!resolved || resolved.engine !== 'remote' || !isSet(resolved.baseUrl)) return null;
    const base = String(resolved.baseUrl).replace(/\/+$/, '');
    const family = await resolveFamily(role);
    const apiKey = resolved.apiKey;

    if (family === 'ollama') {
      const query = isSet(resolved.model) ? `?name=${encodeURIComponent(resolved.model)}` : '';
      const payload = await getJson(`${base}/api/show${query}`, apiKey);
      return readOllamaBudget(payload);
    }

    try {
      const models = await getJson(`${base}/v1/models`, apiKey);
      const fromModels = readModelsBudget(models);
      if (fromModels !== null) return fromModels;
    } catch {
      /* fall through to /props */
    }
    const props = await getJson(`${base}/props`, apiKey);
    return readPropsBudget(props);
  }

  return async function fetchPublishedMetadata(role, resolved) {
    if (
      !resolved ||
      resolved.engine !== 'remote' ||
      !isSet(resolved.baseUrl) ||
      typeof doFetch !== 'function'
    ) {
      return null;
    }
    const signature = [role, resolved.baseUrl, resolved.model ?? '', resolved.apiKey ?? ''].join(
      '\u0000'
    );
    const cached = cache.get(signature);
    if (cached && now() < cached.expiresAt) return cached.value;

    let value = null;
    try {
      value = await fetchBudget(role, resolved);
    } catch {
      value = null;
    }
    if (value !== null) cache.set(signature, { value, expiresAt: now() + ttlMs });
    return value;
  };
}

/** Manifest row fragment per role; embed picks the row by the RESOLVED
 * engine (remote triple ⇒ the external EG2 row, else the built-in row). */
function createBootPresetFor(resolver) {
  return async (role) => {
    const { getPresetByFamilyRole } = require('./adapters/llm/presets');
    if (role === 'embed') {
      const [baseUrl, model] = await Promise.all([
        resolver.getConfig('LLM_EMBED_BASE_URL'),
        resolver.getConfig('LLM_EMBED_MODEL'),
      ]);
      return getPresetByFamilyRole(
        isSet(baseUrl) && isSet(model) ? 'llama.cpp' : 'embedded',
        'embed'
      );
    }
    // chat/vision/asr have no embedded engine — the remote manifest row.
    return getPresetByFamilyRole('llama.cpp', role);
  };
}

/** Per-role re-probe (§2.2 debounced trigger): resolve the role's remote
 * triple and run the probe suite. The embed role is owned by the adapter's
 * activation gate (conformance over the checked-in EG2 kit, llmAdapter §2.4),
 * so this seam delegates to the installed adapter — the wizard probe surface
 * stays chat/vision/asr-only (probe.js scope discipline); unconfigured remote
 * roles are skipped. */
function createBootProbeRole(resolver) {
  const ROLE_KEYS = {
    chat: ['LLM_CHAT_BASE_URL', 'LLM_CHAT_API_KEY', 'LLM_CHAT_MODEL'],
    vision: ['LLM_VISION_BASE_URL', 'LLM_VISION_API_KEY', 'LLM_VISION_MODEL'],
    asr: ['LLM_ASR_BASE_URL', 'LLM_ASR_API_KEY', 'LLM_ASR_MODEL'],
  };
  return async ({ role }) => {
    if (role === 'embed') {
      const { getLlmAdapter } = require('./llmAdapterRuntime');
      const adapter = getLlmAdapter();
      if (!adapter || typeof adapter.probeRole !== 'function') {
        return { ok: false, role, reason: 'adapter not installed' };
      }
      return adapter.probeRole('embed');
    }
    const keys = ROLE_KEYS[role];
    if (!keys) return { ok: false, role, reason: 'no remote probe surface' };
    const [baseUrl, apiKey, model] = await Promise.all(keys.map((key) => resolver.getConfig(key)));
    if (!isSet(baseUrl) || !isSet(model)) {
      return { ok: false, role, reason: 'unconfigured' };
    }
    try {
      const { probeLlm } = require('./adapters/llm/probe');
      await probeLlm({ role, baseUrl, apiKey, model });
      return { ok: true, role, reason: null };
    } catch (err) {
      // Terminal outcome already reported to the `ai.<role>` tracker row.
      return { ok: false, role, reason: err?.reason ?? err?.message ?? 'probe failed' };
    }
  };
}

module.exports = {
  createBootPresetFor,
  createBootProbeRole,
  createPublishedMetadataFetcher,
};
