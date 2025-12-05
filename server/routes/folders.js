const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { createDirectory, listDirectory, pathExists } = require('../utils/webdav');
const path = require('path');

// Helper function to check permissions
// 상위 경로에 권한이 있으면 하위 경로도 접근 가능
async function checkFolderPermission(userId, folderPath, requiredPermission = 'read') {
  // 정확한 경로에 권한이 있는지 먼저 체크
  const hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  if (hasPermission) {
    return true;
  }
  
  // 상위 경로들을 체크 (예: /a/b/c -> /a/b, /a, /)
  const pathParts = folderPath.split('/').filter(Boolean);
  for (let i = pathParts.length; i > 0; i--) {
    const parentPath = '/' + pathParts.slice(0, i).join('/');
    const parentPermission = await Permission.checkPermission(userId, parentPath, requiredPermission);
    if (parentPermission) {
      return true;
    }
  }
  
  // 루트 경로 체크
  if (folderPath !== '/') {
    return await Permission.checkPermission(userId, '/', requiredPermission);
  }
  
  return false;
}

// Create folder
router.post('/create', authenticateToken, async (req, res) => {
  try {
    let { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }

    // Check access for non-admin users
    const user = await User.findById(req.user.id);
    
    // 관리자는 모든 경로에 폴더 생성 가능
    if (!user.is_admin) {
      const userFolder = `/${user.username}`;
      if (folderPath === '/' || folderPath === '') {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!folderPath.startsWith(userFolder)) {
        // 공유된 폴더인지 권한 체크 - 부모 폴더에 직접 쓰기 권한이 있어야 함 (상위 경로 체크 안 함)
        const parentPath = path.dirname(folderPath) || '/';
        // 경로 정규화
        let normalizedParentPath = parentPath;
        if (normalizedParentPath !== '/') {
          if (!normalizedParentPath.endsWith('/')) {
            normalizedParentPath = normalizedParentPath + '/';
          }
        }
        // 부모 폴더에 직접 쓰기 권한이 있는지 확인 (상위 경로 체크 제거)
        const hasPermission = await Permission.checkPermission(req.user.id, normalizedParentPath, 'write');
        // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
        if (!hasPermission && parentPath !== '/' && !parentPath.endsWith('/')) {
          const hasPermissionNoSlash = await Permission.checkPermission(req.user.id, parentPath, 'write');
          if (hasPermissionNoSlash) {
            // 허용
          } else {
            return res.status(403).json({ error: 'Access denied' });
          }
        } else if (!hasPermission) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }

    // Normalize folder path
    if (!folderPath.startsWith('/')) {
      folderPath = '/' + folderPath;
    }
    if (!folderPath.endsWith('/')) {
      folderPath = folderPath + '/';
    }

    // Check if folder already exists
    const folderExists = await pathExists(folderPath);
    if (folderExists) {
      const folderName = path.basename(folderPath.slice(0, -1));
      return res.status(409).json({ 
        error: `폴더 생성 실패: "${folderName}" 이름의 폴더가 이미 존재합니다.` 
      });
    }

    await createDirectory(folderPath);
    
    // 사용자가 생성한 폴더에 대해 자동으로 쓰기 권한 부여
    try {
      await Permission.grant(req.user.id, folderPath, 'write');
      console.log(`Granted write permission to user ${req.user.id} for folder ${folderPath}`);
    } catch (permError) {
      console.error('Failed to grant permission after folder creation:', permError);
      // 권한 부여 실패해도 폴더는 생성되었으므로 계속 진행
    }
    
    res.json({ message: 'Folder created successfully', path: folderPath });
  } catch (error) {
    console.error('Create folder error:', error);
    res.status(500).json({ error: error.message || 'Failed to create folder' });
  }
});

// List folder contents
router.get('/list', authenticateToken, async (req, res) => {
  try {
    let folderPath = req.query.path || '/';
    
    // Check permission first
    const user = await User.findById(req.user.id);
    
    // 관리자는 모든 경로에 접근 가능
    let hasPermission = true;
    if (!user.is_admin) {
      hasPermission = await checkFolderPermission(req.user.id, folderPath, 'read');
      
      if (!hasPermission) {
        // 권한이 없으면, 비관리자의 경우 자신의 폴더인지 확인
        const userFolder = `/${user.username}`;
        if (folderPath === '/' || folderPath === '') {
          folderPath = userFolder;
        } else if (!folderPath.startsWith(userFolder)) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }

    const items = await listDirectory(folderPath);
    
    // 각 항목에 대한 권한 체크 및 권한 정보 포함
    const itemsWithPermissions = await Promise.all(
      items.map(async (item) => {
        // 권한 체크 (모든 항목에 대해)
        let hasReadPermission = true;
        let hasWritePermission = true;
        
        if (item.type === 'directory') {
          // 관리자는 모든 디렉토리에 접근 가능
          if (user.is_admin) {
            hasReadPermission = true;
            hasWritePermission = true;
          } else {
            const fullPath = folderPath === '/' 
              ? '/' + item.basename 
              : (folderPath.endsWith('/') ? folderPath : folderPath + '/') + item.basename;
            const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');
            
            // 디렉토리 경로 정규화 (끝에 / 추가)
            const normalizedDirPath = normalizedPath.endsWith('/') ? normalizedPath : normalizedPath + '/';
            
            // 해당 경로에 직접 권한이 있는지 확인
            hasReadPermission = await Permission.checkPermission(req.user.id, normalizedDirPath, 'read');
            
            // 경로 끝에 /가 없는 경우도 체크 (하위 호환성)
            if (!hasReadPermission && !normalizedPath.endsWith('/')) {
              hasReadPermission = await Permission.checkPermission(req.user.id, normalizedPath, 'read');
            }
            
            // 비관리자의 경우 자신의 폴더인지 확인 (항상 표시)
            if (!hasReadPermission) {
              const userFolder = `/${user.username}`;
              if (normalizedPath.startsWith(userFolder) || normalizedDirPath.startsWith(userFolder)) {
                hasReadPermission = true;
                hasWritePermission = true;
              }
            }
            
            // 쓰기 권한 체크
            if (hasReadPermission) {
              hasWritePermission = await Permission.checkPermission(req.user.id, normalizedDirPath, 'write');
              if (!hasWritePermission && !normalizedPath.endsWith('/')) {
                hasWritePermission = await Permission.checkPermission(req.user.id, normalizedPath, 'write');
              }
              
              // 자신의 폴더인 경우 쓰기 권한 확인
              if (!hasWritePermission) {
                const userFolder = `/${user.username}`;
                if (normalizedPath.startsWith(userFolder) || normalizedDirPath.startsWith(userFolder)) {
                  hasWritePermission = true;
                }
              }
            }
          }
        }
        
        return {
          ...item,
          hasReadPermission,
          hasWritePermission,
        };
      })
    );
    
    res.json(itemsWithPermissions);
  } catch (error) {
    console.error('List folder error:', error);
    res.status(500).json({ error: error.message || 'Failed to list folder' });
  }
});

module.exports = router;

