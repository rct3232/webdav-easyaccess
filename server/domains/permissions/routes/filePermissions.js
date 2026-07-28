const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../../../utils/auth');
const Permission = require('../../../models/Permission');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { canGrantPermission, canRevokePermission } = require('../../../utils/permissionPolicy');
const requireUser = require('../../../middleware/requireUser');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError } = require('../../../utils/errorHandler');

// Grant file permission (permission must be strictly higher than parent path permission)
router.post('/file/grant', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, filePath, permission } = req.body;
  if (!userId || !filePath || !permission) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }
  if (!PERMISSIONS.isValid(permission)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
  }
  const user = req.user.full;
  const parentPath = getParentPath(normalizePath(filePath));
  const canGrant = await canGrantPermission(user, parentPath, req.user.id);
  if (!canGrant) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }
  try {
    await Permission.grantFile(userId, filePath, permission);
    res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.filePermissionGranted });
  } catch (err) {
    if (err.code === 'PATH_IS_ADMIN' || err.code === 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH' || err.code === 'INVALID_PERMISSION') {
      throw validationError(SERVER_ERROR_CODES.permissions.permissionHigherThanParent);
    }
    throw err;
  }
}));

// Revoke file permission
router.delete('/file/revoke', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, filePath } = req.query;
  if (!userId || !filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }
  const requestingUser = req.user.full;
  const targetUserId = parseInt(userId, 10);
  const parentPath = getParentPath(normalizePath(filePath));
  const canRevoke = await canRevokePermission(requestingUser, parentPath, req.user.id, targetUserId);
  if (!canRevoke) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }
  await Permission.revokeFile(userId, filePath);
  res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.filePermissionRevoked });
}));

// Update file permission (same validation as grant)
router.patch('/file', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, filePath, permission } = req.body;
  if (!userId || !filePath || !permission) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }
  if (!PERMISSIONS.isValid(permission)) {
    throw validationError(SERVER_ERROR_CODES.permissionRequests.invalidPermission);
  }
  const user = req.user.full;
  const parentPath = getParentPath(normalizePath(filePath));
  const canGrant = await canGrantPermission(user, parentPath, req.user.id);
  if (!canGrant) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }
  try {
    await Permission.grantFile(userId, filePath, permission);
    res.json({ messageCode: SERVER_MESSAGE_CODES.permissions.filePermissionUpdated });
  } catch (err) {
    if (err.code === 'PATH_IS_ADMIN' || err.code === 'FILE_PERMISSION_NOT_HIGHER_THAN_PATH' || err.code === 'INVALID_PERMISSION') {
      throw validationError(SERVER_ERROR_CODES.permissions.permissionHigherThanParent);
    }
    throw err;
  }
}));

// Check current user's effective permission for a file path (file-level overrides path)
router.get('/file/check', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const pathParam = req.query.path;
  if (!pathParam) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }
  const filePath = normalizePath(pathParam);
  const doc = await Permission.getPermissionDoc(req.user.id);
  const fp = doc.file_permissions || {};
  const filePerm = fp[filePath];
  const source = filePerm != null ? 'file' : 'path';
  const { checkFilePermission } = require('../../../middleware/permissions');
  const hasRead = await checkFilePermission(req.user.id, filePath, PERMISSIONS.READ);
  const hasWrite = await checkFilePermission(req.user.id, filePath, PERMISSIONS.WRITE);
  res.json({
    path: filePath,
    hasRead,
    hasWrite,
    source
  });
}));

// List current user's file-level permissions (optionally under a folder)
router.get('/file/list', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const folderPath = req.query.folderPath ? normalizePath(req.query.folderPath) : null;
  let list = await Permission.getUserFilePermissions(userId);
  if (folderPath != null && folderPath !== '') {
    const prefix = folderPath === '/' ? '/' : `${folderPath.replace(/\/$/, '')}/`;
    list = list.filter(({ filePath }) => {
      const p = normalizePath(filePath);
      return p === folderPath || p.startsWith(prefix);
    });
  }
  res.json(list);
}));

module.exports = router;
