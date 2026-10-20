'use strict';

/**
 * AiEnrichmentsRepository — domain interface over the `ai_enrichments` table
 * (docs/spec/server/store/aiEnrichmentsStore.md). Stores AI-derived
 * descriptive metadata per node. `tags` stores FREE descriptive words only
 * (PLAN §19 — no vocabulary/tag_parents/tag_embeddings code paths).
 */

/**
 * @typedef {Object} AiEnrichmentsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(nodeId: number) => Promise<Object|null>} get
 * @property {(nodeIds: number[]) => Promise<Object[]>} getByNodeIds
 * @property {(nodeId: number, patch: Object) => Promise<{ changes: number }>} upsert
 * @property {(nodeId: number) => Promise<{ changes: number }>} delete
 * @property {(modelColumn: string, modelId: number, opts?: Object) => Promise<Object[]>} listByModel
 * @property {(modelColumn: string, modelId: number) => Promise<number>} countByModel
 */

/**
 * Creates an AiEnrichmentsRepository based on the database dialect.
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {AiEnrichmentsRepository}
 */
module.exports = function createAiEnrichmentsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createAiEnrichmentsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/AiEnrichmentsRepository.sqlite')
      : require('./postgres/AiEnrichmentsRepository.postgres');
  return impl(executor);
};
