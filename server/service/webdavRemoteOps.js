'use strict';

/**
 * Shared WebDAV-mode remote subtree primitives (DEF-16 P2 extraction).
 *
 * Extracted from the former inline bottom-up delete in
 * `domains/files/services/fileService.js` and the duplicate in
 * `failSafeService.deleteRemoteSubtreeBestEffort`. Consumers:
 * - `failSafeService` (repair `retry-delete` remote cleanup),
 * - the admin permanent-delete maintenance route,
 * - `fileService.deleteNode` trash MOVE target handling (P3 purge will reuse
 *   the trash-path helpers).
 *
 * All operations are WebDAV-mode only: in S3 mode every function is a no-op
 * (S3 keys are stable UUIDs; trash does zero physical I/O there).
 */

const TRASH_ROOT = '/.wea-trash';

/**
 * Hidden trash destination for a trashed subtree root:
 * `/.wea-trash/<nodeId>` (nodeId = the trashed ROOT's id; descendants keep
 * their relative structure under it after the MOVE).
 */
function buildTrashPath(nodeId) {
  return `${TRASH_ROOT}/${Number(nodeId)}`;
}

/**
 * Factory: WebDAV remote operations bound to one blob store + tree service.
 *
 * @param {Object} opts
 * @param {Object} opts.blobStore - S3BlobStore or WebdavBlobStore adapter
 *   (deleteBlob/headBlob/moveBlob for WebDAV mode).
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 * @param {Object} [opts.fileNodeService] - tree service (getNodePath,
 *   getDescendantIds) used to resolve display paths.
 */
function createWebdavRemoteOps({ blobStore, fileStorageMode = 's3', fileNodeService }) {
  const isWebdavMode = fileStorageMode === 'webdav';

  /**
   * WebDAV mode only: best-effort remote deletion of the node's subtree
   * (deepest first, then the node itself) over the display paths, before the
   * DB rows are removed. Individual failures are ignored — the DB delete
   * proceeds either way.
   */
  async function deleteRemoteSubtreeBestEffort(nodeId) {
    if (!isWebdavMode || !blobStore || !fileNodeService) return;
    const descendantIds = await fileNodeService.getDescendantIds(nodeId);
    const ids = [...descendantIds].reverse().concat([nodeId]);
    for (const id of ids) {
      try {
        const nodePath = await fileNodeService.getNodePath(id);
        if (nodePath) {
          await blobStore.deleteBlob(nodePath);
        }
      } catch (error) {
        /* best-effort — the DB delete proceeds */
      }
    }
  }

  /**
   * WebDAV mode only: ensure the /.wea-trash/ root collection exists before a
   * MOVE into it — WebDAV MOVE fails (500 → fallback 403) when the destination
   * parent is missing (Apache DAV does not auto-create destination parents).
   * Idempotent via ensureDirectoryExists (MKCOL-already-exists tolerated).
   */
  async function ensureTrashRoot() {
    if (!isWebdavMode) return;
    await blobStore.ensureDirectoryExists(TRASH_ROOT);
  }

  return {
    buildTrashPath,
    deleteRemoteSubtreeBestEffort,
    ensureTrashRoot,
  };
}

module.exports = {
  TRASH_ROOT,
  buildTrashPath,
  createWebdavRemoteOps,
};
