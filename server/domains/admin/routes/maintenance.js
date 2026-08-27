const express = require('express');
const router = express.Router();
const {
  HTTP_STATUS,
} = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get folder list for admin (single level)
router.get('/folders/list', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { listDirectory } = require('../../../utils/webdav');
  const path = req.query.path || '/';

  const items = await listDirectory(path);
  const folders = items
    .filter(item => item.type === 'directory')
    .map(item => ({
      path: item.filename || item.basename,
      name: item.basename || item.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json(folders);
}));

// Ensure home-owner admin for all users
router.post('/permissions/ensure-home-owner-admin', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { ensureHomeOwnerAdminForAllUsers } = require('../services/cleanupService');
  const result = await ensureHomeOwnerAdminForAllUsers();
  res.json({ success: true, ...result });
}));

// Clean up orphaned data
router.post('/cleanup/orphaned', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { cleanupOrphanedData } = require('../services/cleanupService');
  const results = await cleanupOrphanedData();
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.orphanCleanupDone,
    results,
  });
}));

// Run one garbage-collection cycle (Tier 1 DB-driven + Tier 2 S3 reconciliation)
router.post('/maintenance/gc', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { gcService } = getComposition();
  const results = await gcService.runGcCycle();
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.gcDone,
    results,
  });
}));

// Manually resolve an orphaned node (retry delete or force-mark active)
router.post('/maintenance/repair-sync', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { getComposition } = require('../../../service/composition');
  const { failSafeService } = getComposition();
  const { nodeId, action } = req.body || {};
  const result = await failSafeService.repairNode(Number(nodeId), { action });
  res.json({
    messageCode: SERVER_MESSAGE_CODES.admin.repairSyncDone,
    result,
  });
}));

module.exports = router;