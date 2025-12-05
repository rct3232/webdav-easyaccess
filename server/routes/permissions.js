const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');

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
      // 폴더 경로 정규화
      let normalizedPath = folderPath;
      if (!normalizedPath.endsWith('/') && normalizedPath !== '/') {
        normalizedPath = normalizedPath + '/';
      }
      
      const userFolder = `/${user.username}/`;
      
      // 자신의 폴더 내 디렉토리인지 확인
      if (normalizedPath.startsWith(userFolder)) {
        canGrant = true;
      } else {
        // admin 권한이 있는지 확인
        const hasAdmin = await Permission.checkPermission(req.user.id, folderPath, 'admin');
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
    const { userId, folderPath } = req.query;
    
    if (!userId || !folderPath) {
      return res.status(400).json({ error: 'User ID and folder path are required' });
    }

    // Check admin permission
    const hasAdmin = await Permission.checkPermission(req.user.id, folderPath, 'admin');
    if (!hasAdmin && parseInt(userId) !== req.user.id) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
    }

    await Permission.revoke(userId, folderPath);
    res.json({ message: 'Permission revoked successfully' });
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
    const folderPath = req.query.path || '/';
    
    // Check if user has admin permission on this folder
    const hasAdmin = await Permission.checkPermission(req.user.id, folderPath, 'admin');
    if (!hasAdmin) {
      return res.status(403).json({ error: 'Access denied. Admin permission required' });
    }

    const permissions = await Permission.getFolderPermissions(folderPath);
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
    
    // 경로 정규화 함수
    const normalizePath = (path) => {
      if (!path || path === '/') return '/';
      // 끝에 / 제거
      return path.endsWith('/') ? path.slice(0, -1) : path;
    };
    
    // 경로 정규화
    folderPath = normalizePath(folderPath);
    
    // Check read permission (상위 경로 포함)
    // 디렉토리 경로로 체크 (끝에 / 추가)
    const normalizedDirPath = folderPath === '/' ? '/' : folderPath + '/';
    let hasRead = await Permission.checkPermission(req.user.id, normalizedDirPath, 'read');
    
    // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
    if (!hasRead && folderPath !== '/') {
      hasRead = await Permission.checkPermission(req.user.id, folderPath, 'read');
    }
    
    // 상위 경로들을 체크 (예: /a/b/c -> /a/b, /a, /)
    if (!hasRead && folderPath !== '/') {
      const pathParts = folderPath.split('/').filter(Boolean);
      for (let i = pathParts.length; i > 0; i--) {
        const parentPath = '/' + pathParts.slice(0, i).join('/');
        const parentDirPath = parentPath + '/';
        hasRead = await Permission.checkPermission(req.user.id, parentDirPath, 'read');
        if (!hasRead) {
          hasRead = await Permission.checkPermission(req.user.id, parentPath, 'read');
        }
        if (hasRead) {
          break;
        }
      }
    }
    if (!hasRead && folderPath !== '/') {
      hasRead = await Permission.checkPermission(req.user.id, '/', 'read');
    }
    
    // Check write permission - 해당 경로에 직접 부여된 권한만 체크 (상위 경로 체크 제거)
    let hasWrite = await Permission.checkPermission(req.user.id, normalizedDirPath, 'write');
    
    // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
    if (!hasWrite && folderPath !== '/') {
      hasWrite = await Permission.checkPermission(req.user.id, folderPath, 'write');
    }
    
    // 비관리자의 경우 자신의 기본 폴더만 항상 쓰기 권한
    let canWrite = hasWrite;
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      // 정확히 자신의 기본 폴더인 경우만 항상 쓰기 권한
      if (folderPath === userFolder || folderPath === userFolder + '/') {
        canWrite = true;
      }
    } else {
      // 관리자는 모든 경로에 쓰기 권한
      canWrite = true;
    }
    
    res.json({
      path: folderPath,
      hasRead,
      hasWrite: canWrite
    });
  } catch (error) {
    console.error('Check permission error:', error);
    res.status(500).json({ error: 'Failed to check permission' });
  }
});

module.exports = router;

