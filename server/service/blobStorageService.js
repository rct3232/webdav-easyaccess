'use strict';

const crypto = require('crypto');
const { getSharedResolver } = require('../infrastructure/configResolver');

/**
 * Factory: create a blob-storage lifecycle service bound to one backend pair.
 *
 * @param {Object} opts
 * @param {Object} opts.blobStore - S3BlobStore or WebDAV blob store. Exposes uploadBlob,
 *   downloadBlob, deleteBlob; S3 additionally uses copyBlob.
 * @param {Object} opts.fileNodesStore - data access for object_map + filecache.
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 * @param {Object} [opts.fileNodeService] - needed in WebDAV mode; exposes getNode(nodeId)
 *   and getNodePath(nodeId).
 * @param {Object} [opts.versionConfig] - test seam for GC_VERSION_MAX_PER_NODE:
 *   `{ maxPerNode }`; when absent the shared resolver resolves it per call
 *   (DB row → built-in default 10). `0` = unbounded.
 */
function createBlobStorageService({
  blobStore,
  fileNodesStore,
  fileStorageMode = 's3',
  fileNodeService,
  versionConfig = {},
}) {
  const isWebdavMode = fileStorageMode === 'webdav';

  // GC_VERSION_MAX_PER_NODE is T2 (hot): resolved lazily per call so DB
  // changes apply without a restart. 0 is a valid value (= unbounded); only
  // negatives/invalid fall back to the built-in default.
  async function resolveVersionCapPerNode() {
    if (Number.isFinite(versionConfig.maxPerNode) && versionConfig.maxPerNode >= 0) {
      return versionConfig.maxPerNode;
    }
    const configured = await getSharedResolver().getConfig('GC_VERSION_MAX_PER_NODE');
    const cap = Number(configured);
    if (Number.isFinite(cap) && cap >= 0) {
      return cap;
    }
    return 10;
  }

  async function prepareUpload(fileNodeId) {
    if (isWebdavMode) {
      return null;
    }
    const s3Key = crypto.randomUUID();
    await fileNodesStore.upsertObjectMap(fileNodeId, s3Key, 'pending');
    // DEF-11: enforce the per-node version cap in the same TX context as the
    // upsert (uploadService wraps prepareUpload in TX1 for overwrites).
    const cap = await resolveVersionCapPerNode();
    await fileNodesStore.evictVersionsBeyondCap(fileNodeId, cap);
    return s3Key;
  }

  async function completeUpload(s3Key, size, mimeType) {
    if (isWebdavMode) {
      throw new Error('completeUpload is not applicable in WebDAV mode');
    }
    const row = await fileNodesStore.getObjectMapByS3Key(s3Key);
    if (!row) {
      throw new Error('No object_map entry found for s3Key: ' + s3Key);
    }
    await fileNodesStore.activateObject(s3Key);
    await fileNodesStore.upsertCache(row.file_node_id, size, mimeType, null);
  }

  async function downloadBlob(fileNodeId) {
    if (isWebdavMode) {
      return downloadBlobWebdav(fileNodeId);
    }
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    if (!row || !row.s3_key) {
      return null;
    }
    return blobStore.downloadBlob(row.s3_key);
  }

  async function overwriteBlob(fileNodeId, buffer) {
    if (isWebdavMode) {
      return uploadToWebdav(fileNodeId, buffer);
    }
    const newS3Key = crypto.randomUUID();
    await blobStore.uploadBlob(newS3Key, buffer);
    await fileNodesStore.upsertObjectMap(fileNodeId, newS3Key, 'active');
    return newS3Key;
  }

  async function getActiveS3Key(fileNodeId) {
    if (isWebdavMode) {
      return null;
    }
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    return row ? row.s3_key : null;
  }

  async function countActiveObjectsByS3Key(s3Key) {
    if (isWebdavMode) {
      return 0;
    }
    return fileNodesStore.countActiveObjectsByS3Key(s3Key);
  }

  async function duplicateBlob(sourceS3Key) {
    if (isWebdavMode) {
      throw new Error('duplicateBlob is not applicable in WebDAV mode');
    }
    const newS3Key = crypto.randomUUID();
    await blobStore.copyBlob(sourceS3Key, newS3Key);
    return newS3Key;
  }

  async function linkObject(fileNodeId, s3Key) {
    if (isWebdavMode) {
      throw new Error('linkObject is not applicable in WebDAV mode');
    }
    await fileNodesStore.insertObject(fileNodeId, s3Key, 'active');
  }

  async function ensureExclusiveBlob(fileNodeId) {
    if (isWebdavMode) {
      return null;
    }
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    if (!row || !row.s3_key) {
      return null;
    }
    const count = await fileNodesStore.countActiveObjectsByS3Key(row.s3_key);
    if (count > 1) {
      const newS3Key = await duplicateBlob(row.s3_key);
      await fileNodesStore.upsertObjectMap(fileNodeId, newS3Key, 'active');
      return newS3Key;
    }
    return row.s3_key;
  }

  /**
   * Resolve a WebDAV path for a file node, guarding on node existence.
   * @returns {Promise<string|null>} path, or null when the node is missing.
   */
  async function resolveWebdavPathOrNull(fileNodeId) {
    if (!fileNodeService) {
      return null;
    }
    const node = await fileNodeService.getNode(fileNodeId);
    if (!node) {
      return null;
    }
    return fileNodeService.getNodePath(fileNodeId);
  }

  async function downloadBlobWebdav(fileNodeId) {
    const nodePath = await resolveWebdavPathOrNull(fileNodeId);
    if (nodePath === null) {
      return null;
    }
    return blobStore.downloadBlob(nodePath);
  }

  async function uploadToWebdav(fileNodeId, buffer, mimeType) {
    const nodePath = await resolveWebdavPathOrNull(fileNodeId);
    if (nodePath === null) {
      throw new Error('Cannot resolve path for fileNodeId: ' + fileNodeId);
    }
    await blobStore.uploadBlob(nodePath, buffer);
    await fileNodesStore.upsertCache(
      fileNodeId,
      buffer.length,
      mimeType || 'application/octet-stream',
      null
    );
  }

  /**
   * Ensure the physical storage directory for a node exists (WebDAV MKCOL).
   *
   * No-op in S3 mode so call sites can invoke it unconditionally. In WebDAV
   * mode the resolved node path is MKCOL'd recursively (root → deepest,
   * tolerating already-existing collections) via the blob store. On failure
   * the node is marked sync_status='orphaned_node' as a fail-safe and the
   * error is re-thrown so callers surface a failure response.
   *
   * @param {number} nodeId - ID of the directory node to materialize remotely.
   * @returns {Promise<string|null>} resolved node path (WebDAV) or null (S3 no-op).
   */
  async function createDirectoryWebdav(nodeId) {
    if (!isWebdavMode || !blobStore.createDirectory) {
      return null;
    }
    const nodePath = await resolveWebdavPathOrNull(nodeId);
    if (nodePath === null) {
      throw new Error('Cannot resolve path for fileNodeId: ' + nodeId);
    }
    try {
      await blobStore.createDirectory(nodePath);
    } catch (error) {
      if (fileNodeService) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      }
      throw error;
    }
    return nodePath;
  }

  return {
    prepareUpload,
    completeUpload,
    downloadBlob,
    overwriteBlob,
    getActiveS3Key,
    countActiveObjectsByS3Key,
    duplicateBlob,
    linkObject,
    ensureExclusiveBlob,
    uploadToWebdav,
    downloadBlobWebdav,
    createDirectoryWebdav,
  };
}

module.exports = { createBlobStorageService };
