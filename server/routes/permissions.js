const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { canReadFolder, canReadFile, canWriteFolder, canGrantPermission, canRevokePermission, canViewPermissions } = require('../utils/permissionPolicy');
const requireUser = require('../middleware/requireUser');
const normalizePathParam = require('../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../utils/errorHandler');
const User = require('../models/User');

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
  // 관리자는 모든 사용자의 권한 조회 가능, 일반 사용자는 본인만
  if (!requestingUser.is_admin && parseInt(userId) !== req.user.id) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  const permissions = await Permission.getUserPermissions(userId);
    
    // WebDAV에 실제로 존재하는 폴더만 필터링
    const { pathExists } = require('../utils/webdav');
    const existingPermissions = await Promise.all(
      permissions.map(async (perm) => {
        try {
          // 디렉토리 경로 확인 (끝에 / 있는 경우와 없는 경우 모두 확인)
          let exists = await pathExists(perm.folder_path);
          
          // 끝에 /가 없는 경우, /를 추가해서도 확인
          if (!exists && !perm.folder_path.endsWith('/')) {
            exists = await pathExists(perm.folder_path + '/');
          }
          
          // 끝에 /가 있는 경우, /를 제거해서도 확인
          if (!exists && perm.folder_path.endsWith('/') && perm.folder_path !== '/') {
            const pathWithoutSlash = perm.folder_path.slice(0, -1);
            exists = await pathExists(pathWithoutSlash);
          }
          
          return exists ? perm : null;
        } catch (error) {
          // 폴더 확인 실패 시 제외
          console.error(`Failed to check folder existence for ${perm.folder_path}:`, error);
          return null;
        }
      })
    );
    
  // null 값 필터링 (존재하지 않는 폴더 제거)
  const filteredPermissions = existingPermissions.filter(perm => perm !== null);
  
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
    // 하위 폴더 포함하여 권한 정보 가져오기
    // hasPermissionsInPath는 내부적으로 경로 끝에 /를 추가하므로 그대로 전달
    permissions = await Permission.hasPermissionsInPath(folderPath);
    
    // 반환된 권한의 경로도 정규화 (끝에 / 제거)
    permissions = permissions.map(perm => ({
      ...perm,
      folder_path: normalizePath(perm.folder_path)
    }));
  } else {
    // 해당 폴더만 (파일 공유 시 filePath로 해당 파일 독립권한 포함)
    const filePath = req.query.filePath || undefined;
    permissions = await Permission.getFolderPermissions(folderPath, filePath);

    // 반환된 권한의 경로도 정규화 (끝에 / 제거)
    permissions = permissions.map(perm => ({
      ...perm,
      folder_path: normalizePath(perm.folder_path)
    }));
  }
  
  res.json(permissions);
}));

// Check current user's effective permission for a path (folder or file; file-level overrides path)
router.get('/check', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  let path = req.query.path || '/';
  path = normalizePath(path);

  const effective = await Permission.getEffectivePermission(req.user.id, path);
  const filePerm = await Permission.getFilePermission(req.user.id, path);
  const rank = effective ? PERMISSIONS.ALL.indexOf(effective) : -1;
  const hasRead = rank >= 0;
  const hasWrite = rank >= 1;
  const source = filePerm != null ? 'file' : 'path';

  res.json({
    path,
    hasRead,
    hasWrite,
    source,
  });
}));

// --- File-level permission routes ---

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
  const { checkFilePermission } = require('../middleware/permissions');
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

