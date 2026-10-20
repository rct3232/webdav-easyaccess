'use strict';

/**
 * Shared row shaping for the LlmModelsRepository dialect twins
 * (docs/spec/server/store/llmModelsStore.md). The DDL has no `dim` column —
 * dim lives in the preset profile and on embeddings rows; nothing here
 * reads or writes one.
 */

const { toIsoString } = require('../../utils/sharedHelpers');

const ROLES = ['embed', 'chat', 'vision', 'asr'];
const ENGINES = ['embedded', 'remote'];

/** Driver row → domain-shaped registry row (numbers, booleans, ISO stamps). */
function mapModelRow(row) {
  return {
    id: Number(row.id),
    role: String(row.role),
    provider: String(row.provider),
    engine: String(row.engine),
    baseUrlKey: row.base_url_key === null ? null : String(row.base_url_key),
    modelName: String(row.model_name),
    precision: row.precision === null || row.precision === undefined ? null : String(row.precision),
    modelRevision:
      row.model_revision === null || row.model_revision === undefined
        ? null
        : String(row.model_revision),
    maxInputChars:
      row.max_input_chars === null || row.max_input_chars === undefined
        ? null
        : Number(row.max_input_chars),
    chunkBudget:
      row.chunk_budget === null || row.chunk_budget === undefined
        ? null
        : Number(row.chunk_budget),
    batchSize:
      row.batch_size === null || row.batch_size === undefined ? null : Number(row.batch_size),
    reasoning: String(row.reasoning),
    enabled: Number(row.enabled ? 1 : 0) === 1,
    createdAt: toIsoString(row.created_at),
  };
}

/**
 * Validate the required identity fields before SQL (§2.5); returns the
 * normalized spec (engine/reasoning/enabled defaults applied).
 */
function normalizeModelSpec(spec) {
  if (!spec || typeof spec !== 'object') throw new TypeError('upsertModel requires a spec object');
  for (const field of ['role', 'provider', 'baseUrlKey', 'modelName']) {
    if (typeof spec[field] !== 'string') {
      throw new TypeError(`upsertModel requires a string '${field}'`);
    }
  }
  for (const field of ['role', 'provider', 'modelName']) {
    if (!spec[field]) {
      throw new TypeError(`upsertModel requires a non-empty string '${field}'`);
    }
  }
  // baseUrlKey MAY be '' — embedded rows carry no URL (llmModelsStore §1).
  const engine = spec.engine === undefined || spec.engine === null ? 'remote' : spec.engine;
  if (!ENGINES.includes(engine)) throw new TypeError(`invalid engine '${engine}'`);
  if (!ROLES.includes(spec.role)) throw new TypeError(`invalid role '${spec.role}'`);
  return {
    role: spec.role,
    provider: spec.provider,
    engine,
    baseUrlKey: spec.baseUrlKey,
    modelName: spec.modelName,
    precision: spec.precision ?? null,
    modelRevision: spec.modelRevision ?? null,
    maxInputChars: spec.maxInputChars ?? null,
    chunkBudget: spec.chunkBudget ?? null,
    batchSize: spec.batchSize ?? null,
    reasoning: spec.reasoning === undefined || spec.reasoning === null ? 'off' : spec.reasoning,
    enabled: spec.enabled === undefined || spec.enabled === null ? true : Boolean(spec.enabled),
  };
}

module.exports = { ROLES, ENGINES, mapModelRow, normalizeModelSpec };
