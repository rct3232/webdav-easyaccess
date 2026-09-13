'use strict';

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { createError, notFoundError, forbiddenError } = require('../../../utils/errorHandler');
const storage = require('../../../store/storage');
const thumbnailService = require('../../thumbnails/services/thumbnailService');

function isNotFoundError(error) {
  if (!error) return false;
  if (error.status === 404 || error.statusCode === 404) return true;
  if (error.$metadata && error.$metadata.httpStatusCode === 404) return true;
  const haystack = `${error.name || ''} ${error.message || ''}`;
  return /404|not found|notfound|nosuchkey/i.test(haystack);
}

/**
 * Factory: version-history service (DEF-11, S3 storage mode only).
 *
 * Browse = read perm (404-masquerade like downloadFile); restore = write perm;
 * share tokens are refused upstream (routes) and never reach this service.
 * Restore reactivates a history row in place (zero I/O, no new version row):
 * one TX swaps history→active and demotes the current active row to history
 * (dedicated `demoteActiveToHistory` primitive — the demoted current version
 * becomes `history`, never `orphaned`), then the filecache is re-asserted from
 * the blob HEAD (repair-complete precedent, content_hash null) and the
 * thumbnail cache entry is evicted.
 *
 * @param {Object} opts
 * @param {Object} opts.fileNodesStore - object_map read/write access
 *   (getVersionsByNode, reactivateObjectMapRow, demoteActiveToHistory, upsertCache).
 * @param {Object} opts.fileNodeService - getNode + updateSyncStatus.
 * @param {Object} opts.blobStore - S3 blob adapter (headBlob/downloadBlob).
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - version history is S3-only.
 * @param {Object} [opts.aclService] - permission gates; defaults to the real
 *   aclService singleton (composition injects it explicitly).
 */
function createVersionsService({
  fileNodesStore,
  fileNodeService,
  blobStore,
  fileStorageMode = 's3',
  aclService: injectedAclService,
}) {
  const aclService = injectedAclService || require('../../permissions/services/aclService');

  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  /** HEAD the blob for a key; 404-style errors map to null, others propagate. */
  async function headBlobOrNull(key) {
    try {
      return await blobStore.headBlob(key);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  function userIsAdmin(user) {
    return Boolean(user && aclService.isAdminUser(user));
  }

  /**
   * Browse the version history of a file node (active + history rows,
   * newest first). Storage internals (s3_key/storage_backend/id) are stripped;
   * size is a best-effort headBlob probe (probe failure → size null).
   */
  async function listVersions(userId, nodeId, user) {
    if (!userIsAdmin(user)) {
      const allowed = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ);
      if (!allowed) {
        throw notFoundError(SERVER_ERROR_CODES.files.notFound);
      }
    }

    const rows = await fileNodesStore.getVersionsByNode(nodeId);
    const versions = [];
    for (const row of rows) {
      let size = null;
      try {
        const head = await blobStore.headBlob(row.s3_key);
        size = head ? Number(head.contentLength) : null;
      } catch {
        size = null;
      }
      versions.push({
        versionNumber: Number(row.version_number),
        status: row.status,
        createdAt: row.created_at,
        size,
        isCurrent: row.status === 'active',
      });
    }

    const current = versions.find((v) => v.isCurrent) || null;
    return {
      nodeId: Number(nodeId),
      currentVersionNumber: current ? current.versionNumber : null,
      versions,
    };
  }

  /**
   * Restore one version in place (A안): the target row becomes the active row
   * and the current active row is demoted to history. No new version row is
   * created (row count unchanged). Restoring the current version is an
   * idempotent no-op.
   */
  async function restoreVersion(userId, nodeId, versionNumber, user) {
    if (fileStorageMode !== 's3') {
      throw createError(SERVER_ERROR_CODES.files.versionRestoreUnavailable, 409, {
        reason: 'version restore is available in s3 storage mode only',
      });
    }

    if (!userIsAdmin(user)) {
      const allowed = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
      if (!allowed) {
        throw forbiddenError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }
    if (node.syncStatus === 'pending_upload') {
      throw createError(SERVER_ERROR_CODES.files.versionRestoreUnavailable, 409, {
        nodeId: Number(nodeId),
        reason: 'node_pending_upload',
      });
    }

    const rows = await fileNodesStore.getVersionsByNode(nodeId);
    const target = rows.find((row) => Number(row.version_number) === Number(versionNumber));
    if (!target) {
      throw notFoundError(SERVER_ERROR_CODES.files.versionNotFound, {
        nodeId: Number(nodeId),
        versionNumber: Number(versionNumber),
      });
    }

    const current = rows.find((row) => row.status === 'active') || null;
    if (current && Number(current.id) === Number(target.id)) {
      return {
        messageCode: SERVER_MESSAGE_CODES.files.versionRestored,
        nodeId: Number(nodeId),
        restoredVersionNumber: Number(target.version_number),
        alreadyCurrent: true,
      };
    }

    const head = await headBlobOrNull(target.s3_key);
    if (!head) {
      throw createError(SERVER_ERROR_CODES.files.versionBlobMissing, 409, {
        nodeId: Number(nodeId),
        versionNumber: Number(target.version_number),
      });
    }

    await withTx(async () => {
      await fileNodesStore.reactivateObjectMapRow(target.id);
      if (current && current.s3_key) {
        await fileNodesStore.demoteActiveToHistory(current.s3_key);
      }
      await fileNodeService.updateSyncStatus(nodeId, 'active');
    });

    // Post-TX consistency (best-effort, repair-complete precedent): re-assert
    // the filecache from the blob HEAD and evict the stale thumbnail.
    try {
      await fileNodesStore.upsertCache(nodeId, head.contentLength, head.contentType || null, null);
    } catch {
      /* best-effort — the version swap already committed */
    }
    try {
      thumbnailService.invalidate(nodeId);
    } catch {
      /* best-effort */
    }

    return {
      messageCode: SERVER_MESSAGE_CODES.files.versionRestored,
      nodeId: Number(nodeId),
      restoredVersionNumber: Number(target.version_number),
    };
  }

  /**
   * Download one version's blob attachment-only (octet-stream). Read perm,
   * 404-masquerade. A missing blob is a plain 404 (not a repairable conflict).
   */
  async function downloadVersion(userId, nodeId, versionNumber, user) {
    if (!userIsAdmin(user)) {
      const allowed = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ);
      if (!allowed) {
        throw notFoundError(SERVER_ERROR_CODES.files.notFound);
      }
    }

    const rows = await fileNodesStore.getVersionsByNode(nodeId);
    const target = rows.find((row) => Number(row.version_number) === Number(versionNumber));
    if (!target || !target.s3_key) {
      throw notFoundError(SERVER_ERROR_CODES.files.versionNotFound, {
        nodeId: Number(nodeId),
        versionNumber: Number(versionNumber),
      });
    }

    const buffer = await blobStore.downloadBlob(target.s3_key);
    if (buffer === null || buffer === undefined) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }
    return buffer;
  }

  return { listVersions, restoreVersion, downloadVersion };
}

module.exports = { createVersionsService };
