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
    getNodeIncludingTrashed: (...args) => repo.getNodeIncludingTrashed(...args),
    getChildren: (...args) => repo.getChildren(...args),
    getTrashChildren: (...args) => repo.getTrashChildren(...args),
    getTopmostTrashedNodes: (...args) => repo.getTopmostTrashedNodes(...args),
    markSubtreeDeleted: (...args) => repo.markSubtreeDeleted(...args),
    untrashSubtree: (...args) => repo.untrashSubtree(...args),
    renameNode: (...args) => repo.renameNode(...args),
    moveNode: (...args) => repo.moveNode(...args),
    deleteNodeTree: (...args) => repo.deleteNodeTree(...args),
    updateSyncStatus: (...args) => repo.updateSyncStatus(...args),
    resolvePathSegment: (...args) => repo.resolvePathSegment(...args),
    insertAncestorRows: (...args) => repo.insertAncestorRows(...args),
    deleteAncestorByDescendant: (...args) => repo.deleteAncestorByDescendant(...args),
    getDescendantIds: (...args) => repo.getDescendantIds(...args),
    getDescendants: (...args) => repo.getDescendants(...args),
    getAncestorChain: (...args) => repo.getAncestorChain(...args),
    isAncestor: (...args) => repo.isAncestor(...args),
    getUserRootNode: (...args) => repo.getUserRootNode(...args),
    upsertObjectMap: (...args) => repo.upsertObjectMap(...args),
    insertObject: (...args) => repo.insertObject(...args),
    getActiveObject: (...args) => repo.getActiveObject(...args),
    getObjectMapByNode: (...args) => repo.getObjectMapByNode(...args),
    getObjectMapBySubtree: (...args) => repo.getObjectMapBySubtree(...args),
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
    getKeptObjectMapKeys: (...args) => repo.getKeptObjectMapKeys(...args),
    getFileNodesPathRows: (...args) => repo.getFileNodesPathRows(...args),

    /**
     * Single keep-set seam for GC Tier 2, in the ACTIVE backend's key space.
     * s3: object_map keys. webdav: display-path materialization from the
     * file_nodes projection (see gcService.md §2 for the exact arms).
     */
    async getKeptKeys(storageMode) {
      if (storageMode !== 'webdav') {
        return new Set(await repo.getKeptObjectMapKeys());
      }
      const rows = await repo.getFileNodesPathRows();
      const byId = new Map(rows.map((r) => [Number(r.id), r]));
      const displayPath = (row) => {
        const segments = [];
        let cur = row;
        const seen = new Set();
        while (cur && !seen.has(Number(cur.id))) {
          seen.add(Number(cur.id));
          segments.unshift(String(cur.name));
          cur = cur.parent_id == null ? null : byId.get(Number(cur.parent_id));
        }
        return '/' + segments.join('/');
      };
      // Canonical forms: directories WITH trailing slash, files bare. Trash/
      // tmp entries can be either (a trashed file travels as a bare object,
      // a trashed collection as a directory) — store both forms so the diff
      // matches either adapter emission.
      const kept = new Set(['/', '/.wea-trash/', '/.wea-tmp/']);
      for (const row of rows) {
        const trashed = row.deleted_at != null;
        if (!trashed) {
          const path = displayPath(row);
          kept.add(row.type === 'directory' ? `${path}/` : path);
          // every ancestor directory of a live node is live by definition
          let idx = path.indexOf('/', 1);
          while (idx !== -1) {
            kept.add(path.slice(0, idx + 1));
            idx = path.indexOf('/', idx + 1);
          }
        } else {
          kept.add(`/.wea-trash/${Number(row.id)}`);
          kept.add(`/.wea-trash/${Number(row.id)}/`);
        }
        if (trashed || row.sync_status === 'orphaned_node') {
          kept.add(`/.wea-tmp/${Number(row.id)}`);
          kept.add(`/.wea-tmp/${Number(row.id)}/`);
        }
      }
      return kept;
    },
    getOrphanedObjectsWithNodeState: (...args) => repo.getOrphanedObjectsWithNodeState(...args),
    getStalePendingObjects: (...args) => repo.getStalePendingObjects(...args),
    deleteObjectMapRows: (...args) => repo.deleteObjectMapRows(...args),
    getNodesBySyncStatus: (...args) => repo.getNodesBySyncStatus(...args),
    getNodesBySyncStatusNot: (...args) => repo.getNodesBySyncStatusNot(...args),
  };
}

module.exports = { createFileNodesStore };
