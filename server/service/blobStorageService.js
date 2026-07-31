'use strict';

const crypto = require('crypto');

/**
 * Factory: create a blob-storage lifecycle service bound to one backend pair.
 */
function createBlobStorageService({ blobStore, fileNodesStore }) {
  async function prepareUpload(fileNodeId) {
    const s3Key = crypto.randomUUID();
    await fileNodesStore.upsertObjectMap(fileNodeId, s3Key, 'pending');
    return s3Key;
  }

  async function completeUpload(s3Key, size, mimeType) {
    const row = await fileNodesStore.getObjectMapByS3Key(s3Key);
    if (!row) {
      throw new Error('No object_map entry found for s3Key: ' + s3Key);
    }
    await fileNodesStore.activateObject(s3Key);
    await fileNodesStore.upsertCache(row.file_node_id, size, mimeType, null);
  }

  async function downloadBlob(fileNodeId) {
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    if (!row || !row.s3_key) {
      return null;
    }
    return blobStore.downloadBlob(row.s3_key);
  }

  async function overwriteBlob(fileNodeId, buffer) {
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
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
    }
  }

  async function getActiveS3Key(fileNodeId) {
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    return row ? row.s3_key : null;
  }

  return {
    prepareUpload,
    completeUpload,
    downloadBlob,
    overwriteBlob,
    deleteBlob,
    getActiveS3Key,
  };
}

module.exports = { createBlobStorageService };
