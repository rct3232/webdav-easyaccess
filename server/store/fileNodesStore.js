'use strict';

/**
 * Factory: create a file-nodes store bound to the active backend.
 *
 * Facade over FileNodeRepository (docs/spec/server/store/
 * repository-contract.md) — the public method set is unchanged for all
 * consumers (services, ancestry helper, GC, tests).
 */
const storage = require('./storage');
const createFileNodeRepository = require('./repositories/FileNodeRepository');

// One repository per dialect; `getExecutor()` switches on the active backend
// (including the jest test-only override).
const reposByDialect = new Map();

function getRepository() {
  const executor = storage.getExecutor();
  let repo = reposByDialect.get(executor.dialect);
  if (!repo) {
    repo = createFileNodeRepository(executor);
    reposByDialect.set(executor.dialect, repo);
  }
  return repo;
}

function createFileNodesStore() {
  const repo = getRepository();
  return {
    createNode: (...args) => repo.createNode(...args),
    getNode: (...args) => repo.getNode(...args),
    getChildren: (...args) => repo.getChildren(...args),
    renameNode: (...args) => repo.renameNode(...args),
    moveNode: (...args) => repo.moveNode(...args),
    deleteNodeTree: (...args) => repo.deleteNodeTree(...args),
    updateSyncStatus: (...args) => repo.updateSyncStatus(...args),
    resolvePathSegment: (...args) => repo.resolvePathSegment(...args),
    insertAncestorRows: (...args) => repo.insertAncestorRows(...args),
    deleteAncestorByDescendant: (...args) => repo.deleteAncestorByDescendant(...args),
    deleteAncestorByAncestor: (...args) => repo.deleteAncestorByAncestor(...args),
    getDescendantIds: (...args) => repo.getDescendantIds(...args),
    getDescendants: (...args) => repo.getDescendants(...args),
    getAncestorChain: (...args) => repo.getAncestorChain(...args),
    isAncestor: (...args) => repo.isAncestor(...args),
    getUserRootNode: (...args) => repo.getUserRootNode(...args),
    upsertObjectMap: (...args) => repo.upsertObjectMap(...args),
    insertObject: (...args) => repo.insertObject(...args),
    getActiveObject: (...args) => repo.getActiveObject(...args),
    getObjectMapByNode: (...args) => repo.getObjectMapByNode(...args),
    getVersionsByNode: (...args) => repo.getVersionsByNode(...args),
    evictVersionsBeyondCap: (...args) => repo.evictVersionsBeyondCap(...args),
    getObjectMapByS3Key: (...args) => repo.getObjectMapByS3Key(...args),
    activateObject: (...args) => repo.activateObject(...args),
    orphanObject: (...args) => repo.orphanObject(...args),
    demoteActiveToHistory: (...args) => repo.demoteActiveToHistory(...args),
    reactivateObjectMapRow: (...args) => repo.reactivateObjectMapRow(...args),
    countActiveObjectsByS3Key: (...args) => repo.countActiveObjectsByS3Key(...args),
    setObjectMapBackendWebdav: (...args) => repo.setObjectMapBackendWebdav(...args),
    upsertCache: (...args) => repo.upsertCache(...args),
    getCache: (...args) => repo.getCache(...args),
    deleteCache: (...args) => repo.deleteCache(...args),
    getOrphanedObjects: (...args) => repo.getOrphanedObjects(...args),
    getAllActiveS3Keys: (...args) => repo.getAllActiveS3Keys(...args),
    getKeptS3Keys: (...args) => repo.getKeptS3Keys(...args),
    getOrphanedObjectsWithNodeState: (...args) => repo.getOrphanedObjectsWithNodeState(...args),
    getStalePendingObjects: (...args) => repo.getStalePendingObjects(...args),
    deleteObjectMapRows: (...args) => repo.deleteObjectMapRows(...args),
    getNodesBySyncStatus: (...args) => repo.getNodesBySyncStatus(...args),
    getNodesBySyncStatusNot: (...args) => repo.getNodesBySyncStatusNot(...args),
  };
}

module.exports = { createFileNodesStore };
