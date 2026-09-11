const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError, validationError } = require('../../../utils/errorHandler');

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

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
// Maintenance/E2E-companion channel: the user-facing permanent delete is the
// trash purge route (DEF-16 P3) — this admin route delegates to the SAME
// shared purge core (`trashService.purgeNode`): WebDAV mode cleans the remote
// FIRST (trashed node → /.wea-trash/<nodeId> (+ the covered-by-ancestor trash
// path); live node → bottom-up display-path delete), then the DB removal
// FK-cascades object_map/filecache/closure/permission/share/recent rows. In
// S3 mode the subtree's object_map blobs are now deleted eagerly (active +
// history + orphaned) instead of being left for the lazy GC sweep.
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

    const result = await comp.trashService.purgeNode(nodeIdValue);
    res.json({
      messageCode: SERVER_MESSAGE_CODES.admin.permDeleteDone,
      result: { nodeId: nodeIdValue, deletedCount: result.purgedNodes },
    });
  })
);

module.exports = router;
