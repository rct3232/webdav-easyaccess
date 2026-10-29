'use strict';

/**
 * Per-kind AI job generation counters (docs/spec/server/services/
 * aiJobService.md §2.2). These are INTERNAL settings rows (`AI_GEN_<KIND>`),
 * not config-registry keys and not exposed on the admin config surface.
 *
 * The commit hook resolves the current counter per kind through
 * `generationFor(kind)`; the admin re-embed launcher bumps embed / features /
 * caption / asr to the SAME next N inside its settings-journal transaction.
 */

const settingsStore = require('../../store/settingsStore');

const GENERATION_KINDS = Object.freeze(['embed', 'features', 'caption', 'asr']);
const DEFAULT_GENERATION = 1;

function generationKey(kind) {
  const normalized = String(kind || '').toLowerCase();
  if (!GENERATION_KINDS.includes(normalized)) {
    throw new TypeError(`unknown AI job kind '${kind}'`);
  }
  return `AI_GEN_${normalized.toUpperCase()}`;
}

function normalizeGeneration(raw) {
  const value = Number(raw);
  return Number.isInteger(value) && value >= DEFAULT_GENERATION ? value : DEFAULT_GENERATION;
}

/**
 * Current generation for one kind (default 1). Never throws for a missing or
 * malformed row: the default is the shipped behavior.
 *
 * @param {'embed'|'features'|'caption'|'asr'} kind
 * @returns {Promise<number>}
 */
async function getGeneration(kind, { store = settingsStore } = {}) {
  const raw = await store.get(generationKey(kind));
  return normalizeGeneration(raw);
}

/** Current generation map for the panel / launcher preview. */
async function getGenerations({ store = settingsStore } = {}) {
  const out = {};
  for (const kind of GENERATION_KINDS) {
    // eslint-disable-next-line no-await-in-loop
    out[kind] = await getGeneration(kind, { store });
  }
  return out;
}

/**
 * Bump every requested kind to ONE next generation inside a caller-owned TX.
 * N = max(current generations across the requested kinds) + 1, so the kinds
 * stay aligned even if a historical row drifted. Reads/writes use the
 * tx-bound SettingsRepository methods (Settings.set opens its own TX and must
 * never be nested).
 *
 * @param {Object} tx executor transaction handle
 * @param {string[]} [kinds]
 * @param {{ store?: Object }} [options]
 * @returns {Promise<Record<string, number>>}
 */
async function bumpGenerationsTx(tx, kinds = GENERATION_KINDS, { store = settingsStore } = {}) {
  const selected = [...new Set(kinds.map((kind) => String(kind).toLowerCase()))];
  for (const kind of selected) generationKey(kind); // validate before any write

  let max = DEFAULT_GENERATION;
  for (const kind of selected) {
    // eslint-disable-next-line no-await-in-loop
    const current = normalizeGeneration(await store.getTx(tx, generationKey(kind)));
    if (current > max) max = current;
  }
  const next = max + 1;
  for (const kind of selected) {
    // eslint-disable-next-line no-await-in-loop
    await store.setTx(tx, generationKey(kind), String(next));
  }
  return Object.fromEntries(selected.map((kind) => [kind, next]));
}

module.exports = {
  GENERATION_KINDS,
  DEFAULT_GENERATION,
  generationKey,
  getGeneration,
  getGenerations,
  bumpGenerationsTx,
};
