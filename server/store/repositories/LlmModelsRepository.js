'use strict';

/**
 * LlmModelsRepository — domain interface over the persistent model registry
 * table `llm_models` (docs/spec/server/store/llmModelsStore.md). The registry
 * is llmAdapter's persisted view (`syncModelRegistry`); rows are never
 * hand-edited except `reasoning` (experiment switch). `llm_models.id` is the
 * MODEL-VERSION key consumed by the embeddings/ai_enrichments/
 * collection_centroids FKs — a model-version change is a NEW row, never an
 * in-place identity mutation.
 *
 * @typedef {Object} LlmModelRow
 * @property {number} id
 * @property {'embed'|'chat'|'vision'|'asr'} role
 * @property {string} provider
 * @property {'embedded'|'remote'} engine
 * @property {string} baseUrlKey  — embedded rows carry '' (no URL)
 * @property {string} modelName
 * @property {string|null} precision  — annotation only (never identity)
 * @property {string|null} modelRevision
 * @property {number|null} maxInputChars
 * @property {number|null} chunkBudget
 * @property {number|null} batchSize
 * @property {'on'|'off'} reasoning
 * @property {boolean} enabled
 * @property {string} createdAt
 *
 * @typedef {LlmModelRow & Record<string, unknown>} ModelSpec
 *
 * @typedef {Object} LlmModelsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(spec: {
 *   role, provider, engine?, baseUrlKey, modelName, precision?, modelRevision?,
 *   maxInputChars?, chunkBudget?, batchSize?, reasoning?, enabled?
 * }) => Promise<{id: number}>} upsertModel
 *   Identity = (role, provider, engine, base_url_key, model_name,
 *   model_revision) with NULL matching only NULL; dedupe via the
 *   in-transaction pre-check (repository-contract rule 4 — the DDL has no
 *   UNIQUE constraint). Existing row: ONLY the non-identity fields
 *   (precision/budgets/reasoning/enabled) are refreshed.
 * @property {(role, id) => Promise<{changes: number}>} activateModel
 *   ONE TX: disable the role's other rows, then enable `id`. The adapter owns
 *   the "one active model per role" invariant through this method.
 * @property {(role) => Promise<{changes: number}>} disableRole
 *   Disable every row of the role without deleting history (unconfigured role).
 * @property {(id) => Promise<LlmModelRow|null>} getModel
 * @property {(role) => Promise<LlmModelRow|null>} getActiveByRole
 *   The ENABLED row of the role; several enabled rows ⇒ highest id wins
 *   (most recently provisioned) — deterministic read; the adapter owns the
 *   "one active model per role" invariant via activateModel/disableRole.
 * @property {(role) => Promise<LlmModelRow[]>} listByRole
 *   Registry history of the role, id ASC (admin panel display).
 * @property {(id, 'on'|'off') => Promise<{changes: number}>} setReasoning
 *   The single sanctioned hand edit (llmAdapter §2.7); other values are a
 *   TypeError BEFORE SQL.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {LlmModelsRepository}
 */
module.exports = function createLlmModelsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createLlmModelsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/LlmModelsRepository.sqlite')
      : require('./postgres/LlmModelsRepository.postgres');
  return impl(executor);
};
