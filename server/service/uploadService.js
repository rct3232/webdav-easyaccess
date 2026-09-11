'use strict';

const storage = require('../store/storage');
const thumbnailService = require('../domains/thumbnails/services/thumbnailService');

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
 * | Method     | Failure Point | DB State                                     | S3 State             | Behavior / Recovery                    |
 * |------------|---------------|----------------------------------------------|----------------------|----------------------------------------|
 * | uploadFile | TX1 fails     | ROLLBACK, nothing persisted                  | Nothing              | Idempotent retry                       |
 * | uploadFile | S3 PUT fails  | Node rolled back, nothing persisted          | Nothing (or partial) | No phantom row; partial → GC Tier 2    |
 * | uploadFile | TX2 fails     | Node rolled back, nothing persisted          | Blob uploaded        | GC Tier 2 cleans untracked blob        |
 * | overwrite  | TX1 fails     | ROLLBACK, original version preserved         | Nothing              | Idempotent retry                       |
 * | overwrite  | S3 PUT/TX2 fails | Rolled back to pre-state: node active, prev active row reactivated, pending v_{k+1} row deleted (filecache re-asserted) | New blob deleted best-effort; last-good B_k kept | File remains downloadable as previous version; rollback failure -> pending_upload (scan/repair + GC, DEF-12/13) |
 * ────────────────────────────────────────────────────────────────
 */
function createUploadService({ fileNodeService, blobStorageService, blobStore, fileNodesStore }) {
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
   *
   * Steps 2–3 run inside one try: on ANY failure after TX1 committed, the
   * just-created node is rolled back (fileNodeService.deleteNode, CASCADE also
   * removes the pending object_map row) and the original error is re-thrown.
   * A failed upload therefore never leaves a phantom 0-byte file in listings
   * and never blocks a retry with a duplicate-name conflict. A blob that was
   * fully written before a TX2 failure remains untracked in S3 (GC Tier 2).
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

    // Steps 2–3 — S3 PUT (outside TX) + TX2 finalize.
    try {
      await blobStore.uploadBlob(s3Key, buffer);

      await withTx(async () => {
        await blobStorageService.completeUpload(s3Key, buffer.length, mimeType);
        await fileNodeService.updateSyncStatus(nodeId, 'active');
      });
    } catch (error) {
      // Roll back the newly created node so no pending/0-byte row survives.
      // Best-effort: if DB cleanup itself fails, surface the original error.
      try {
        await fileNodeService.deleteNode(nodeId);
      } catch (_) {
        /* ignore cleanup failure — original upload error takes precedence */
      }
      throw error;
    }

    return { nodeId, s3Key, size: buffer.length, mimeType };
  }

  /* ------------------------------------------------------------------ */
  /*  Overwrite                                                         */
  /* ------------------------------------------------------------------ */

  /**
   * Best-effort rollback of a failed overwrite (S3 PUT or TX2 failure):
   * restores the pre-state — previous active object_map row reactivated, node
   * sync_status back to 'active', pending v_{k+1} row deleted inside one withTx;
   * the pending blob is deleted and the captured filecache values re-asserted
   * outside the TX. Individual steps are guarded so one failure does not skip
   * the rest; the last-good blob B_k is never deleted. Residual state on
   * rollback failure is handled by scan/repair + GC cleanup (DEF-12/13).
   */
  async function rollbackOverwrite(fileNodeId, previousActive, previousCache, newS3Key) {
    try {
      await withTx(async () => {
        if (previousActive) {
          await fileNodesStore.reactivateObjectMapRow(previousActive.id);
        }
        await fileNodeService.updateSyncStatus(fileNodeId, 'active');
        const pendingRow = await fileNodesStore.getObjectMapByS3Key(newS3Key);
        if (pendingRow) {
          await fileNodesStore.deleteObjectMapRows([pendingRow.id]);
        }
      });
    } catch (_) {
      /* ignore rollback TX failure — original upload error takes precedence */
    }

    try {
      await blobStore.deleteBlob(newS3Key);
    } catch (_) {
      /* ignore */
    }

    try {
      if (previousCache) {
        await fileNodesStore.upsertCache(
          fileNodeId,
          previousCache.size,
          previousCache.mime_type,
          previousCache.content_hash
        );
      }
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * Overwrite the content of an existing file.
   *
   * Flow:
   *   Pre-state capture: getActiveObject + getCache
   *   TX1: prepareUpload + updateSyncStatus('pending_upload')
   *         (outside TX) blobStore.uploadBlob(s3Key, buffer)
   *   TX2: completeUpload + updateSyncStatus('active')
   *
   * Steps 2–3 run inside one try: on ANY failure after TX1 committed, the
   * pre-state is restored (rollbackOverwrite) and the original error is
   * re-thrown. The last-good blob B_k stays downloadable as the previous
   * version.
   */
  async function overwriteFile(fileNodeId, buffer, mimeType) {
    let s3Key;

    // Step 0 — Pre-state capture (before TX1).
    const previousActive = await fileNodesStore.getActiveObject(fileNodeId);
    const previousCache = await fileNodesStore.getCache(fileNodeId);

    // Step 1 — TX1: Prepare new version (orphans old active via prepareUpload)
    await withTx(async () => {
      s3Key = await blobStorageService.prepareUpload(fileNodeId);
      await fileNodeService.updateSyncStatus(fileNodeId, 'pending_upload');
    });

    // Steps 2–3 — S3 PUT (outside TX) + TX2 finalize, with best-effort
    // pre-state rollback on failure.
    try {
      await blobStore.uploadBlob(s3Key, buffer);

      await withTx(async () => {
        await blobStorageService.completeUpload(s3Key, buffer.length, mimeType);
        await fileNodeService.updateSyncStatus(fileNodeId, 'active');
      });
    } catch (error) {
      await rollbackOverwrite(fileNodeId, previousActive, previousCache, s3Key);
      throw error;
    }

    // Content changed → evict the cached thumbnail (pre-existing latent gap
    // closed alongside DEF-11 restore; best-effort by contract).
    try {
      thumbnailService.invalidate(fileNodeId);
    } catch {
      /* best-effort */
    }

    return { nodeId: fileNodeId, s3Key, size: buffer.length, mimeType };
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  return {
    uploadFile,
    overwriteFile,
  };
}

module.exports = { createUploadService };
