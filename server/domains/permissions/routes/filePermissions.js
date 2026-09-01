const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const permissionStore = require('../stores/permissionStore');
const { canGrantPermissionNode, canRevokePermissionNode } = require('../policy/permissionPolicy');
const requireUser = require('../../../middleware/requireUser');
const {
  asyncHandler,
  validationError,
  forbiddenError,
  notFoundError,
} = require('../../../utils/errorHandler');
const { createFileNodesStore } = require('../../../store/fileNodesStore');

const fileNodesStore = createFileNodesStore();

// Grant file permission (nodeId-based)
router.post(
  '/file/grant',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { userId, fileNodeId, permission } = req.body;

    if (!userId || !fileNodeId || !permission) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    if (!PERMISSIONS.isValid(permission)) {
      throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
    }

    const node = await fileNodesStore.getNode(fileNodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
    }
    if (node.type !== 'file') {
      throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
    }

    const requestingUserId = req.user.id;
    // Check grant permission on parent directory of the file
    const parentNodeId = node.parentId;
    if (!parentNodeId) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
    const canGrant = await canGrantPermissionNode(requestingUserId, parentNodeId);
    if (!canGrant) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }

    await permissionStore.grantFilePermission(userId, fileNodeId, permission);
    res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.filePermissionGranted });
  })
);

// Revoke file permission (nodeId-based)
router.delete(
  '/file/revoke',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = req.query.userId;
    const fileNodeId = req.query.fileNodeId;

    if (!userId || !fileNodeId) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    const node = await fileNodesStore.getNode(fileNodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
    }

    const requestingUserId = req.user.id;
    const targetUserId = parseInt(userId, 10);
    // Check revoke permission on parent directory of the file
    const parentNodeId = node.parentId;
    if (!parentNodeId) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
    const canRevoke = await canRevokePermissionNode(requestingUserId, parentNodeId, targetUserId);
    if (!canRevoke) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }

    await permissionStore.revokeFilePermission(userId, fileNodeId);
    res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.filePermissionRevoked });
  })
);

// Update file permission (nodeId-based)
router.patch(
  '/file',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { userId, fileNodeId, permission } = req.body;

    if (!userId || !fileNodeId || !permission) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    if (!PERMISSIONS.isValid(permission)) {
      throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
    }

    const node = await fileNodesStore.getNode(fileNodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
    }
    if (node.type !== 'file') {
      throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
    }

    const requestingUserId = req.user.id;
    // Check grant permission on parent directory of the file
    const parentNodeId = node.parentId;
    if (!parentNodeId) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
    const canGrant = await canGrantPermissionNode(requestingUserId, parentNodeId);
    if (!canGrant) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }

    await permissionStore.grantFilePermission(userId, fileNodeId, permission);
    res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.filePermissionUpdated });
  })
);

// Check current user's effective permission for a file node (nodeId-based)
router.get(
  '/file/check',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const fileNodeId = req.query.fileNodeId;

    if (!fileNodeId) {
      throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
    }

    const node = await fileNodesStore.getNode(fileNodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
    }

    const userId = req.user.id;
    // File-specific permission takes precedence
    const filePerm = await permissionStore.getFilePermission(userId, fileNodeId);
    const source = filePerm != null ? 'file' : 'path';

    // Effective: check file-level first, then ancestor directory permissions via closure table
    const effectivePerm = await permissionStore.getEffectivePermission(userId, fileNodeId);
    const hasRead = effectivePerm
      ? PERMISSIONS.isValid(effectivePerm) &&
        (effectivePerm === PERMISSIONS.READ ||
          effectivePerm === PERMISSIONS.WRITE ||
          effectivePerm === PERMISSIONS.ADMIN)
      : false;
    const hasWrite = effectivePerm
      ? effectivePerm === PERMISSIONS.WRITE || effectivePerm === PERMISSIONS.ADMIN
      : false;

    res.json({
      nodeId: Number(fileNodeId),
      hasRead,
      hasWrite,
      source,
    });
  })
);

// List current user's file-level permissions (nodeId-based, optional parent filter)
router.get(
  '/file/list',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const userId = req.user.id;
    const parentNodeId = req.query.parentNodeId || undefined;

    let list = await permissionStore.getUserFilePermissions(userId);

    // Exclude the user's own home subtree: file-level self-grants on files under
    // the user's home root must never surface (mirrors GET /shared exclusion).
    const homeRoot = await fileNodesStore.getUserRootNode(userId);
    if (homeRoot) {
      const ownDescendants = await fileNodesStore.getDescendants(homeRoot.id);
      const ownIds = new Set(ownDescendants.map((d) => d.id));
      list = list.filter(({ file_node_id }) => !ownIds.has(file_node_id));
    }

    if (parentNodeId != null && parentNodeId !== '') {
      // Filter to files that are descendants of the given parent node
      const descendants = await fileNodesStore.getDescendants(Number(parentNodeId));
      const descendantIds = new Set(descendants.map((d) => d.id));
      list = list.filter(({ file_node_id }) => descendantIds.has(file_node_id));
    }

    res.json(list);
  })
);

module.exports = router;
