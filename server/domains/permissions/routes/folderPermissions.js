const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const permissionStore = require('../stores/permissionStore');
const { canGrantPermissionNode, canRevokePermissionNode, canViewPermissionsNode } = require('../policy/permissionPolicy');
const requireUser = require('../../../middleware/requireUser');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../../../utils/errorHandler');
const User = require('../../../models/User');
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const {
  getExistenceState,
  makeUserPermissionsEtag,
  queueReconciliation,
} = require('../stores/permissionExistenceIndex');

const fileNodesStore = createFileNodesStore();

// Grant permission (directory-level; nodeId-based)
router.post('/grant', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { userId, nodeId, permission } = req.body;

  if (!userId || !nodeId || !permission) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  if (!PERMISSIONS.isValid(permission)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
  }

 const node = await fileNodesStore.getNode(nodeId);
  if (!node) {
    throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
  }
  if (node.type !== 'directory') {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const requestingUserId = req.user.id;
  const canGrant = await canGrantPermissionNode(requestingUserId, nodeId);
  if (!canGrant) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  await permissionStore.grant(userId, nodeId, permission);
  res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.permissionGranted });
}));

// Revoke permission (nodeId-based)
router.delete('/revoke', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const userId = req.query.userId;
  const nodeId = req.query.nodeId;
  const includeDescendants = req.query.includeDescendants === 'true';

  if (!userId || !nodeId) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const node = await fileNodesStore.getNode(nodeId);
  if (!node) {
    throw notFoundError(SERVER_ERROR_CODES.files.nodeNotFound);
  }

  const requestingUserId = req.user.id;
  const targetUserId = parseInt(userId, 10);
  const canRevoke = await canRevokePermissionNode(requestingUserId, nodeId, targetUserId);
  if (!canRevoke) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  if (includeDescendants) {
    const descendantIds = await fileNodesStore.getDescendantIds(nodeId);
    const failures = [];
    let deletedCount = 0;
    for (const descId of descendantIds) {
      try {
        await permissionStore.revoke(userId, descId);
        deletedCount++;
      } catch (error) {
        failures.push({ nodeId: descId, reason: error.message || 'unknown' });
      }
    }
    return res.json({
      messageCode: SERVER_MESSAGE_CODES.permissions.permissionRevoked,
      deletedCount,
      ...(failures.length > 0 && { partialFailures: failures }),
    });
  }

  await permissionStore.revoke(userId, nodeId);
  res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.permissionRevoked });
}));

// Get user permissions (nodeId-based response)
router.get('/user/:userId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  const requestingUser = await User.findById(req.user.id);

  if (!requestingUser) {
    throw notFoundError(SERVER_ERROR_CODES.auth.userNotFound);
  }
  // Admins can view any user's permissions; regular users can only view their own
  if (!requestingUser.is_admin && parseInt(userId) !== req.user.id) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  const rawPermissions = await permissionStore.getUserPermissions(userId);
  const permissions = rawPermissions.map(p => ({ nodeId: p.file_node_id, permission: p.permission }));
  const responseEtag = makeUserPermissionsEtag(userId, undefined);
  res.setHeader('ETag', responseEtag);
  const ifNoneMatch = req.headers?.['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === responseEtag) {
    return res.status(304).end();
  }

  // Filter permissions based on node existence; queue reconciliation for unknown states
  const filteredPermissions = await Promise.all(permissions.map(async (perm) => {
    try {
      const node = await fileNodesStore.getNode(perm.nodeId);
      if (node) {
        return perm;
      }
    } catch { /* ignore */ }

    // Node not found or error — check existence index
    const state = getExistenceState(String(perm.nodeId));
    if (state === 'exists') {
      return perm;
    }
    if (state === 'missing') {
      return null;
    }
    queueReconciliation(String(perm.nodeId));
    return perm;
  }));

  res.json(filteredPermissions.filter(Boolean));
}));

// Get folder permissions (nodeId-based)
router.get('/folder', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const nodeId = req.query.nodeId;
  const includeDescendants = req.query.includeDescendants === 'true';
  const fileNodeId = req.query.fileNodeId || undefined;

  if (!nodeId) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const node = await fileNodesStore.getNode(nodeId);
  if (!node) {
    throw notFoundError(SERVER_ERROR_CODES.webdav.fileOrFolderNotFound);
  }

  const canView = await canViewPermissionsNode(req.user.id, nodeId);
  if (!canView && !fileNodeId) {
    throw forbiddenError(SERVER_ERROR_CODES.permissions.viewPermissionsDenied);
  }
  if (!canView && fileNodeId) {
    // Check if user can read the specific file
    const { checkFilePermission: aclCheckFilePermission } = require('../services/aclService');
    const hasRead = await aclCheckFilePermission(req.user.id, Number(fileNodeId), PERMISSIONS.READ);
    if (!hasRead) {
      throw forbiddenError(SERVER_ERROR_CODES.permissions.viewPermissionsDenied);
    }
  }

  let permissions;
  if (includeDescendants) {
    const descendantIds = await fileNodesStore.getDescendantIds(nodeId);
    // Fetch all permissions for descendant nodes
    const allPerms = [];
    for (const descId of descendantIds) {
      const perms = await permissionStore.getFolderPermissions(descId, fileNodeId ? Number(fileNodeId) : undefined);
      allPerms.push(...perms);
    }
    // Also include the parent node itself
    const parentPerms = await permissionStore.getFolderPermissions(nodeId, fileNodeId ? Number(fileNodeId) : undefined);
    permissions = [...parentPerms, ...allPerms];
  } else {
    permissions = await permissionStore.getFolderPermissions(
      nodeId,
      fileNodeId ? Number(fileNodeId) : undefined
    );
  }

  res.json(permissions.map(perm => ({
    ...perm,
    node_id: perm.node_id || null,
  })));
}));

module.exports = router;
