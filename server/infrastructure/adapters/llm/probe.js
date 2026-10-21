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
 *   cannot distinguish false negatives from false claims). The vision/asr
 *   media probes with positive controls are owned by T1.9; until those
 *   samples ship, those roles probe-fail honestly (`mediaProbePending`) and
 *   the capability stays OFF — never a fake pass.
 * - The embed role is NOT a probe target here: the built-in engine is covered
 *   by the boot/embed conformance path (T1.0/T1.1a), not the wizard surface.
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

// The wizard/admin-test probe surface: embed is deliberately absent (built-in
// engine needs no config; docs/spec/server/routes/setup.md §2.4a).
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
 * The `llm` probe handler. Body: `{ role, baseUrl, apiKey, model }` (setup.md
 * §2.4a fourth target shape). Success `{ ok: true, role, reason: null }`;
 * failures throw the classified probe error the routes map to the envelope.
 * Every terminal outcome is reported to the `ai.<role>` tracker row.
 */
async function probeLlm(body) {
  const { role, baseUrl, apiKey, model } = body || {};
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
    } else {
      // vision/asr: real in-domain media samples are T1.9-owned (positive
      // controls per §4.23.2). Synthetic probes are banned — fail honestly.
      throw probeError(
        SETUP_TEST_FAILED_CODE,
        HTTP_STATUS.BAD_REQUEST,
        'Connection test failed',
        'mediaProbePending'
      );
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

module.exports = { ensureLlmProbeTarget, probeLlm, PROBE_ROLES };
