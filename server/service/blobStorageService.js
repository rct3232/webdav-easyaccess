'use strict';

const crypto = require('crypto');

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
 */
function createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService }) {
  const isWebdavMode = fileStorageMode === 'webdav';

  async function prepareUpload(fileNodeId) {
    if (isWebdavMode) {
      return null;
    }
    const s3Key = crypto.randomUUID();
    await fileNodesStore.upsertObjectMap(fileNodeId, s3Key, 'pending');
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
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
    }
    const newS3Key = crypto.randomUUID();
    await blobStore.uploadBlob(newS3Key, buffer);
    await fileNodesStore.insertObject(fileNodeId, newS3Key, 'active');
    return newS3Key;
  }

  async function deleteBlob(fileNodeId) {
    if (isWebdavMode) {
      const nodePath = await resolveWebdavPathOrNull(fileNodeId);
      if (nodePath !== null) {
        await blobStore.deleteBlob(nodePath);
      }
      return;
    }
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
    }
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
      await fileNodesStore.orphanObject(row.s3_key);
      await fileNodesStore.insertObject(fileNodeId, newS3Key, 'active');
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
      return null;
    }
    await blobStore.uploadBlob(nodePath, buffer);
    await fileNodesStore.upsertCache(fileNodeId, buffer.length, mimeType || null, null);
  }

  return {
    prepareUpload,
    completeUpload,
    downloadBlob,
    overwriteBlob,
    deleteBlob,
    getActiveS3Key,
    countActiveObjectsByS3Key,
    duplicateBlob,
    linkObject,
    ensureExclusiveBlob,
    uploadToWebdav,
    downloadBlobWebdav,
  };
}

module.exports = { createBlobStorageService };
