'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const path = require('path');
const multer = require('multer');

const { authenticateToken, authenticateTokenOrShare } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = requireUser;
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const { asyncHandler, validationError, forbiddenError, notFoundError, conflictError } = require('../../../utils/errorHandler');

const { getConflicts } = require('../services/conflictResolver');

const { isSharePrincipal } = require('../../permissions/services/aclService');

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');

const { getComposition } = require('../../../service/composition');

const upload = multer({ storage: multer.memoryStorage(), preservePath: true });

function requireTokenNotShare(req, res, next) {
  if (isSharePrincipal(req.principalId)) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }
  next();
}

function parseNodeId(value, fieldName = 'nodeId') {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed <= 0) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
  }
  return parsed;
}

const METADATA_PATHS_LIMIT = 100;

router.post('/check-conflicts', authenticateToken, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { operations, limit = true } = req.body;
  if (!operations || !Array.isArray(operations)) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const conflicts = await getConflicts(operations, { limit });
  res.json({ conflicts });
}));

router.post('/metadata', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const nodeIds = req.body.nodeIds;
  if (!Array.isArray(nodeIds)) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }
  if (nodeIds.length > METADATA_PATHS_LIMIT) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
  }

  const principalId = req.principalId;
  const { fileNodeService, aclService } = getComposition();
  const results = [];

  for (const nodeId of nodeIds) {
    const parsedId = parseNodeId(nodeId, 'nodeId');
    const hasRead = await aclService.checkFilePermission(principalId, parsedId, PERMISSIONS.READ);
    if (!hasRead) continue;

    try {
      const node = await fileNodeService.getNode(parsedId);
      if (node) {
        results.push({
          nodeId: node.id,
          name: node.name,
          type: node.type,
          size: null,
          lastmod: node.updatedAt,
          mime: null,
        });
      }
    } catch (err) {
      if (err.status !== HTTP_STATUS.NOT_FOUND) {
        console.error(`[files/metadata] getNode failed for nodeId ${parsedId}:`, err.message);
      }
    }
  }

  res.json(results);
}));

router.get('/list', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const principalId = req.principalId;
  const isShare = isSharePrincipal(principalId);

  let parentNodeId;
  if (req.query.nodeId != null && req.query.nodeId !== '') {
    parentNodeId = parseNodeId(req.query.nodeId, 'nodeId');
  } else {
    parentNodeId = null;
  }

  const user = req.user?.full;
  const { fileService } = getComposition();
  const itemsWithThumbnails = await fileService.listDirectoryWithPermissions(principalId, parentNodeId, user);

  res.json(itemsWithThumbnails);
}));

router.get('/download', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const nodeIdValue = req.query.nodeId;
  const inline = req.query.inline === 'true';

  if (!nodeIdValue) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const fileNodeId = parseNodeId(nodeIdValue, 'nodeId');
  const principalId = req.principalId;
  const user = req.user?.full;
  const { fileService } = getComposition();

  const buffer = await fileService.downloadFile(fileNodeId, principalId, user);
  if (!buffer) {
    throw notFoundError(SERVER_ERROR_CODES.files.notFound);
  }

  const { fileNodeService } = getComposition();
  const node = await fileNodeService.getNode(fileNodeId);
  const filename = node ? node.name : 'download';
  const encodedFilename = encodeURIComponent(filename);
  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');
  const disposition = inline ? 'inline' : 'attachment';
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Disposition', `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);

  if (inline) {
    res.setHeader('Content-Type', getContentType(filename));
  } else {
    res.setHeader('Content-Type', 'application/octet-stream');
  }

  await sendBufferAsChunks(res, buffer);
}));

router.post('/upload', authenticateToken, requireUser, checkMetaPathAccess, upload.single('file'), asyncHandler(async (req, res) => {
  if (!req.file) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
  }

  let originalFilename = req.file.originalname;
  try {
    if (/[\x00-\x7F]/.test(originalFilename)) {
      const latin1Buffer = Buffer.from(originalFilename, 'latin1');
      originalFilename = latin1Buffer.toString('utf8');
    }
  } catch (e) {}

  const parentNodeIdValue = req.body.parentNodeId;
  if (!parentNodeIdValue) {
    throw validationError(SERVER_ERROR_CODES.files.invalidPath);
  }
  const parentNodeId = parseNodeId(parentNodeIdValue, 'parentNodeId');
  const { onConflict } = req.body;

  const mimeType = req.file.mimeType || originalFilename.mimetype || getContentType(originalFilename) || 'application/octet-stream';

  const principalId = req.principalId;
  const user = req.user.full;
  const { fileService } = getComposition();

  const result = await fileService.uploadFile(
    principalId,
    parentNodeId,
    originalFilename,
    req.file.buffer,
    mimeType,
    user,
    onConflict,
  );

  if (result.skipped) {
    res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSkipped, nodeId: result.nodeId, skipped: true });
  } else {
    res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSuccess, nodeId: result.nodeId });
  }
}));

router.put('/rename', authenticateTokenOrShare, requireAuth, requireTokenNotShare, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { nodeId, newName } = req.body;
  if (!nodeId || !newName) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const fileNodeId = parseNodeId(nodeId, 'nodeId');
  const principalId = req.principalId;
  const user = req.user.full;
  const { fileService } = getComposition();

  const result = await fileService.renameNode(fileNodeId, newName, principalId, user);

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.renameSuccess, nodeId: result.nodeId, newName: result.newName });
}));

router.post('/move', authenticateToken, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { nodeId, destinationParentNodeId } = req.body;
  if (!nodeId || !destinationParentNodeId) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const fileNodeId = parseNodeId(nodeId, 'nodeId');
  const destParentNodeId = parseNodeId(destinationParentNodeId, 'destinationParentNodeId');
  const principalId = req.principalId;
  const user = req.user.full;
  const { fileService } = getComposition();

  const result = await fileService.moveNode(fileNodeId, destParentNodeId, principalId, user);

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.renameSuccess, nodeId: result.nodeId, newParentId: result.newParentId });
}));

router.post('/copy', authenticateToken, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { nodeId, destinationParentNodeId, newName } = req.body;
  if (!nodeId || !destinationParentNodeId) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const sourceNodeId = parseNodeId(nodeId, 'nodeId');
  const destParentNodeId = parseNodeId(destinationParentNodeId, 'destinationParentNodeId');
  const principalId = req.principalId;
  const user = req.user.full;
  const { fileService } = getComposition();

  const result = await fileService.copyFile(
    sourceNodeId,
    destParentNodeId,
    newName || null,
    principalId,
    user,
  );

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSuccess, sourceNodeId: result.sourceNodeId, copiedNodeId: result.copiedNodeId });
}));

router.delete('/delete', authenticateToken, requireUser, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { nodeId } = req.body;
  if (!nodeId) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const fileNodeId = parseNodeId(nodeId, 'nodeId');
  const principalId = req.principalId;
  const user = req.user.full;
  const { fileService } = getComposition();

  const result = await fileService.deleteNode(fileNodeId, principalId, user);

  res.json({ messageCode: SERVER_MESSAGE_CODES.files.renameSuccess, nodeId: fileNodeId, deletedCount: result.deletedCount });
}));

module.exports = router;
