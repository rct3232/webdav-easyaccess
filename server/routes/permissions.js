const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const { normalizePath, normalizePathWithSlash } = require('../utils/pathUtils');
const { canReadFolder, canWriteFolder, hasDirectFolderPermission, isOwnerPath } = require('../utils/permissionPolicy');

// Grant permission
router.post('/grant', authenticateToken, async (req, res) => {
  try {
    const { userId, folderPath, permission } = req.body;
    
    if (!userId || !folderPath || !permission) {
      return res.status(400).json({ error: 'User ID, folder path, and permission are required' });
    }

    if (!['read', 'write', 'admin'].includes(permission)) {
      return res.status(400).json({ error: 'Invalid permission. Must be read, write, or admin' });
    }

    const User = require('../models/User');
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }

    // Check if user has permission to grant access to this folder
    let canGrant = false;
    
    // 관리자는 모든 폴더에 대해 권한 부여 가능
    if (user.is_admin) {
      canGrant = true;
    } else {
      if (isOwnerPath(user, folderPath)) {
        canGrant = true;
      } else {
        const hasAdmin = await hasDirectFolderPermission(req.user.id, folderPath, 'admin');
        if (hasAdmin) {
          canGrant = true;
        }
      }
    }

    if (!canGrant) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to share this folder' });
    }

    await Permission.grant(userId, folderPath, permission);
    res.json({ message: 'Permission granted successfully' });
  } catch (error) {
    console.error('Grant permission error:', error);
    res.status(500).json({ error: 'Failed to grant permission' });
  }
});

// Revoke permission
router.delete('/revoke', authenticateToken, async (req, res) => {
  try {
    const { userId, folderPath, includeSubfolders } = req.query;
    
    if (!userId || !folderPath) {
      return res.status(400).json({ error: 'User ID and folder path are required' });
    }

    // Check admin permission (global admin bypasses per-folder admin checks)
    const User = require('../models/User');
    const requestingUser = await User.findById(req.user.id);
    let hasAdmin = false;
    if (requestingUser && requestingUser.is_admin) {
      hasAdmin = true;
    } else {
      hasAdmin = await hasDirectFolderPermission(req.user.id, folderPath, 'admin');
    }
    if (!hasAdmin && parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
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
  } catch (error) {
    console.error('Revoke permission error:', error);
    res.status(500).json({ error: 'Failed to revoke permission' });
  }
});

// Get user permissions
router.get('/user/:userId', authenticateToken, async (req, res) => {
  try {
    const userId = req.params.userId;
    
    // Users can only view their own permissions unless they're checking for admin purposes
    if (parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Access denied' });
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
  } catch (error) {
    console.error('Get user permissions error:', error);
    res.status(500).json({ error: 'Failed to get user permissions' });
  }
});

// Get folder permissions
router.get('/folder', authenticateToken, async (req, res) => {
  try {
    let folderPath = req.query.path || '/';
    const includeSubfolders = req.query.includeSubfolders === 'true';
    
    folderPath = normalizePath(folderPath);
    
    const User = require('../models/User');
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    // Check if user has permission to view permissions for this folder
    let canView = false;
    
    // 관리자는 모든 폴더의 권한 정보를 볼 수 있음
    if (user.is_admin) {
      canView = true;
    } else {
      if (isOwnerPath(user, folderPath)) {
        canView = true;
      } else {
        const hasAdmin = await hasDirectFolderPermission(req.user.id, folderPath, 'admin');
        if (hasAdmin) {
          canView = true;
        }
      }
    }

    if (!canView) {
      return res.status(403).json({ error: 'Access denied. You do not have permission to view permissions for this folder' });
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
  } catch (error) {
    console.error('Get folder permissions error:', error);
    res.status(500).json({ error: 'Failed to get folder permissions' });
  }
});

// Check current user's permission for a specific path
router.get('/check', authenticateToken, async (req, res) => {
  try {
    let folderPath = req.query.path || '/';
    const User = require('../models/User');
    const user = await User.findById(req.user.id);
    
    if (!user) {
      return res.status(403).json({ error: 'User not found' });
    }
    
    // 경로 정규화
    folderPath = normalizePath(folderPath);

    const hasRead = await canReadFolder(req.user.id, folderPath, 'read');
    const hasWrite = await canWriteFolder(user, folderPath);

    res.json({
      path: folderPath,
      hasRead,
      hasWrite
    });
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

module.exports = router;

