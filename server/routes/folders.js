const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { authenticateToken } = require('../utils/auth');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { createDirectory, pathExists } = require('../utils/webdav');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { canWriteFolder, isOwnerPath, getHomeOwnerUserIdForPath } = require('../utils/permissionPolicy');
const { isMetaPath } = require('../store/metaPaths');
const { asyncHandler, forbiddenError, validationError, conflictError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const requireUser = require('../middleware/requireUser');
const { checkMetaPathAccess } = require('../middleware/metaPathGuard');
const normalizePathParam = require('../middleware/normalizePathParam');
const path = require('path');

// Create folder
router.post('/create', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  let { path: folderPath } = req.body;
  if (!folderPath) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  // Check access for non-admin users
  const user = req.user.full;
  
  // 관리자는 모든 경로에 폴더 생성 가능
  if (!user.is_admin) {
    if (folderPath === '/' || folderPath === '') {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
    if (!isOwnerPath(user, folderPath)) {
      const parentPath = getParentPath(folderPath);
      const ok = await canWriteFolder(user, parentPath);
      if (!ok) {
        throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
      }
    }
  }

  // Normalize folder path
  folderPath = normalizePath(folderPath, { isDirectory: true });

  // Check if folder already exists
  const folderExists = await pathExists(folderPath);
  if (folderExists) {
    const folderName = path.basename(folderPath.slice(0, -1));
    throw conflictError(SERVER_ERROR_CODES.folders.folderAlreadyExists, { folderName });
  }

  await createDirectory(folderPath);
  
  // 사용자가 생성한 폴더에 대해 자동으로 쓰기 권한 부여
  try {
    await Permission.grant(req.user.id, folderPath, PERMISSIONS.WRITE);
  } catch (permError) {
    console.error('Failed to grant permission after folder creation:', permError);
    // 권한 부여 실패해도 폴더는 생성되었으므로 계속 진행
  }

  // 홈 디렉토리 소유자에게 해당 폴더에 대한 ADMIN 부여
  try {
    const homeOwnerId = await getHomeOwnerUserIdForPath(folderPath);
    if (homeOwnerId != null) {
      await Permission.grant(homeOwnerId, folderPath, PERMISSIONS.ADMIN);
    }
  } catch (permError) {
    console.error('Failed to grant home owner admin permission after folder creation:', permError);
  }

  res.json({ messageCode: SERVER_MESSAGE_CODES.folders.createSuccess, path: folderPath });
}));

module.exports = router;

