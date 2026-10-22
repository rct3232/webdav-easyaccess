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

function isSet(value) {
  return value !== undefined && value !== null && String(value).trim() !== '';
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

module.exports = { createBootPresetFor, createBootProbeRole };
