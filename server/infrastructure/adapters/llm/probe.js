'use strict';

/**
 * LLM probe target core (T1.1c — llmAdapter.md §2.3 `probeLlm()` wiring).
 *
 * Registers the reserved `llm` slot of `backendProbe.runProbe` (admin.md §3.2
 * P0 plumbing; the slot itself landed in T0.7b) so `POST /api/setup/test`
 * (wizard, docs/spec/server/routes/setup.md §2.4a) and
 * `POST /api/admin/config/test` (P1) both accept `target: 'llm'` with the
 * envelope `{ ok: false, errorCode, message, reason? }`.
 *
 * Scope discipline (llmAdapter.md §2.4 hard rules):
 * - The probe is IN-DOMAIN — never a declared-capability shortcut. The chat
 *   probe sends one real sentence and passes only when the answer is
 *   schema-valid JSON (instruction-following echo).
 * - Synthetic media probes are BANNED (sine/noise/synthetic-photo probes
 *   cannot distinguish false negatives from false claims). Vision/asr run the
 *   real-fixture positive controls in `mediaProbe.js`; a transport fault stays
 *   an honest `transport` failure and the capability stays OFF — never a fake
 *   pass.
 * - The embed role is NOT a wizard/admin-test target (the built-in engine needs
 *   no config). The EXTERNAL embed override is still gated by this suite:
 *   `probeEmbedConformance` runs the checked-in EG2 reference kit through the
 *   endpoint at activation (llmAdapter roleConfigured) and on re-probe.
 *
 * Probe outcomes land in the `ai.<role>` backend-health tracker rows
 * (backendHealth.md §2.3) — per-role isolation, admin 5-state surface.
 */

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SETUP_TEST_FAILED_CODE,
  PROBE_TARGET_LLM,
  isMissing,
  toShortReason,
  probeError,
  registerProbeTarget,
} = require('../../backendProbe');
const { getBackendHealth } = require('../../backendHealth');
const { evaluateConformance, findPreset, kit } = require('./presets');
const { runVisionProbe, runAsrProbe, cosine } = require('./mediaProbe');
const { createOpenAiCompatibleClient } = require('./clients/openai-compatible');

// The wizard/admin-test probe surface: embed is deliberately absent (built-in
// engine needs no config; docs/spec/server/routes/setup.md §2.4a). The remote
// embed override is gated by `probeEmbedConformance` at activation instead.
const PROBE_ROLES = ['chat', 'vision', 'asr'];

// In-domain chat sample (§2.4): tag extraction from one real sentence.
const CHAT_PROBE_SENTENCE =
  'A golden retriever sleeps on the couch while rain taps against the window.';
const CHAT_PROBE_INSTRUCTION =
  'Extract content tags from the sentence. Answer with JSON only: {"tags": ["...", ...]}';
const CHAT_PROBE_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['tags'],
  additionalProperties: false,
});

// In-domain text probe samples (§2.4): two real, distinct mixed-ko/en
// sentences. Constant-output endpoints return the same vector for both and are
// rejected by the non-degeneracy floor below.
const EMBED_TEXT_PROBE_SAMPLES = Object.freeze([
  'A golden retriever sleeps on the couch while rain taps against the window.',
  '한국어로 작성된 짧은 문장은 서로 다른 의미를 가지며 검색 품질을 확인한다.',
]);
const TEXT_NON_DEGENERACY_MAX = 0.999;

function isSet(value) {
  return !isMissing(value);
}

function classifyProbeOutcome(err) {
  if (err instanceof SyntaxError || err?.class === 'schema') return 'schema';
  return 'transport';
}

async function probeChatEndpoint({ baseUrl, apiKey, model, fetchImpl }) {
  // Use the SAME client as the runtime chat path: it adds
  // `response_format: json_schema` when a schema is supplied (plus the preset
  // `chat_template_kwargs`). A raw fetch without response_format makes models
  // such as Hana wrap valid JSON in a markdown fence, which is a probe/model-
  // contract mismatch, not a chat capability failure.
  const row = findPreset('gemma-4-12b-it');
  const client = createOpenAiCompatibleClient({
    baseUrl,
    apiKey,
    model,
    profile: row ? row.profile : null,
    kwargs: row ? row.kwargs : null,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const result = await client.chat(
    [
      { role: 'system', content: CHAT_PROBE_INSTRUCTION },
      { role: 'user', content: CHAT_PROBE_SENTENCE },
    ],
    { schema: CHAT_PROBE_SCHEMA }
  );
  const tags = result?.json?.tags;
  const schemaValid =
    Array.isArray(tags) && tags.length > 0 && tags.every((tag) => typeof tag === 'string');
  if (!schemaValid) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      toShortReason('chat probe: response is not schema-valid JSON')
    );
  }
}

/**
 * Media role probes (§2.4, T1.9): real in-domain fixtures through the same
 * OpenAI-compatible client the runtime uses. Positive controls and transport
 * isolation live in mediaProbe.js; a transport fault keeps the honest
 * `transport` failure (never a cached identity/activation verdict).
 */
