'use strict';

const storage = require('../store/storage');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError } = require('../utils/errorHandler');
const { createWebdavRemoteOps } = require('./webdavRemoteOps');

const ORPHANED_NODE_ACTIONS = ['retry-delete', 'force-active'];
const PENDING_UPLOAD_ACTIONS = ['complete', 'restore-previous', 'delete', 'auto'];
const REPAIR_ACTIONS = [...ORPHANED_NODE_ACTIONS, ...PENDING_UPLOAD_ACTIONS];

function isNotFoundError(error) {
  if (!error) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  if (error.$metadata && error.$metadata.httpStatusCode === 404) return true;
  const haystack = `${error.name || ''} ${error.message || ''}`;
  return /404|not found|notfound|nosuchkey/i.test(haystack);
}

/**
 * Factory: create a fail-safe recovery service for nodes stuck in
 * sync_status='orphaned_node' or sync_status='pending_upload' (DEF-12/13).
 *
 * @param {Object} opts
 * @param {Object} opts.fileNodeService - fileNodeService (getNode, getNodePath,
 *   deleteNode, updateSyncStatus, getDescendantIds).
 * @param {Object} opts.fileNodesStore - fileNodesStore with getNodesBySyncStatus
 *   and object_map access.
 * @param {Object} [opts.blobStore] - S3BlobStore or WebdavBlobStore adapter
 *   (headBlob/deleteBlob) for remote existence checks and blob cleanup.
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 */
function createFailSafeService({
  fileNodeService,
  fileNodesStore,
  blobStore,
  fileStorageMode = 's3',
}) {
  const remoteOps = createWebdavRemoteOps({ blobStore, fileStorageMode, fileNodeService });

  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  /**
   * Scan for nodes stuck in sync_status='orphaned_node'.
   * @returns {Promise<Array<{ nodeId: number, name: string, type: string, path: string, createdAt: *, updatedAt: * }>>}
   */
  async function scanOrphanedNodes() {
    const nodes = await fileNodesStore.getNodesBySyncStatus('orphaned_node');
    const result = [];
    for (const node of nodes) {
      let path = null;
      try {
        path = await fileNodeService.getNodePath(node.id);
      } catch (error) {
        path = null;
      }
      result.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        path,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      });
    }
    return result;
  }

  /**
   * HEAD the blob for a key; 404-style errors map to null, other errors throw.
   * @returns {Promise<{contentLength: number, contentType: string}|null>}
   */
  async function headBlobOrNull(key) {
    try {
      return await blobStore.headBlob(key);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  /**
   * Scan for file nodes stuck in sync_status='pending_upload' (DEF-12/13).
   * S3 mode only: the stuck pending_upload state is an S3-upload artifact.
   * WebDAV-mode file nodes intentionally keep pending_upload for their whole
   * lifetime (path-addressed backend, fileService.md §4), so scanning there
   * would report every healthy file. Directories are excluded: createNode
   * starts every node as pending_upload and directory nodes intentionally
   * never transition to 'active', so only file nodes are stuck-state
   * candidates. Read-only.
   * @returns {Promise<Array<{ nodeId: number, name: string, type: string, path: string|null, createdAt: *, updatedAt: *, classification: 'overwrite'|'new-file', pendingS3Key: string|null, blobPresent: boolean|null }>>}
   */
  async function scanPendingUploadNodes() {
    if (fileStorageMode !== 's3') {
      return [];
    }
    const nodes = await fileNodesStore.getNodesBySyncStatus('pending_upload');
    const result = [];
    for (const node of nodes) {
      if (node.type !== 'file') continue;

      let path = null;
      try {
        path = await fileNodeService.getNodePath(node.id);
      } catch (error) {
        path = null;
      }

      const rows = await fileNodesStore.getObjectMapByNode(node.id);
      const pendingRow = rows.find((row) => row.status === 'pending') || null;
      // DEF-11: an overwrite demotes the previous active row to 'history';
      // legacy 'orphaned' residue (pre-DEF-11 rows) is still detected.
      const hasHistoryRow = rows.some((row) => row.status === 'history');
      const hasOrphanedRow = rows.some((row) => row.status === 'orphaned');

      let blobPresent = null;
      if (pendingRow && pendingRow.s3_key && blobStore) {
        try {
          const head = await headBlobOrNull(pendingRow.s3_key);
          blobPresent = head != null;
        } catch (error) {
          blobPresent = null;
        }
      }

      result.push({
        nodeId: node.id,
        name: node.name,
        type: node.type,
        path,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
        classification: hasHistoryRow || hasOrphanedRow ? 'overwrite' : 'new-file',
        pendingS3Key: pendingRow ? pendingRow.s3_key : null,
        blobPresent,
      });
    }
    return result;
  }

  /**
   * Manually resolve one orphaned node.
   * @param {number} nodeId - file_nodes.id.
   * @param {Object} opts
   * @param {'retry-delete'|'force-active'} opts.action
   * @returns {Promise<{ nodeId: number, action: string, status: string, path: string|null, detail: string }>}
   */
  async function repairNode(nodeId, { action }) {
    if (!REPAIR_ACTIONS.includes(action)) {
      throw createError(SERVER_ERROR_CODES.admin.repairSyncInvalidAction, 400, {
        action: String(action),
      });
    }

    if (PENDING_UPLOAD_ACTIONS.includes(action)) {
      return repairPendingUploadNode(nodeId, { action });
    }

    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      throw createError(SERVER_ERROR_CODES.admin.repairSyncNodeNotFound, 404, {
        nodeId: Number(nodeId),
      });
    }

    let path = null;
    try {
      path = await fileNodeService.getNodePath(nodeId);
    } catch (error) {
      path = null;
    }

    if (action === 'retry-delete') {
      await remoteOps.deleteRemoteSubtreeBestEffort(nodeId);
      await fileNodeService.deleteNode(nodeId);
      return {
        nodeId: node.id,
        action,
        status: 'resolved',
        path,
        detail: 'node deleted',
      };
    }

    await assertWebdavRemoteExists(nodeId, path);
    await fileNodeService.updateSyncStatus(nodeId, 'active');
    return {
      nodeId: node.id,
      action,
      status: 'resolved',
      path,
      detail: 'sync_status set to active',
    };
  }

  /**
   * WebDAV mode only (D5d): `force-active` must not activate a node whose
   * remote file is absent. Non-404 probe errors propagate.
   */
  async function assertWebdavRemoteExists(nodeId, nodePath) {
    if (fileStorageMode !== 'webdav' || !blobStore) return;
    const head = await headBlobOrNull(nodePath);
    if (!head) {
      throw createError(SERVER_ERROR_CODES.admin.repairSyncRemoteMissing, 409, {
        nodeId: Number(nodeId),
        path: nodePath,
      });
    }
  }

  /**
   * Manually resolve one pending_upload stuck node (DEF-12/13).
   * S3 mode only (see scanPendingUploadNodes): in WebDAV mode a healthy file
   * node is indistinguishable from a stuck one, so repair is refused there.
   * @param {number} nodeId - file_nodes.id.
   * @param {Object} opts
   * @param {'complete'|'restore-previous'|'delete'|'auto'} opts.action
   * @returns {Promise<{ nodeId: number, action: string, status: string, path: string|null, detail: string }>}
   */
  async function repairPendingUploadNode(nodeId, { action }) {
    if (!PENDING_UPLOAD_ACTIONS.includes(action)) {
      throw createError(SERVER_ERROR_CODES.admin.repairUploadInvalidAction, 400, {
        action: String(action),
      });
    }
    if (fileStorageMode !== 's3') {
      throw createError(SERVER_ERROR_CODES.admin.repairUploadNotPending, 409, {
        nodeId: Number(nodeId),
        reason: 'pending_upload repair is available in s3 storage mode only',
      });
    }

    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      throw createError(SERVER_ERROR_CODES.admin.repairSyncNodeNotFound, 404, {
        nodeId: Number(nodeId),
      });
    }
    if (node.syncStatus !== 'pending_upload') {
      throw createError(SERVER_ERROR_CODES.admin.repairUploadNotPending, 409, {
        nodeId: Number(nodeId),
        syncStatus: node.syncStatus,
      });
    }

    const rows = await fileNodesStore.getObjectMapByNode(nodeId);
    const pendingRow = rows.find((row) => row.status === 'pending') || null;
    // DEF-11: the last-good row of a stuck overwrite is now 'history';
    // legacy 'orphaned' residue (pre-DEF-11 rows) stays a fallback.
    const lastGoodRow =
      rows.find((row) => row.status === 'history') ||
      rows.find((row) => row.status === 'orphaned') ||
      null;

    let path = null;
    try {
      path = await fileNodeService.getNodePath(nodeId);
    } catch (error) {
      path = null;
    }

    let resolvedAction = action;
    if (action === 'auto') {
      if (lastGoodRow) {
        resolvedAction = 'restore-previous';
      } else {
        // D2: an unknown blob state (probe error) must never pick a
        // destructive action, so non-404 probe errors propagate.
        const head =
          pendingRow && pendingRow.s3_key ? await headBlobOrNull(pendingRow.s3_key) : null;
        resolvedAction = pendingRow && head ? 'complete' : 'delete';
      }
    }

    if (resolvedAction === 'complete') {
      if (!pendingRow || !pendingRow.s3_key) {
        throw createError(SERVER_ERROR_CODES.admin.repairUploadNotPending, 409, {
          nodeId: Number(nodeId),
          reason: 'no pending object_map row to activate',
        });
      }
      const head = await headBlobOrNull(pendingRow.s3_key);
      if (!head) {
        throw createError(SERVER_ERROR_CODES.admin.repairUploadBlobMissing, 409, {
          nodeId: Number(nodeId),
          s3Key: pendingRow.s3_key,
        });
      }
      await withTx(async () => {
        await fileNodesStore.activateObject(pendingRow.s3_key);
        await fileNodesStore.upsertCache(
          nodeId,
          head.contentLength,
          head.contentType || null,
          null
        );
        await fileNodeService.updateSyncStatus(nodeId, 'active');
      });
      return {
        nodeId: node.id,
        action,
        status: 'resolved',
        path,
        detail: 'pending object_map row activated; filecache populated from blob metadata',
      };
    }

    if (resolvedAction === 'restore-previous') {
      if (!lastGoodRow) {
        throw createError(SERVER_ERROR_CODES.admin.repairUploadNotPending, 409, {
          nodeId: Number(nodeId),
          reason: 'no orphaned last-good row to restore',
        });
      }
      await withTx(async () => {
        await fileNodesStore.reactivateObjectMapRow(lastGoodRow.id);
        if (pendingRow) {
          await fileNodesStore.deleteObjectMapRows([pendingRow.id]);
        }
        await fileNodeService.updateSyncStatus(nodeId, 'active');
      });
      if (pendingRow && pendingRow.s3_key) {
        try {
          await blobStore.deleteBlob(pendingRow.s3_key);
        } catch (error) {
          /* best-effort — the last-good blob B_k is never touched */
        }
      }
      return {
        nodeId: node.id,
        action,
        status: 'resolved',
        path,
        detail: 'last-good object_map row reactivated; pending row/blob deleted',
      };
    }

    if (pendingRow && pendingRow.s3_key) {
      try {
        await blobStore.deleteBlob(pendingRow.s3_key);
      } catch (error) {
        /* best-effort */
      }
    }
    await fileNodeService.deleteNode(nodeId);
    return {
      nodeId: node.id,
      action,
      status: 'resolved',
      path,
      detail: 'node tree and object_map rows deleted; pending blob deleted best-effort',
    };
  }

  /**
   * Startup hook: scan orphaned + pending_upload stuck nodes and report them
   * for manual review. Never performs any action automatically.
   * @returns {Promise<{ scanned: number, resolved: number, manualReview: Array<{ nodeId: number, path: string|null }>, pendingUpload: { scanned: number, nodes: Array, error?: string } }>}
   */
  async function runStartupRecovery() {
    const nodes = await scanOrphanedNodes();
    let pendingUpload;
    try {
      const pendingNodes = await scanPendingUploadNodes();
      pendingUpload = { scanned: pendingNodes.length, nodes: pendingNodes };
    } catch (error) {
      pendingUpload = { scanned: 0, nodes: [], error: error.message };
    }
    return {
      scanned: nodes.length,
      resolved: 0,
      manualReview: nodes.map((n) => ({ nodeId: n.nodeId, path: n.path })),
      pendingUpload,
    };
  }

  return {
    scanOrphanedNodes,
    scanPendingUploadNodes,
    repairNode,
    repairPendingUploadNode,
    runStartupRecovery,
  };
}

module.exports = { createFailSafeService };
