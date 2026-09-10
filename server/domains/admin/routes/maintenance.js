const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const {
  asyncHandler,
  createError,
  validationError,
  notFoundError,
} = require('../../../utils/errorHandler');
const { createWebdavRemoteOps, buildTrashPath } = require('../../../service/webdavRemoteOps');

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get folder list for admin (single level)
router.get(
  '/folders/list',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { listDirectory } = require('../../../utils/webdav');
    const path = req.query.path || '/';

    const items = await listDirectory(path);
    const folders = items
      .filter((item) => item.type === 'directory')
      .map((item) => ({
        path: item.filename || item.basename,
        name: item.basename || item.name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json(folders);
  })
);

// Ensure home-owner admin for all users
router.post(
  '/permissions/ensure-home-owner-admin',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { ensureHomeOwnerAdminForAllUsers } = require('../services/cleanupService');
    const result = await ensureHomeOwnerAdminForAllUsers();
    res.json({ success: true, ...result });
  })
);

// Clean up orphaned data
router.post(
  '/cleanup/orphaned',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { cleanupOrphanedData } = require('../services/cleanupService');
    const results = await cleanupOrphanedData();
    res.json({
      messageCode: SERVER_MESSAGE_CODES.admin.orphanCleanupDone,
      results,
    });
  })
);

// Run one garbage-collection cycle (Tier 1 DB-driven + Tier 2 S3 reconciliation)
router.post(
  '/maintenance/gc',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { getComposition } = require('../../../service/composition');
    const { gcService } = getComposition();
    const results = await gcService.runGcCycle();
    res.json({
      messageCode: SERVER_MESSAGE_CODES.admin.gcDone,
      results,
    });
  })
);

// Manually resolve an orphaned node (retry delete or force-mark active)
router.post(
  '/maintenance/repair-sync',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { getComposition } = require('../../../service/composition');
    const { failSafeService } = getComposition();
    const { nodeId, action } = req.body || {};
    const result = await failSafeService.repairNode(Number(nodeId), { action });
    res.json({
      messageCode: SERVER_MESSAGE_CODES.admin.repairSyncDone,
      result,
    });
  })
);

// Permanently delete one node (hard delete; bypasses the trash).
// Interim maintenance/E2E-companion channel (DEF-16 P2): the trash
// purge/empty-trash routes (P3) will supersede it as the user-facing
// permanent delete. WebDAV mode cleans the remote FIRST (trashed node →
// /.wea-trash/<nodeId>; live node → bottom-up display-path delete), then the
// DB removal FK-cascades object_map/filecache/closure/permission/share/recent
// rows. In S3 mode the blob is left for the lazy GC sweep (unchanged
// historical behavior of a hard delete).
router.delete(
  '/maintenance/perm-delete',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { nodeId } = req.body || {};
    const nodeIdValue = Number(nodeId);
    if (!nodeId || !Number.isInteger(nodeIdValue) || nodeIdValue <= 0) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const { getComposition } = require('../../../service/composition');
    const comp = getComposition();

    // Trash-aware existence check: getDescendants includes the depth-0 self
    // row and is UNFILTERED, so trashed rows are still enumerable here.
    const subtreeNodes = await comp.fileNodesStore.getDescendants(nodeIdValue);
    const selfNode = subtreeNodes.find((n) => n.id === nodeIdValue);
    if (!selfNode) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }

    if (comp.fileStorageMode === 'webdav' && comp.blobStore) {
      if (selfNode.deletedAt != null) {
        // Trashed subtree: the remote content was MOVE'd wholesale to the
        // hidden trash path — one DELETE removes the whole moved tree.
        try {
          await comp.blobStore.deleteBlob(buildTrashPath(nodeIdValue));
        } catch (_) {
          /* best-effort — the DB delete proceeds */
        }
      } else {
        const remoteOps = createWebdavRemoteOps({
          blobStore: comp.blobStore,
          fileStorageMode: comp.fileStorageMode,
          fileNodeService: comp.fileNodeService,
        });
        await remoteOps.deleteRemoteSubtreeBestEffort(nodeIdValue);
      }
    }

    await comp.fileNodeService.deleteNode(nodeIdValue);
    res.json({
      messageCode: SERVER_MESSAGE_CODES.admin.permDeleteDone,
      result: { nodeId: nodeIdValue, deletedCount: subtreeNodes.length },
    });
  })
);

module.exports = router;