function mediaClient({ baseUrl, apiKey, model, fetchImpl }) {
  const row = findPreset('gemma-4-12b-it');
  return createOpenAiCompatibleClient({
    baseUrl,
    apiKey,
    model,
    profile: row ? row.profile : null,
    kwargs: row ? row.kwargs : null,
    ...(fetchImpl ? { fetchImpl } : {}),
  });
}

async function probeVisionEndpoint({ baseUrl, apiKey, model, fetchImpl }) {
  const client = mediaClient({ baseUrl, apiKey, model, fetchImpl });
  const result = await runVisionProbe({
    visionCaption: (...args) => client.visionCaption(...args),
    chat: (...args) => client.chat(...args),
  });
  if (!result.pass) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      toShortReason(result.reason || 'vision probe failed')
    );
  }
}

async function probeAsrEndpoint({ baseUrl, apiKey, model, fetchImpl }) {
  const client = mediaClient({ baseUrl, apiKey, model, fetchImpl });
  const result = await runAsrProbe({
    asrTranscribe: (...args) => client.asrTranscribe(...args),
  });
  if (!result.pass) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      toShortReason(result.reason || 'asr probe failed')
    );
  }
}

/** Document prefix of the external EG2 row (the kit is calibrated in the
 * profile's document space — the probe must embed the same texts). */
function defaultDocumentPrefix() {
  const row = findPreset('embeddinggemma-2-external');
  return (
    (row && row.profile && row.profile.textPrefixes && row.profile.textPrefixes.document) || ''
  );
}

/**
 * In-domain text-embed probe (llmAdapter.md §2.4): two distinct mixed-ko/en
 * sentences must produce NON-EMPTY vectors at the profile dim, and the pair
 * must not collapse to cosine ≥ 0.999 (constant-output endpoint). When the
 * profile declares `pooling` and the server exposes `/props`, a mismatched
 * server pooling shape rejects `text_embed` (SPACE-shaping failure).
 *
 * Pure over its inputs: the caller supplies the embed function and (for
 * remote endpoints) the already-read server pooling value. Cached by the
 * adapter per config signature — never run per search/embed call.
 *
 * @param {object} params
 * @param {Function} params.embed async (texts[]) => { vectors }
 * @param {number|null} [params.dim] profile dim (768 for EG2)
 * @param {string|null} [params.pooling] profile-declared pooling
 * @param {string|null} [params.serverPooling] value from /props, or null
 * @param {string[]} [params.samples] in-domain samples
 * @returns {Promise<{capability:'text_embed', pass:boolean, reason:string|null, measurements:object}>}
 */
async function runEmbedTextProbe({
  embed,
  dim = null,
  pooling = null,
  serverPooling = null,
  samples = EMBED_TEXT_PROBE_SAMPLES,
} = {}) {
  const fail = (reason, measurements = {}) => ({
    capability: 'text_embed',
    pass: false,
    reason,
    measurements,
  });
  try {
    const result = await embed(samples);
    const vectors = result && Array.isArray(result.vectors) ? result.vectors : null;
    if (
      !vectors ||
      vectors.length < 2 ||
      vectors.slice(0, 2).some((vector) => !vector || vector.length === 0)
    ) {
      return fail('emptyTextEmbedding', { count: vectors ? vectors.length : 0 });
    }
    const observedDims = vectors.slice(0, 2).map((vector) => vector.length);
    if (dim && observedDims.some((observed) => observed !== dim)) {
      return fail('wrongDim', { expectedDim: dim, observedDims });
    }
    const pairCos = cosine(vectors[0], vectors[1]);
    if (!Number.isFinite(pairCos) || pairCos >= TEXT_NON_DEGENERACY_MAX) {
      return fail('degenerateEmbedding', { pairCos });
    }
    if (pooling && serverPooling) {
      const normalized = String(serverPooling).trim().toLowerCase();
      if (normalized !== String(pooling).trim().toLowerCase()) {
        return fail('poolingMismatch', { expectedPooling: pooling, serverPooling });
      }
    }
    return {
      capability: 'text_embed',
      pass: true,
      reason: null,
      measurements: { pairCos, dim: observedDims[0] },
    };
  } catch (err) {
    return fail(err?.reason || err?.class || 'text_probe_failed', {
      error: err?.message || String(err),
    });
  }
}

/**
 * Read the served pooling shape from a llama-family `/props` GET. A missing or
 * unreachable endpoint yields `null` (the probe then cannot reject on pooling;
 * §2.4 only rejects when the endpoint EXPOSES it).
 */
