'use strict';

const storage = require('../store/storage');

/**
 * Factory: create an upload orchestration service bound to one store + backend at creation time.
 *
 * Owns transaction boundaries for multi-step upload / overwrite flows.
 * The underlying services (fileNodeService, blobStorageService) are TX-agnostic;
 * each must run inside the same transaction when called together.
 *
 * ────────────────────────────────────────────────────────────────
 * Failure Recovery States
 * ────────────────────────────────────────────────────────────────
 *
 * uploadFile / overwriteFile follow a 3-phase flow:
 *   TX1 (DB) → S3 PUT → TX2 (DB)
 *
 * | Failure Point | DB State                                           | S3 State          | Recovery                              |
 * |---------------|----------------------------------------------------|--------------------|---------------------------------------|
 * | TX1 fails     | ROLLBACK, nothing persisted                         | Nothing            | Idempotent retry                      |
 * | S3 PUT fails  | object_map row = 'pending'                          | Nothing (or partial) | Retry endpoint or GC Tier 1         |
 * | TX2 fails     | object_map = 'pending'; sync_status = 'pending_upload' | Blob uploaded    | GC Tier 2 cleans untracked blob      |
 * ────────────────────────────────────────────────────────────────
 */
function createUploadService({ fileNodeService, blobStorageService, blobStore }) {

  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  /* ------------------------------------------------------------------ */
  /*  Upload                                                            */
  /* ------------------------------------------------------------------ */

  /**
   * Create a new file and upload its content.
   *
   * Flow:
   *   TX1: createFile + prepareUpload  →  nodeId, s3Key
   *         (outside TX) blobStore.uploadBlob(s3Key, buffer)
   *   TX2: completeUpload + updateSyncStatus('active')
   */
  async function uploadFile(parentNodeId, name, buffer, mimeType) {
    let nodeId;
    let s3Key;

    // Step 1 — TX1: Create node + prepare blob mapping.
    // createFile manages its own transaction internally; prepareUpload is a
    // single DB write that doesn't need an outer wrapper.  An outer withTx()
    // would nest transactions (SQLite error) or hold a PG connection idle.
    const node = await fileNodeService.createFile(parentNodeId, name);
    nodeId = node.id;
    s3Key = await blobStorageService.prepareUpload(nodeId);

    // Step 2 — S3 PUT: Upload content (outside transaction)
    await blobStore.uploadBlob(s3Key, buffer);

    // Step 3 — TX2: Finalize mapping + sync status (must be atomic together)
    await withTx(async () => {
      await blobStorageService.completeUpload(s3Key, buffer.length, mimeType);
      await fileNodeService.updateSyncStatus(nodeId, 'active');
    });

    return { nodeId, s3Key, size: buffer.length, mimeType };
  }

  /* ------------------------------------------------------------------ */
  /*  Overwrite                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Overwrite the content of an existing file.
   *
   * Flow:
   *   TX1: prepareUpload + updateSyncStatus('pending_upload')
   *         (outside TX) blobStore.uploadBlob(s3Key, buffer)
   *   TX2: completeUpload + updateSyncStatus('active')
   */
  async function overwriteFile(fileNodeId, buffer, mimeType) {
    let s3Key;

    // Step 1 — TX1: Prepare new version (orphans old active via prepareUpload)
    await withTx(async () => {
      s3Key = await blobStorageService.prepareUpload(fileNodeId);
      await fileNodeService.updateSyncStatus(fileNodeId, 'pending_upload');
    });

    // Step 2 — S3 PUT: Upload new content (outside transaction)
    await blobStore.uploadBlob(s3Key, buffer);

    // Step 3 — TX2: Finalize mapping + sync status
    await withTx(async () => {
      await blobStorageService.completeUpload(s3Key, buffer.length, mimeType);
      await fileNodeService.updateSyncStatus(fileNodeId, 'active');
    });

    return { nodeId: fileNodeId, s3Key, size: buffer.length, mimeType };
  }

  /* ------------------------------------------------------------------ */
  /*  Download                                                          */
  /* ------------------------------------------------------------------ */

  /** Pass-through to blobStorageService. */
  async function downloadFile(fileNodeId) {
    return await blobStorageService.downloadBlob(fileNodeId);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  return {
    uploadFile,
    overwriteFile,
    downloadFile,
  };
}

module.exports = { createUploadService };
