'use strict';

const express = require('express');
const router = express.Router();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, forbiddenError, validationError, conflictError } = require('../../../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const requireUser = require('../../../middleware/requireUser');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');

const permissionStore = require('../../../store/permissionStore');
const { getComposition } = require('../../../service/composition');

// Create folder
router.post('/create', authenticateToken, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { parentNodeId, name } = req.body;
  if (!name || !parentNodeId) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const parentNodeIdParsed = parseInt(parentNodeId, 10);
  if (isNaN(parentNodeIdParsed) || parentNodeIdParsed <= 0) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const user = req.user.full;
  const userId = req.user.id;
  const principalId = req.principalId;

  if (!user.is_admin) {
    const { aclService } = getComposition();
    const ok = await aclService.checkFolderPermission(principalId, parentNodeIdParsed, PERMISSIONS.WRITE);
    if (!ok) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
  }

  const { fileNodeService } = getComposition();

  const siblings = await fileNodeService.listDirectory(parentNodeIdParsed);
  if (siblings.some(s => s.name === name)) {
    throw conflictError(SERVER_ERROR_CODES.folders.folderAlreadyExists, { folderName: name });
  }

  const dir = await fileNodeService.createDirectory(parentNodeIdParsed, name);

  try {
    await permissionStore.grant(userId, dir.id, PERMISSIONS.WRITE);
  } catch (permError) {
    console.error('Failed to grant permission after folder creation:', permError);
  }

  const display_path = await fileNodeService.getNodePath(dir.id);

  res.json({
    messageCode: SERVER_MESSAGE_CODES.folders.createSuccess,
    nodeId: dir.id,
    name: dir.name,
    path: display_path,
  });
}));

// Get folder recursive statistics
router.get('/stats', authenticateToken, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const nodeIdValue = req.query.nodeId;
  if (!nodeIdValue) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const dirNodeId = parseInt(nodeIdValue, 10);
  if (isNaN(dirNodeId) || dirNodeId <= 0) {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const principalId = req.principalId;
  const user = req.user.full;

  if (!user.is_admin) {
    const { aclService } = getComposition();
    const ok = await aclService.checkFolderPermission(principalId, dirNodeId, PERMISSIONS.READ);
    if (!ok) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
  }

  const { fileNodeService } = getComposition();
  const node = await fileNodeService.getNode(dirNodeId);
  if (!node || node.type !== 'directory') {
    throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
  }

  const descendantIds = await fileNodeService.getDescendantIds(dirNodeId);

  let totalFiles = 0;
  let totalFolders = 0;
  let totalSize = 0;

  for (const descId of descendantIds) {
    if (descId === dirNodeId) continue;
    const child = await fileNodeService.getNode(descId);
    if (!child) continue;
    if (child.type === 'directory') {
      totalFolders++;
    } else {
      totalFiles++;
      totalSize += child.size || 0;
    }
  }

  res.json({
    nodeId: dirNodeId,
    name: node.name,
    totalFiles,
    totalFolders,
    totalSize,
  });
}));

module.exports = router;
