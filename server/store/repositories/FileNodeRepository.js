'use strict';

/**
 * FileNodeRepository — domain interface over `file_nodes`, `node_ancestors`,
 * `object_map` and `filecache` (docs/spec/server/store/
 * repository-contract.md).
 *
 * The method set mirrors the former `createFileNodesStore()` factory exactly
 * (facade parity). Node rows are domain-shaped (`{ id, parentId, name, type,
 * syncStatus, createdAt, updatedAt }`); children additionally carry the
 * filecache columns (`size`, `mimeType`, `contentHash`).
 *
 * @typedef {Object} FileNodeRepository
 * @property {(parentId: number|null, name: string, type: 'file'|'directory') => Promise<Object>} createNode
 * @property {(id) => Promise<Object|null>} getNode
 * @property {(parentId: number|null) => Promise<Array<Object>>} getChildren
 * @property {(id, newName) => Promise<{ changes: number }>} renameNode
 * @property {(id, newParentId) => Promise<{ changes: number }>} moveNode
 * @property {(nodeIds: number[]) => Promise<{ changes: number }>} deleteNodeTree
 * @property {(id, status) => Promise<{ changes: number }>} updateSyncStatus
 * @property {(parentId: number|null, name: string) => Promise<{ id: number }|null>} resolvePathSegment
 * @property {(rows: Array<{ ancestorId, descendantId, depth }>) => Promise<{ changes: number }>} insertAncestorRows
 * @property {(descendantIds: number[]) => Promise<{ changes: number }>} deleteAncestorByDescendant
 * @property {(ancestorIds: number[]) => Promise<{ changes: number }>} deleteAncestorByAncestor
 * @property {(ancestorId) => Promise<number[]>} getDescendantIds
 * @property {(ancestorId) => Promise<Array<Object>>} getDescendants
 * @property {(descendantId) => Promise<Array<{ ancestorId: number, depth: number }>>} getAncestorChain
 * @property {(ancestorId, descendantId) => Promise<boolean>} isAncestor
 * @property {(userId) => Promise<Object|null>} getUserRootNode
 * @property {(fileNodeId, s3Key, status) => Promise<{ changes: number }>} upsertObjectMap
 * @property {(fileNodeId, s3Key, status) => Promise<{ changes: number }>} insertObject
 * @property {(fileNodeId) => Promise<Object|null>} getActiveObject
 * @property {(fileNodeId) => Promise<Array<Object>>} getObjectMapByNode
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
 * @property {(fileNodeId) => Promise<{ changes: number }>} deleteCache
 * @property {(olderThanDays: number) => Promise<Array<Object>>} getOrphanedObjects
 * @property {() => Promise<string[]>} getAllActiveS3Keys
 * @property {() => Promise<string[]>} getKeptS3Keys
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
