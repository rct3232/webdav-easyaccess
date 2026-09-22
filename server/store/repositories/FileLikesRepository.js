'use strict';

/**
 * FileLikesRepository — domain interface over the `file_likes` table
 * (docs/spec/server/store/fileLikesStore.md). Viewer-scoped per-file likes;
 * PK (user_id, node_id), node_id FK CASCADE. NO journal writes (self-reversing
 * trivial state, §4.11). Deliberately absent: any cross-user aggregation
 * (invariant 9).
 *
 * @typedef {Object} FileLikesRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(userId, nodeId) => Promise<boolean>} isLiked
 * @property {(userId) => Promise<number[]>} listLikedNodeIds
 *   All liked node ids of the viewer (order: node_id asc).
 * @property {(userId, nodeIds: number[]) => Promise<number[]>} filterLiked
 *   Intersection with the viewer's own likes; input order preserved.
 * @property {(userId, nodeId) => Promise<{ changes: number }>} addLike
 *   Idempotent INSERT ON CONFLICT DO NOTHING on the PK pair.
 * @property {(userId, nodeId) => Promise<{ changes: number }>} removeLike
 *   DELETE by pair; unliked removal → changes: 0.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {FileLikesRepository}
 */
module.exports = function createFileLikesRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createFileLikesRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/FileLikesRepository.sqlite')
      : require('./postgres/FileLikesRepository.postgres');
  return impl(executor);
};