async function fetchServerPooling({ baseUrl, apiKey, fetchImpl } = {}) {
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;
  try {
    const response = await doFetch(`${String(baseUrl).replace(/\/+$/, '')}/props`, {
      method: 'GET',
      headers: {
        ...(isSet(apiKey) ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
    if (!response || response.ok !== true) return null;
    const payload = await response.json();
    const value =
      payload?.pooling ??
      payload?.pooling_type ??
      payload?.default_generation_settings?.pooling ??
      payload?.server?.pooling ??
      payload?.model?.pooling ??
      null;
    return typeof value === 'string' && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/**
 * The remote-embed conformance probe (llmAdapter.md §2.3/§2.4 — the activation
 * gate for an external embed override). This is the probe SUITE's embed leg:
 * the wizard/admin-test `probeLlm` surface stays chat/vision/asr-only, while
 * the adapter's `probeRole('embed')` / `roleConfigured('embed')` paths consume
 * this function.
 *
 * Sends the checked-in `eg2-reference-kit.json` strings through the endpoint's
 * OpenAI-compatible embeddings route (document prefixes applied) and applies
 * `evaluateConformance`: structural (dim) + behavioural (median cos ≥ kit τ).
 * Identity is what the vectors DO — the endpoint's self-declared model name is
 * never an input. Throws the classified probe error on transport/HTTP failure;
 * returns the verdict otherwise (`pass:false` = endpoint rejected at activation).
 *
 * @param {object} params
 * @param {string} params.baseUrl
 * @param {string} [params.apiKey]
 * @param {string} params.model
 * @param {string} [params.prefix] document prefix override (tests/other profiles)
 * @param {Function} [params.fetchImpl] transport seam (defaults to global fetch)
 * @returns {Promise<{dimOk: boolean, median: number|null, threshold: number, pass: boolean, reason: string|null}>}
 */
async function probeEmbedConformance({ baseUrl, apiKey, model, prefix, fetchImpl } = {}) {
  const reference = kit();
  const documentPrefix = prefix === undefined ? defaultDocumentPrefix() : prefix;
  const inputs = reference.strings.map((text) => `${documentPrefix}${text}`);
  const url = `${String(baseUrl).replace(/\/+$/, '')}/embeddings`;
  const doFetch = typeof fetchImpl === 'function' ? fetchImpl : fetch;

  // A wedged endpoint must not hold the activation pass open indefinitely.
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(30_000)
      : undefined;

  const response = await doFetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(isSet(apiKey) ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({ model, input: inputs }),
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Conformance probe failed',
      toShortReason(`embed probe HTTP ${response.status}`)
    );
  }
  const payload = await response.json();
  const rows = Array.isArray(payload && payload.data) ? payload.data.slice() : [];
  // OpenAI-compatible responses may arrive out of order: index restores the
  // kit's input order before the pairwise cosine comparison.
  rows.sort((a, b) => Number((a && a.index) ?? 0) - Number((b && b.index) ?? 0));
  const observed = rows.map((row) =>
    row && Array.isArray(row.embedding) ? Float32Array.from(row.embedding) : null
  );
  return evaluateConformance(observed);
}

/**
 * The `llm` probe handler. Body: `{ role, baseUrl, apiKey, model }` (setup.md
 * §2.4a fourth target shape). Success `{ ok: true, role, reason: null }`;
 * failures throw the classified probe error the routes map to the envelope.
 * Every terminal outcome is reported to the `ai.<role>` tracker row.
 */
async function probeLlm(body) {
  const { role, baseUrl, apiKey, model, fetchImpl } = body || {};
  const healthKey = PROBE_ROLES.includes(role) ? `ai.${role}` : null;

  if (!healthKey) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      `Unsupported LLM probe role: ${String(role)}`
    );
  }
  if (isMissing(baseUrl) || isMissing(model)) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Missing required fields: baseUrl, model'
    );
  }

  try {
    if (role === 'chat') {
      await probeChatEndpoint({ baseUrl, apiKey, model, fetchImpl });
    } else if (role === 'vision') {
      await probeVisionEndpoint({ baseUrl, apiKey, model, fetchImpl });
    } else {
      await probeAsrEndpoint({ baseUrl, apiKey, model, fetchImpl });
    }
    getBackendHealth().report(healthKey, { ok: true });
    return { ok: true, role, reason: null };
  } catch (err) {
    const isProbeError = err && err.errorCode === SETUP_TEST_FAILED_CODE;
    const reason = isProbeError
      ? err.reason
      : toShortReason(
          `${classifyProbeOutcome(err)}: ${err && err.message ? err.message : 'probe failed'}`
        );
    getBackendHealth().report(healthKey, {
      ok: false,
      code: 'unknown',
      ...(reason ? { reason } : {}),
    });
    if (isProbeError) throw err;
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      reason
    );
  }
}

/**
 * (Re-)register the `llm` probe target. Idempotent by replacement (the same
 * handler instance re-enters the registry), so callers may invoke it per
 * request; a test-side unregister is healed on the next call.
 */
function ensureLlmProbeTarget() {
  registerProbeTarget(PROBE_TARGET_LLM, probeLlm);
}

module.exports = {
  ensureLlmProbeTarget,
  probeLlm,
  probeEmbedConformance,
  runEmbedTextProbe,
  fetchServerPooling,
  EMBED_TEXT_PROBE_SAMPLES,
  PROBE_ROLES,
};
