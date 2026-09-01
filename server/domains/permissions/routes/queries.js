const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const permissionStore = require('../stores/permissionStore');
const { meetsRank } = require('../policy/permissionRank');
const requireUser = require('../../../middleware/requireUser');
const { asyncHandler, validationError, notFoundError } = require('../../../utils/errorHandler');
const { createFileNodesStore } = require('../../../store/fileNodesStore');

const fileNodesStore = createFileNodesStore();

// Check current user's effective permission for a node (nodeId-based)
router.get(
  '/check',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const nodeId = req.query.nodeId;

    if (!nodeId && nodeId !== 0) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    const node = await fileNodesStore.getNode(nodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
    }

    // Admin users bypass ACL checks: their home is the filesystem root `/`, so they
    // hold no grant rows and any nested folder would otherwise report no access,
    // hiding the create/upload FAB and drag-drop in the admin UI. Mirrors the admin
    // bypass applied by every other server check.
    if (req.user.is_admin || req.user.full?.is_admin) {
      return res.json({
        nodeId: Number(nodeId),
        hasRead: true,
        hasWrite: true,
        source: 'admin',
      });
    }

    const userId = req.user.id;

    // File-specific permission takes precedence for file nodes
    let effective = null;
    let source = 'path';

    if (node.type === 'file') {
      const filePerm = await permissionStore.getFilePermission(userId, nodeId);
      if (filePerm) {
        effective = filePerm.permission;
        source = 'file';
      }
    }

    // Fall back to ancestor directory traversal via closure table
    if (!effective && node.type === 'directory') {
      effective = await permissionStore.getPathEffectivePermission(userId, nodeId);
    } else if (!effective && node.type === 'file') {
      effective = await permissionStore.getEffectivePermission(userId, nodeId);
      source = effective ? (source === 'file' ? 'file' : 'path') : null;
    }

    const hasRead = effective ? meetsRank(effective, PERMISSIONS.READ) : false;
    const hasWrite = effective ? meetsRank(effective, PERMISSIONS.WRITE) : false;

    res.json({
      nodeId: Number(nodeId),
      hasRead,
      hasWrite,
      source: effective ? source : 'none',
    });
  })
);

module.exports = router;
