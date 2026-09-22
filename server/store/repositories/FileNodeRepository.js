'use strict';

/**
 * FileNodeRepository — domain interface over `file_nodes`, `node_ancestors`,
 * `object_map` and `filecache` (docs/spec/server/store/
 * repository-contract.md).
 *
 * The method set mirrors the former `createFileNodesStore()` factory exactly
 * (facade parity). Node rows are domain-shaped (`{ id, parentId, name, type,
 * syncStatus, createdAt, updatedAt, deletedAt }`); children additionally carry
 * the filecache columns (`size`, `mimeType`, `contentHash`). Trash (DEF-16):
 * `getNode`/`getChildren`/`resolvePathSegment` are live-row reads
 * (`deleted_at IS NULL`); `getNodeIncludingTrashed`, `getTrashChildren`,
 * `getTopmostTrashedNodes` and `markSubtreeDeleted` are the trash-aware surface.
 *
 * @typedef {Object} FileNodeRepository
 * @property {(parentId: number|null, name: string, type: 'file'|'directory') => Promise<Object>} createNode
 * @property {(id) => Promise<Object|null>} getNode
 * @property {(id) => Promise<Object|null>} getNodeIncludingTrashed
 * @property {(parentId: number|null) => Promise<Array<Object>>} getChildren
 * @property {(parentId: number|null) => Promise<Array<Object>>} getTrashChildren
 * @property {(olderThanDays?: number) => Promise<Array<Object>>} getTopmostTrashedNodes
 * @property {(nodeIds: number[]) => Promise<{ changes: number }>} markSubtreeDeleted
 * @property {(nodeIds: number[]) => Promise<{ changes: number }>} untrashSubtree
 * @property {(id, newName) => Promise<{ changes: number }>} renameNode
 * @property {(id, newParentId) => Promise<{ changes: number }>} moveNode
 * @property {(nodeIds: number[]) => Promise<{ changes: number }>} deleteNodeTree
 * @property {(id, status) => Promise<{ changes: number }>} updateSyncStatus
 * @property {(parentId: number|null, name: string) => Promise<{ id: number }|null>} resolvePathSegment
 * @property {(rows: Array<{ ancestorId, descendantId, depth }>) => Promise<{ changes: number }>} insertAncestorRows
 * @property {(descendantIds: number[]) => Promise<{ changes: number }>} deleteAncestorByDescendant
 * @property {(ancestorId) => Promise<number[]>} getDescendantIds
 * @property {(ancestorId) => Promise<Array<Object>>} getDescendants
 * @property {(descendantId) => Promise<Array<{ ancestorId: number, depth: number }>>} getAncestorChain
 * @property {(ancestorId, descendantId) => Promise<boolean>} isAncestor
 * @property {(userId) => Promise<Object|null>} getUserRootNode
 * @property {(fileNodeId, s3Key, status) => Promise<{ changes: number }>} upsertObjectMap
 * @property {(fileNodeId, s3Key, status) => Promise<{ changes: number }>} insertObject
 * @property {(fileNodeId) => Promise<Object|null>} getActiveObject
 * @property {(fileNodeId) => Promise<Array<Object>>} getObjectMapByNode
 * @property {(ancestorId) => Promise<Array<Object>>} getObjectMapBySubtree
 * @property {(fileNodeId) => Promise<Array<Object>>} getVersionsByNode
 * @property {(fileNodeId, cap) => Promise<{ changes: number }>} evictVersionsBeyondCap
 * @property {(s3Key) => Promise<Object|null>} getObjectMapByS3Key
 * @property {(s3Key) => Promise<{ changes: number }>} activateObject
 * @property {(s3Key) => Promise<{ changes: number }>} orphanObject
 * @property {(s3Key) => Promise<{ changes: number }>} demoteActiveToHistory
 * @property {(id) => Promise<{ changes: number }>} reactivateObjectMapRow
 * @property {(s3Key) => Promise<number>} countActiveObjectsByS3Key
 * @property {(fileNodeId) => Promise<{ changes: number }>} setObjectMapBackendWebdav
 * @property {(fileNodeId, size, mimeType, contentHash) => Promise<{ changes: number }>} upsertCache
 * @property {(fileNodeId) => Promise<Object|null>} getCache
 * @property {() => Promise<number>} countCacheRowsWithNullContentHash
 * @property {({ limit?: number, afterId?: number }) => Promise<Array<{ nodeId: number, name: string, type: 'file', deletedAt: string|null }>>} listCacheRowsWithNullContentHash
 *   Content-hash completeness surface (T0.1/T0.8): file rows with a NULL
 *   `filecache.content_hash`, ascending by node id; keyset-paginated via
 *   `afterId` (rows with nodeId > afterId) so the streaming backfill never
 *   re-fetches rows it failed on.
 * @property {(userId: number, query: string, opts?: { limit?: number }) => Promise<Array<{ id: number, name: string }>>} searchNodesByName
 *   Name-section search surface (T0.11, searchService.md §2.5): live rows the
 *   requester can read (own-root subtree ∪ path-granted subtrees ∪ point
 *   grants), `lower(name) LIKE lower('%q%')` whole-string containment,
 *   ordered `name` asc then `node_id` asc, capped by `opts.limit`.
 * @property {(userId: number, n: number) => Promise<number[]>} sampleVisibleNodeIds
 *   Random sample of at most n requester-visible live node ids (searchService
 *   §2.5 — per-query dynamic-baseline corpus sample, P1).
 * @property {(fileNodeId, contentHash) => Promise<{ changes: number }>} setCacheContentHash
 *   Idempotent write — `WHERE content_hash IS NULL` only; `changes` reports
 *   whether the row was touched.
 * @property {() => Promise<string[]>} getKeptObjectMapKeys
 * @property {() => Promise<Array<Object>>} getFileNodesPathRows
 * @property {(olderThanDays: number) => Promise<Array<Object>>} getOrphanedObjectsWithNodeState
 * @property {(staleThanDays: number) => Promise<Array<Object>>} getStalePendingObjects
 * @property {(ids: number[]) => Promise<{ changes: number }>} deleteObjectMapRows
 * @property {(status) => Promise<Array<Object>>} getNodesBySyncStatus
 * @property {(status) => Promise<Array<Object>>} getNodesBySyncStatusNot
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {FileNodeRepository}
 */
module.exports = function createFileNodeRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createFileNodeRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/FileNodeRepository.sqlite')
      : require('./postgres/FileNodeRepository.postgres');
  return impl(executor);
};
