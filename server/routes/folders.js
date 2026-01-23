const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { createDirectory, listDirectory, pathExists } = require('../utils/webdav');
const { normalizePath, normalizePathWithSlash, getParentPath } = require('../utils/pathUtils');
const { canReadFolder, canWriteFolder, isOwnerPath } = require('../utils/permissionPolicy');
const { isMetaPath } = require('../store/metaPaths');
const path = require('path');

function rejectMetaPath(res) {
  return res.status(403).json({ error: 'Access denied' });
}

// Create folder
router.post('/create', authenticateToken, async (req, res) => {
  try {
    let { path: folderPath } = req.body;
    if (!folderPath) {
      return res.status(400).json({ error: 'Folder path is required' });
    }
    if (isMetaPath(folderPath)) {
      return rejectMetaPath(res);
    }

    // Check access for non-admin users
    const user = await User.findById(req.user.id);
    
    // 관리자는 모든 경로에 폴더 생성 가능
    if (!user.is_admin) {
      if (folderPath === '/' || folderPath === '') {
        return res.status(403).json({ error: 'Access denied' });
      }
      if (!isOwnerPath(user, folderPath)) {
        const parentPath = path.posix.dirname(folderPath) || '/';
        const ok = await canWriteFolder(user, parentPath);
        if (!ok) {
          return res.status(403).json({ error: 'Access denied' });
        }
      }
    }

    // Normalize folder path
    folderPath = normalizePathWithSlash(folderPath);
    if (isMetaPath(folderPath)) {
      return rejectMetaPath(res);
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
    if (isMetaPath(folderPath)) {
      return rejectMetaPath(res);
    }
    
    // Check permission first (effective read)
    const user = await User.findById(req.user.id);
    let hasPermission = true;
    if (!user.is_admin) {
      if (folderPath === '/' || folderPath === '') {
        folderPath = `/${user.username}`;
      }
      hasPermission = await canReadFolder(req.user.id, folderPath, 'read');
      if (!hasPermission) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const items = await listDirectory(folderPath);
    // Admin인 경우 .wea 폴더도 반환 (필터링은 클라이언트에서 처리)
    // 일반 사용자는 여전히 필터링 (보안)
    const filteredItems = user.is_admin 
      ? items 
      : items.filter(item => item.basename !== '.wea');
    
    // 각 항목에 대한 권한 체크 및 권한 정보 포함
    const itemsWithPermissions = await Promise.all(
      filteredItems.map(async (item) => {
        // 권한 체크 (모든 항목에 대해)
        let hasReadPermission = true;
        let hasWritePermission = true;
        
        if (item.type === 'directory') {
          if (user.is_admin) {
            hasReadPermission = true;
            hasWritePermission = true;
          } else {
            const fullPath = folderPath === '/' 
              ? '/' + item.basename 
              : (folderPath.endsWith('/') ? folderPath : folderPath + '/') + item.basename;
            const normalizedPath = fullPath.replace(/\\/g, '/').replace(/\/+/g, '/');

            hasReadPermission = await canReadFolder(req.user.id, normalizedPath, 'read');
            hasWritePermission = await canWriteFolder(user, normalizedPath);
          }
        }
        
        // isHidden 플래그 추가
        const isHidden = item.basename === '.wea';
        
        return {
          ...item,
          hasReadPermission,
          hasWritePermission,
          isHidden,
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

