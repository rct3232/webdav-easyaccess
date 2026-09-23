'use strict';

/**
 * AiTagRepository — domain interface over the tag-vocabulary tables
 * (docs/spec/server/store/aiTagStore.md): `tag_embeddings` (provider-global,
 * model-keyed tag→vector cache), `tag_parents` (display/grouping hints,
 * non-destructive) and `ai_tag_raw` (materialized folded tag→node grouping
 * aid — T0.9 surface, spec §2.4.5). NO normalization happens here: the caller
 * passes orthographically folded tags (§4.18 — a pure function, e.g.
 * domains/ai/tagVocabulary.foldTag). No journal, no locks (§2.5).
 *
 * @typedef {Object} TagEmbeddingRow
 * @property {string} tag
 * @property {number} modelId
 * @property {number} dim
 * @property {number[]} vector
 * @property {string|null} updatedAt
 *
 * @typedef {Object} TagParentRow
 * @property {string} child
 * @property {string} parent
 * @property {'auto'|'admin'} source
 * @property {string|null} createdAt
 *
 * @typedef {Object} AiTagRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(tag, modelId) => Promise<TagEmbeddingRow|null>} getTagVector
 * @property {(tags, modelId) => Promise<TagEmbeddingRow[]>} getTagVectors
 *   Batch read; missing tags absent from the result.
 * @property {(tags, modelId) => Promise<string[]>} findTagsWithoutEmbedding
 *   Vocabulary-set minus cache, INPUT ORDER preserved (E3 batch input).
 * @property {(tag, modelId, vector: number[]|string) => Promise<{ changes: number }>} upsertTagVector
 *   PK-pair upsert (idempotent).
 * @property {(tx, items: Array<{ tag, vector }>, modelId) => Promise<{ inserted: number }>} upsertTagVectors
 *   Batch upsert in ONE TX; `inserted` counts NEW pairs only.
 * @property {(modelId) => Promise<{ changes: number }>} deleteByModel
 *   Retires a whole embedding space.
 * @property {(child) => Promise<TagParentRow|null>} getParent
 * @property {() => Promise<TagParentRow[]>} listParentHints
 *   Full table (tiny), ORDER BY child.
 * @property {(child, parent) => Promise<{ changes: number }>} upsertAutoParent
 *   INSERT ... ON CONFLICT (child) DO UPDATE ONLY when the existing row is
 *   source='auto' — an admin decision is never overwritten (changes: 0).
 * @property {(child, parent) => Promise<{ changes: number }>} setAdminParent
 *   Unconditional upsert stamping source='admin'.
 * @property {(child) => Promise<{ changes: number }>} deleteParent
 * @property {(nodeId) => Promise<string[]>} listRawTags
 *   Folded tags of one node, ORDER BY tag.
 * @property {(tag) => Promise<number[]>} listNodeIdsByRawTag
 *   Reverse lookup via ai_tag_raw_tag_idx, node_id asc.
 * @property {(tx, nodeId, tags: string[]) => Promise<{ inserted: number }>} replaceRawTags
 *   ONE TX: DELETE the node's rows + INSERT the given set (PK dedup).
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {AiTagRepository}
 */
module.exports = function createAiTagRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createAiTagRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/AiTagRepository.sqlite')
      : require('./postgres/AiTagRepository.postgres');
  return impl(executor);
};
