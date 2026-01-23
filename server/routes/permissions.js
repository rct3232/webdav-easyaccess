const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const { normalizePath, normalizePathWithSlash } = require('../utils/pathUtils');
const { canReadFolder, canWriteFolder, hasDirectFolderPermission, isOwnerPath, canGrantPermission, canRevokePermission, canViewPermissions } = require('../utils/permissionPolicy');
const requireUser = require('../middleware/requireUser');
const normalizePathParam = require('../middleware/normalizePathParam');
const { asyncHandler, validationError, forbiddenError } = require('../utils/errorHandler');

// Grant permission
router.post('/grant', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, folderPath, permission } = req.body;
  
  if (!userId || !folderPath || !permission) {
    throw validationError('User ID, folder path, and permission are required');
  }

  if (!['read', 'write', 'admin'].includes(permission)) {
    throw validationError('Invalid permission. Must be read, write, or admin');
  }

  const user = req.user.full;

  // Check if user has permission to grant access to this folder
  const canGrant = await canGrantPermission(user, folderPath, req.user.id);

  if (!canGrant) {
    throw forbiddenError('Access denied. You do not have permission to share this folder');
  }

  await Permission.grant(userId, folderPath, permission);
  res.json({ message: 'Permission granted successfully' });
}));

// Revoke permission
router.delete('/revoke', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  const { userId, folderPath, includeSubfolders } = req.query;
  
  if (!userId || !folderPath) {
    throw validationError('User ID and folder path are required');
  }

  // Check if user has permission to revoke access to this folder
  const requestingUser = req.user.full;
  const targetUserId = parseInt(userId);
  
  const canRevoke = await canRevokePermission(requestingUser, folderPath, req.user.id, targetUserId);
  
  if (!canRevoke) {
    throw forbiddenError('Access denied. You do not have permission to revoke access to this folder');
  }

  const normalizedFolderPath = normalizePath(folderPath);
  const normalizedFolderPathWithSlash = normalizePathWithSlash(folderPath);

  if (includeSubfolders === 'true') {
    // 하위 폴더 포함하여 모든 권한 삭제
    const allPermissions = await Permission.getUserPermissions(userId);
    
    // 해당 폴더와 하위 폴더의 권한만 필터링
    const permissionsToRevoke = allPermissions.filter(perm => {
      const normalizedPermPath = normalizePath(perm.folder_path);
      return normalizedPermPath === normalizedFolderPath || 
             (normalizedPermPath.startsWith(normalizedFolderPathWithSlash) && 
              normalizedPermPath.length > normalizedFolderPathWithSlash.length);
    });
    
    // 각 권한을 삭제
    let deletedCount = 0;
    for (const perm of permissionsToRevoke) {
      try {
        await Permission.revoke(userId, perm.folder_path);
        deletedCount++;
      } catch (error) {
        console.error(`Failed to revoke permission for ${perm.folder_path}:`, error);
      }
    }
    
    res.json({ 
      message: 'Permission revoked successfully',
      deletedCount 
    });
  } else {
    // 해당 폴더만 삭제
    await Permission.revoke(userId, folderPath);
    res.json({ message: 'Permission revoked successfully' });
  }
}));

// Get user permissions
router.get('/user/:userId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const userId = req.params.userId;
  
  // Users can only view their own permissions unless they're checking for admin purposes
  if (parseInt(userId) !== req.user.id) {
    throw forbiddenError('Access denied');
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
  
  // Check if user has permission to view permissions for this folder
  const canView = await canViewPermissions(user, folderPath, req.user.id);

  if (!canView) {
    throw forbiddenError('Access denied. You do not have permission to view permissions for this folder');
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
    // 해당 폴더만
    permissions = await Permission.getFolderPermissions(folderPath);
    
    // 반환된 권한의 경로도 정규화 (끝에 / 제거)
    permissions = permissions.map(perm => ({
      ...perm,
      folder_path: normalizePath(perm.folder_path)
    }));
  }
  
  res.json(permissions);
}));

// Check current user's permission for a specific path
router.get('/check', authenticateToken, requireUser, normalizePathParam, asyncHandler(async (req, res) => {
  let folderPath = req.query.path || '/';
  const user = req.user.full;
  
  // 경로 정규화
  folderPath = normalizePath(folderPath);

  const hasRead = await canReadFolder(req.user.id, folderPath, 'read');
  const hasWrite = await canWriteFolder(user, folderPath);

  res.json({
    path: folderPath,
    hasRead,
    hasWrite
  });
}));

module.exports = router;

