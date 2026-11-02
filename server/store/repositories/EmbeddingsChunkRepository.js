'use strict';

/**
 * EmbeddingsChunkRepository — domain interface over the `embeddings_chunk`
 * table (docs/spec/server/store/embeddingsChunkStore.md): per-node chunk
 * vectors keyed by the composite PK (node_id, chunk_idx). `model_id` is the
 * embedding-space key (same rule as the pooled store). A node's chunk set is
 * only valid as a whole, so `replaceChunks` — wholesale DELETE + INSERT in
 * one TX — is the only write; no partial chunk updates.
 *
 * @typedef {Object} ChunkEmbeddingRow
 * @property {number} nodeId
 * @property {number} chunkIdx
 * @property {number} modelId
 * @property {number[]} vector
 * @property {string|null} updatedAt
 *
 * @typedef {Object} EmbeddingsChunkRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(nodeId: number, chunkIdx: number) => Promise<ChunkEmbeddingRow|null>} get
 * @property {(nodeId: number, opts?: { modelId?: number }) => Promise<ChunkEmbeddingRow[]>} listByNode
 *   All chunks of a node, `chunkIdx` ASC; optional model-space read filter.
 * @property {(nodeId: number, modelId: number, chunks: Array<{ chunkIdx: number, vector: number[]|string }>) => Promise<{ inserted: number }>} replaceChunks
 *   ONE TX: DELETE the node's rows for the incoming `model_id` (that space's
 *   set for the node) + INSERT the given set. A cross-space write landing on
 *   an existing `(node_id, chunk_idx)` position claims it via the PK upsert
 *   (newer space wins); rows of OTHER models at non-colliding indices are
 *   untouched. Re-chunking within one model replaces that model's whole set.
 *   Vectors are validated/serialized BEFORE the TX (never stored half-written).
 * @property {(nodeId: number) => Promise<{ changes: number }>} deleteByNode
 *   Missing rows → { changes: 0 }.
 * @property {(modelId: number) => Promise<{ changes: number }>} deleteSpace
 *   Retire a whole embedding space.
 * @property {(nodeId: number, opts?: { modelId?: number }) => Promise<number>} countByNode
 * @property {(modelId: number, opts?: { afterNodeId?: number, afterChunkIdx?: number, limit?: number }) => Promise<ChunkEmbeddingRow[]>} listAllByModel
 *   Row-level keyset over (node_id, chunk_idx): rows strictly after the
 *   cursor `(afterNodeId, afterChunkIdx)` (afterChunkIdx defaults to -1 —
 *   resume from that node's first row), ORDER BY node_id, chunk_idx.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {EmbeddingsChunkRepository}
 */
module.exports = function createEmbeddingsChunkRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createEmbeddingsChunkRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/EmbeddingsChunkRepository.sqlite')
      : require('./postgres/EmbeddingsChunkRepository.postgres');
  return impl(executor);
};
