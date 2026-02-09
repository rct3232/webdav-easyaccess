const express = require('express');
const router = express.Router();
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { createDirectory, listDirectory, pathExists } = require('../utils/webdav');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { canReadFolder, canWriteFolder, isOwnerPath } = require('../utils/permissionPolicy');
const { isMetaPath } = require('../store/metaPaths');
const { asyncHandler, forbiddenError, validationError, conflictError } = require('../utils/errorHandler');
const requireUser = require('../middleware/requireUser');
const { checkMetaPathAccess } = require('../middleware/metaPathGuard');
const normalizePathParam = require('../middleware/normalizePathParam');
const path = require('path');

// Create folder
router.post('/create', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  let { path: folderPath } = req.body;
  if (!folderPath) {
    throw validationError('Folder path is required');
  }

  // Check access for non-admin users
  const user = req.user.full;
  
  // 관리자는 모든 경로에 폴더 생성 가능
  if (!user.is_admin) {
    if (folderPath === '/' || folderPath === '') {
      throw forbiddenError('Access denied');
    }
    if (!isOwnerPath(user, folderPath)) {
      const parentPath = getParentPath(folderPath);
      const ok = await canWriteFolder(user, parentPath);
      if (!ok) {
        throw forbiddenError('Access denied');
      }
    }
  }

  // Normalize folder path
  folderPath = normalizePath(folderPath, { isDirectory: true });

  // Check if folder already exists
  const folderExists = await pathExists(folderPath);
  if (folderExists) {
    const folderName = path.basename(folderPath.slice(0, -1));
    throw conflictError(`폴더 생성 실패: "${folderName}" 이름의 폴더가 이미 존재합니다.`);
  }

  await createDirectory(folderPath);
  
  // 사용자가 생성한 폴더에 대해 자동으로 쓰기 권한 부여
  try {
    await Permission.grant(req.user.id, folderPath, PERMISSIONS.WRITE);
  } catch (permError) {
    console.error('Failed to grant permission after folder creation:', permError);
    // 권한 부여 실패해도 폴더는 생성되었으므로 계속 진행
  }
  
  res.json({ message: 'Folder created successfully', path: folderPath });
}));

// List folder contents
router.get('/list', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  let folderPath = req.query.path || '/';
    
  // Check permission first (effective read)
  const user = req.user.full;
    let hasPermission = true;
    if (!user.is_admin) {
      if (folderPath === '/' || folderPath === '') {
        folderPath = `/${user.username}`;
      }
      hasPermission = await canReadFolder(req.user.id, folderPath, PERMISSIONS.READ);
      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
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

            hasReadPermission = await canReadFolder(req.user.id, normalizedPath, PERMISSIONS.READ);
            hasWritePermission = await canWriteFolder(user, normalizedPath);
          }
        }
        
        // isHidden 플래그 추가
        const isHidden = item.basename.startsWith('.');
        
        return {
          ...item,
          hasReadPermission,
          hasWritePermission,
          isHidden,
        };
      })
    );
    
  res.json(itemsWithPermissions);
}));

module.exports = router;

