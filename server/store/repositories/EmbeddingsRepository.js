'use strict';

/**
 * EmbeddingsRepository — domain interface over the `embeddings` table
 * (docs/spec/server/store/embeddingsStore.md). Manages pooled embeddings
 * (node_id is the primary key, model_id is the embedding-space key).
 *
 * @typedef {Object} EmbeddingsRow
 * @property {number} nodeId
 * @property {number} modelId
 * @property {number} dim
 * @property {string} vector Serialized vector text (comma-separated floats).
 * @property {string} source
 * @property {string|null} contentHash
 * @property {string|null} updatedAt
 *
 * @typedef {Object} EmbeddingsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(nodeId: number) => Promise<EmbeddingsRow|null>} get
 *   Fetches a single embedding row by node id.
 * @property {(nodeIds: number[]) => Promise<EmbeddingsRow[]>} getByNodeIds
 *   Batch-fetches embedding rows for multiple nodes, ordered by node_id.
 * @property {(nodeId: number, patch: { modelId: number, dim: number, vector: number[], source: string, contentHash?: string|null }) => Promise<{ changes: number }>} upsert
 *   Inserts or updates a pooled embedding row (ON CONFLICT node_id).
 * @property {(nodeId: number) => Promise<{ changes: number }>} delete
 *   Removes a single embedding row by node id.
 * @property {(nodeIds: number[]) => Promise<{ changes: number }>} deleteMany
 *   Removes multiple embedding rows in one statement.
 * @property {(modelId: number, opts?: { afterNodeId?: number, limit?: number }) => Promise<EmbeddingsRow[]>} listAll
 *   Lists embeddings for a model space, with keyset pagination (node_id > afterNodeId).
 * @property {(modelId: number) => Promise<number>} countByModel
 *   Counts rows in a model space.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {EmbeddingsRepository}
 */
module.exports = function createEmbeddingsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createEmbeddingsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/EmbeddingsRepository.sqlite')
      : require('./postgres/EmbeddingsRepository.postgres');
  return impl(executor);
};
