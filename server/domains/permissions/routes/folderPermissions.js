const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const Permission = require('../../../models/Permission');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { canReadFile, canGrantPermission, canRevokePermission, canViewPermissions } = require('../../../utils/permissionPolicy');
const requireUser = require('../../../middleware/requireUser');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../../../utils/errorHandler');
const User = require('../../../models/User');
const {
  getExistenceState,
  makeUserPermissionsEtag,
  queueReconciliation,
} = require('../../../store/permissionExistenceIndex');

// Grant permission (folder or file; use target: 'file' for file-level)
router.post('/grant', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, folderPath, permission, target } = req.body;

  if (!userId || !folderPath || !permission) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  if (!PERMISSIONS.isValid(permission)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
  }

  const user = req.user.full;
  const isFile = target === 'file';
  const pathForCheck = isFile ? getParentPath(normalizePath(folderPath)) : folderPath;

  const canGrant = await canGrantPermission(user, pathForCheck, req.user.id);
  if (!canGrant) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  const options = isFile ? { target: 'file' } : {};
  try {
    await Permission.grant(userId, folderPath, permission, options);
  } catch (err) {
    if (err.code === 'PATH_IS_ADMIN' || err.code === 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH' || err.code === 'INVALID_PERMISSION') {
      throw validationError(SERVER_ERROR_CODES.permissions.permissionHigherThanParent);
    }
    throw err;
  }
  res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.permissionGranted });
}));

// Revoke permission (folder or file; use scope: 'pathOnly' for file-level only)
router.delete('/revoke', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, folderPath, includeSubfolders, scope } = req.query;

  if (!userId || !folderPath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const requestingUser = req.user.full;
  const targetUserId = parseInt(userId, 10);
  const isPathOnly = scope === 'pathOnly';
  const pathForCheck = isPathOnly ? getParentPath(normalizePath(folderPath)) : folderPath;

  const canRevoke = await canRevokePermission(requestingUser, pathForCheck, req.user.id, targetUserId);
  if (!canRevoke) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  if (isPathOnly) {
    await Permission.revoke(userId, folderPath, { scope: 'pathOnly' });
    return res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.permissionRevoked });
  }

  const normalizedFolderPath = normalizePath(folderPath);
  const normalizedFolderPathWithSlash = normalizePath(folderPath, { isDirectory: true });

  if (includeSubfolders === 'true') {
    const allPermissions = await Permission.getUserPermissions(userId);
    const permissionsToRevoke = allPermissions.filter(perm => {
      const normalizedPermPath = normalizePath(perm.folder_path);
      return normalizedPermPath === normalizedFolderPath ||
             (normalizedPermPath.startsWith(normalizedFolderPathWithSlash) &&
              normalizedPermPath.length > normalizedFolderPathWithSlash.length);
    });
    let deletedCount = 0;
    for (const perm of permissionsToRevoke) {
      try {
        await Permission.revoke(userId, perm.folder_path);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to revoke permission for ${perm.folder_path}:`, error);
      }
    }
    return res.json({
      messageCode: SERVER_MESSAGE_CODES.permissions.permissionRevoked,
      deletedCount,
    });
  }

  await Permission.revoke(userId, folderPath);
  res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.permissionRevoked });
}));

// Get user permissions
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

  const permissionDoc = await Permission.getPermissionDoc(userId);
  const permissions = Object.entries(permissionDoc?.permissions || {}).map(([folder_path, permission]) => ({ folder_path, permission }));
  const responseEtag = makeUserPermissionsEtag(userId, permissionDoc?.updated_at);
  res.setHeader('ETag', responseEtag);
  const ifNoneMatch = req.headers?.['if-none-match'];
  if (ifNoneMatch && ifNoneMatch === responseEtag) {
    return res.status(304).end();
  }

  const filteredPermissions = permissions.filter((perm) => {
    const state = getExistenceState(perm.folder_path);
    if (state === 'exists') {
      return true;
    }
    if (state === 'missing') {
      return false;
    }
    queueReconciliation(perm.folder_path);
    return true;
  });

  res.json(filteredPermissions);
}));

// Get folder permissions
router.get('/folder', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  let folderPath = req.query.path || '/';
  const includeSubfolders = req.query.includeSubfolders === 'true';

  folderPath = normalizePath(folderPath);

  const user = req.user.full;

  let canView = await canViewPermissions(user, folderPath, req.user.id);
  if (!canView) {
    const filePath = req.query.filePath || undefined;
    if (filePath) {
      const normalizedFile = normalizePath(filePath);
      canView = await canReadFile(req.user.id, normalizedFile, PERMISSIONS.READ);
    }
  }
  if (!canView) {
    throw forbiddenError(SERVER_ERROR_CODES.permissions.viewPermissionsDenied);
  }

  let permissions;
  if (includeSubfolders) {
    // Fetch permission info including subfolders
    // hasPermissionsInPath internally appends / to the path, so pass as-is
    permissions = await Permission.hasPermissionsInPath(folderPath);

    // Normalize returned permission paths (remove trailing /)
    permissions = permissions.map(perm => ({
      ...perm,
      folder_path: normalizePath(perm.folder_path)
    }));
  } else {
    // This folder only (including file-specific permissions when filePath is provided)
    const filePath = req.query.filePath || undefined;
    permissions = await Permission.getFolderPermissions(folderPath, filePath);

    // Normalize returned permission paths (remove trailing /)
    permissions = permissions.map(perm => ({
      ...perm,
      folder_path: normalizePath(perm.folder_path)
    }));
  }

  res.json(permissions);
}));

module.exports = router;
