'use strict';

const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { authenticateToken } = require('../../../utils/auth');
const PermissionFacade = require('../../../domains/permissions/services/permissionFacade');
const { createFileStoreAdapter } = require('../../../infrastructure/adapters/filestore');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { canWriteFolder, isOwnerPath, getHomeOwnerUserIdForPath } = require('../../../utils/permissionPolicy');
const { isMetaPath } = require('../../../store/metaPaths');
const { asyncHandler, forbiddenError, validationError, conflictError } = require('../../../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const requireUser = require('../../../middleware/requireUser');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const path = require('path');

// Create folder
router.post('/create', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  let { path: folderPath } = req.body;
  if (!folderPath) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const user = req.user.full;

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

  folderPath = normalizePath(folderPath, { isDirectory: true });

  const webdav = createFileStoreAdapter();
  const folderExists = await webdav.pathExists(folderPath);
  if (folderExists) {
    const folderName = path.basename(folderPath.slice(0, -1));
    throw conflictError(SERVER_ERROR_CODES.folders.folderAlreadyExists, { folderName });
  }

  await webdav.createDirectory(folderPath);

  try {
    await PermissionFacade.grant(req.user.id, folderPath, PERMISSIONS.WRITE);
  } catch (permError) {
    console.error('Failed to grant permission after folder creation:', permError);
  }

  try {
    const homeOwnerId = await getHomeOwnerUserIdForPath(folderPath);
    if (homeOwnerId != null) {
      await PermissionFacade.grant(homeOwnerId, folderPath, PERMISSIONS.ADMIN);
    }
  } catch (permError) {
    console.error('Failed to grant home owner admin permission after folder creation:', permError);
  }

  res.json({ messageCode: SERVER_MESSAGE_CODES.folders.createSuccess, path: folderPath });
}));

// Get folder recursive statistics
router.get('/stats', authenticateToken, requireUser, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { path: folderPath } = req.query;
  if (!folderPath) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const user = req.user.full;
  if (!user.is_admin) {
    const { canReadFolder } = require('../../../utils/permissionPolicy');
    const ok = await canReadFolder(user.id, folderPath);
    if (!ok) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
  }

  const { getRecursiveFolderStats } = require('../../../utils/webdav');
  const stats = await getRecursiveFolderStats(folderPath);
  res.json(stats);
}));

module.exports = router;
