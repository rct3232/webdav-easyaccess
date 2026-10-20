'use strict';

/**
 * AiTagRepository — domain interface over `ai_tag_raw`
 * (docs/spec/server/store/aiTagStore.md): materialized LOCAL DERIVED tags,
 * stored already-folded (T0.9 surface). NO normalization happens here: the
 * caller passes orthographically folded tags (§4.18 — a pure function, e.g.
 * domains/ai/tagVocabulary.foldTag). No journal, no locks (§2.4).
 *
 * @typedef {Object} AiTagRepository
 * @property {'sqlite'|'postgres'} dialect
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
