'use strict';

/**
 * Effective AI capability state (llmAdapter.md §2.4 — "probe is authority").
 *
 * The llmAdapter publishes the output of `evaluateCapabilityMatrix` here after
 * every probe; consumers (the enrichment hook's decision table, admin
 * surfaces) read the EFFECTIVE set — never raw config presence. A declared
 * capability that was never probed or failed is OFF, and carries a warning row
 * for the admin card.
 *
 * Process-wide by design (same idiom as getSharedResolver/getLlmAdapter): the
 * adapter instance is created by boot wiring, the hook is composed separately,
 * and both must observe the same verdicts. `reset()` is the test seam.
 */

const ROLE_CAPABILITY = Object.freeze({
  embed: 'text_embed',
  chat: 'chat',
  vision: 'vision_chat',
  asr: 'asr',
});

const CAPABILITIES = Object.freeze([
  'text_embed',
  'image_embed',
  'audio_embed',
  'video_embed',
  'chat',
  'vision_chat',
  'asr',
]);

/** capability → matrix row `{ capability, declared, probed, enabled, note, reason? }` */
let entries = new Map();
/** role → warning `{ role, capability, code, reason, hint }` */
let warnings = new Map();

function emptyEntry(capability) {
  return {
    capability,
    declared: false,
    probed: false,
    enabled: false,
    note: null,
    reason: null,
  };
}

/**
 * Publish one role's matrix row. A declared-but-OFF capability (not probed or
 * probe-failed) records a warning for the role; any enabled/undeclared state
 * clears the previous warning.
 *
 * @param {'embed'|'chat'|'vision'|'asr'} role
 * @param {object} matrixRow `evaluateCapabilityMatrix` entry (+ optional reason)
 * @returns {object|null} the stored entry
 */
function setRoleCapability(role, matrixRow) {
  const capability = ROLE_CAPABILITY[role];
  if (!capability || !matrixRow) return null;

  const entry = {
    ...emptyEntry(capability),
    ...matrixRow,
    capability,
    role,
    reason: matrixRow.reason ?? null,
  };
  entries.set(capability, entry);

  if (entry.declared && !entry.enabled) {
    warnings.set(role, {
      role,
      capability,
      code: 'probe_failed',
      reason: entry.reason,
      hint: 'serverErrors.ai.providerProbeFailed',
    });
  } else {
    warnings.delete(role);
  }
  return entry;
}

/** A role became unconfigured: its capability is OFF with no probe warning. */
function clearRoleCapability(role) {
  const capability = ROLE_CAPABILITY[role];
  if (!capability) return;
  entries.set(capability, emptyEntry(capability));
  warnings.delete(role);
}

function isCapabilityEnabled(capability) {
  const entry = entries.get(capability);
  return entry ? entry.enabled === true : false;
}

/** Effective role gate consumed by the enrichment hook's decision table. */
function isRoleEnabled(role) {
  const capability = ROLE_CAPABILITY[role];
  return capability ? isCapabilityEnabled(capability) : false;
}

/** The effective set in role terms: `{ embed, chat, vision, asr }`. */
function getEffectiveCapabilities() {
  const out = {};
  for (const role of Object.keys(ROLE_CAPABILITY)) out[role] = isRoleEnabled(role);
  return out;
}

/** The full seven-key matrix (admin card input): undeclared = OFF. */
function getCapabilityEntries() {
  return CAPABILITIES.map((capability) => ({
    ...(entries.get(capability) || emptyEntry(capability)),
  }));
}

/** Declared-but-OFF warnings, one row per role. */
function listWarnings() {
  return [...warnings.values()].map((warning) => ({ ...warning }));
}

/** Test seam: forget every verdict and warning. */
function reset() {
  entries = new Map();
  warnings = new Map();
}

module.exports = {
  ROLE_CAPABILITY,
  CAPABILITIES,
  setRoleCapability,
  clearRoleCapability,
  isCapabilityEnabled,
  isRoleEnabled,
  getEffectiveCapabilities,
  getCapabilityEntries,
  listWarnings,
  reset,
};
