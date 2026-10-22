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

/**
 * Capabilities published together per role. The embed role owns the four
 * embedding sub-capabilities (media probes toggle only their own row).
 */
const ROLE_CAPABILITIES = Object.freeze({
  embed: ['text_embed', 'image_embed', 'audio_embed', 'video_embed'],
  chat: ['chat'],
  vision: ['vision_chat'],
  asr: ['asr'],
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

  setWarning(role, capability, entry);
  return entry;
}

function setWarning(role, capability, entry) {
  const key = `${role}:${capability}`;
  if (entry.declared && !entry.enabled) {
    warnings.set(key, {
      role,
      capability,
      code: 'probe_failed',
      reason: entry.reason,
      hint: 'serverErrors.ai.providerProbeFailed',
    });
  } else {
    warnings.delete(key);
  }
}

/**
 * Publish a whole role's capability rows (embed = text + the three media
 * sub-capabilities). Rows absent from `rows` are NOT silently kept: the roles'
 * capability set is replaced, so a probe pass that no longer includes a media
 * capability leaves it OFF.
 *
 * @param {'embed'|'chat'|'vision'|'asr'} role
 * @param {Array<object>} rows `evaluateCapabilityMatrix` entries (+ optional reason)
 * @returns {object[]} stored entries
 */
function setRoleCapabilities(role, rows) {
  const owned = ROLE_CAPABILITIES[role];
  if (!owned) return [];
  const byCapability = new Map((rows || []).map((row) => [row.capability, row]));
  const stored = [];
  for (const capability of owned) {
    const row = byCapability.get(capability);
    if (!row) {
      // Not probed in this pass: OFF, and a declared expectation warns.
      const empty = emptyEntry(capability);
      entries.set(capability, { ...empty, role });
      setWarning(role, capability, empty);
      continue;
    }
    const entry = {
      ...emptyEntry(capability),
      ...row,
      capability,
      role,
      reason: row.reason ?? null,
    };
    entries.set(capability, entry);
    setWarning(role, capability, entry);
    stored.push(entry);
  }
  return stored;
}

/** A role became unconfigured: its capabilities are OFF with no probe warning. */
function clearRoleCapability(role) {
  const owned = ROLE_CAPABILITIES[role] || [];
  for (const capability of owned) {
    entries.set(capability, emptyEntry(capability));
    warnings.delete(`${role}:${capability}`);
  }
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
  ROLE_CAPABILITIES,
  CAPABILITIES,
  setRoleCapability,
  setRoleCapabilities,
  clearRoleCapability,
  isCapabilityEnabled,
  isRoleEnabled,
  getEffectiveCapabilities,
  getCapabilityEntries,
  listWarnings,
  reset,
};
