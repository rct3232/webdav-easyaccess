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
const { runVisionProbe, runAsrProbe } = require('./mediaProbe');
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

function isSet(value) {
  return !isMissing(value);
}

function classifyProbeOutcome(err) {
  if (err instanceof SyntaxError) return 'schema';
  return 'transport';
}

async function probeChatEndpoint({ baseUrl, apiKey, model }) {
  const url = `${String(baseUrl).replace(/\/+$/, '')}/chat/completions`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(isSet(apiKey) ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: CHAT_PROBE_INSTRUCTION },
        { role: 'user', content: CHAT_PROBE_SENTENCE },
      ],
      temperature: 0,
      stream: false,
    }),
  });
  if (!response.ok) {
    throw probeError(
      SETUP_TEST_FAILED_CODE,
      HTTP_STATUS.BAD_REQUEST,
      'Connection test failed',
      toShortReason(`chat probe HTTP ${response.status}`)
    );
  }
  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content); // throws SyntaxError → schema failure
  const tags = parsed?.tags;
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
      await probeChatEndpoint({ baseUrl, apiKey, model });
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

module.exports = { ensureLlmProbeTarget, probeLlm, probeEmbedConformance, PROBE_ROLES };
