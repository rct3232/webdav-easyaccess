'use strict';

const express = require('express');
const router = express.Router({ mergeParams: true });
const multer = require('multer');

const { authenticateToken, authenticateTokenOrShare } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = requireUser;
const { asyncHandler, validationError, notFoundError } = require('../../../utils/errorHandler');
const { parseNodeId } = require('../../../middleware/validateNodeIdParam');

const { getConflictsByNodeIds } = require('../services/conflictResolver');

const { isSharePrincipal } = require('../../permissions/services/aclService');

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');

const { getComposition } = require('../../../service/composition');

const upload = multer({ storage: multer.memoryStorage(), preservePath: true });

function requireTokenNotShare(req, res, next) {
  if (isSharePrincipal(req.principalId)) {
    return res
      .status(HTTP_STATUS.FORBIDDEN)
      .json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }
  next();
}

const METADATA_PATHS_LIMIT = 100;

router.post(
  '/check-conflicts',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { operations, limit = true } = req.body;
    if (!operations || !Array.isArray(operations)) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const conflicts = await getConflictsByNodeIds(operations, { limit });
    res.json({ conflicts });
  })
);

// Legacy-URL bootstrap resolver (nodeId-first navigation): resolves a path string to a nodeId.
// Sole path-accepting endpoint; documented exception to the nodeId-only rule (PLAN.md Rule 13).
router.post(
  '/resolve-path',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const { path } = req.body;
    if (typeof path !== 'string' || path.length === 0) {
      throw validationError(SERVER_ERROR_CODES.files.invalidPath);
    }

    const { fileNodeService } = getComposition();
    const node = await fileNodeService.resolvePath(path);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }

    res.json({ nodeId: node.id });
  })
);

router.post(
  '/metadata',
  authenticateTokenOrShare,
  requireAuth,
  asyncHandler(async (req, res) => {
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
  })
);

router.get(
  '/list',
  authenticateTokenOrShare,
  requireAuth,
  asyncHandler(async (req, res) => {
    const principalId = req.principalId;

    let parentNodeId;
    if (req.query.nodeId != null && req.query.nodeId !== '') {
      parentNodeId = parseNodeId(req.query.nodeId, 'nodeId');
    } else {
      parentNodeId = null;
    }

    const user = req.user?.full;
    const { fileService } = getComposition();
    const itemsWithThumbnails = await fileService.listDirectoryWithPermissions(
      principalId,
      parentNodeId,
      user
    );

    res.json(itemsWithThumbnails);
  })
);

router.get(
  '/ancestors',
  authenticateTokenOrShare,
  requireAuth,
  asyncHandler(async (req, res) => {
    const nodeId = parseNodeId(req.query.nodeId, 'nodeId');

    const { fileNodeService, fileNodesStore } = getComposition();
    const node = await fileNodeService.getNode(nodeId);
    if (!node) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }

    const chain = await fileNodesStore.getAncestorChain(nodeId);
    const ancestorIds = chain.map((entry) => entry.ancestorId);
    if (ancestorIds[ancestorIds.length - 1] !== nodeId) {
      ancestorIds.push(nodeId);
    }

    const ancestors = [];
    for (const ancestorId of ancestorIds) {
      const ancestorNode = await fileNodeService.getNode(ancestorId);
      if (ancestorNode) {
        ancestors.push({ nodeId: ancestorNode.id, name: ancestorNode.name });
      }
    }

    res.json({ ancestors });
  })
);

router.get(
  '/download',
  authenticateTokenOrShare,
  requireAuth,
  asyncHandler(async (req, res) => {
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
    const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_'); // eslint-disable-line no-control-regex
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
    res.setHeader(
      'Content-Disposition',
      `${disposition}; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`
    );

    if (inline) {
      res.setHeader('Content-Type', getContentType(filename));
    } else {
      res.setHeader('Content-Type', 'application/octet-stream');
    }

    await sendBufferAsChunks(res, buffer);
  })
);

router.post(
  '/upload',
  authenticateToken,
  requireAuth,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw validationError(SERVER_ERROR_CODES.files.invalidPath);
    }

    let originalFilename = req.file.originalname;
    try {
      // eslint-disable-next-line no-control-regex
      if (/[\x00-\x7F]/.test(originalFilename)) {
        const latin1Buffer = Buffer.from(originalFilename, 'latin1');
        originalFilename = latin1Buffer.toString('utf8');
      }
    } catch {
      /* latin1→utf8 detection is best-effort */
    }

    const parentNodeIdValue = req.body.parentNodeId;
    const uploadUser = req.user.full;
    // Root-level upload (parentNodeId null) is admin-only: the filesystem root
    // `/` is the admin's home. Multipart form fields arrive as strings, so
    // normalize "null"/"undefined" to null.
    const isRootUpload =
      parentNodeIdValue == null ||
      parentNodeIdValue === '' ||
      parentNodeIdValue === 'null' ||
      parentNodeIdValue === 'undefined';
    if (isRootUpload && !uploadUser.is_admin) {
      throw validationError(SERVER_ERROR_CODES.files.invalidPath);
    }
    const parentNodeId = isRootUpload ? null : parseNodeId(parentNodeIdValue, 'parentNodeId');
    const { onConflict } = req.body;

    const mimeType =
      req.file.mimeType ||
      originalFilename.mimetype ||
      getContentType(originalFilename) ||
      'application/octet-stream';

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
      onConflict
    );

    if (result.skipped) {
      res.json({
        messageCode: SERVER_MESSAGE_CODES.files.uploadSkipped,
        nodeId: result.nodeId,
        skipped: true,
      });
    } else {
      res.json({ messageCode: SERVER_MESSAGE_CODES.files.uploadSuccess, nodeId: result.nodeId });
    }
  })
);

router.put(
  '/rename',
  authenticateTokenOrShare,
  requireAuth,
  requireTokenNotShare,
  requireUser,
  asyncHandler(async (req, res) => {
    const { nodeId, newName } = req.body;
    if (!nodeId || !newName) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const fileNodeId = parseNodeId(nodeId, 'nodeId');
    const principalId = req.principalId;
    const user = req.user.full;
    const { fileService } = getComposition();

    const result = await fileService.renameNode(fileNodeId, newName, principalId, user);

    res.json({
      messageCode: SERVER_MESSAGE_CODES.files.renameSuccess,
      nodeId: result.nodeId,
      newName: result.newName,
    });
  })
);

router.post(
  '/move',
  authenticateToken,
  requireAuth,
  asyncHandler(async (req, res) => {
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

    res.json({
      messageCode: SERVER_MESSAGE_CODES.files.moveSuccess,
      nodeId: result.nodeId,
      newParentId: result.newParentId,
    });
  })
);

router.post(
  '/copy',
  authenticateToken,
  requireAuth,
  asyncHandler(async (req, res) => {
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
      user
    );

    res.json({
      messageCode: SERVER_MESSAGE_CODES.files.copySuccess,
      sourceNodeId: result.sourceNodeId,
      copiedNodeId: result.copiedNodeId,
    });
  })
);

router.delete(
  '/delete',
  authenticateToken,
  requireAuth,
  asyncHandler(async (req, res) => {
    const { nodeId } = req.body;
    if (!nodeId) {
      throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
    }

    const fileNodeId = parseNodeId(nodeId, 'nodeId');
    const principalId = req.principalId;
    const user = req.user.full;
    const { fileService } = getComposition();

    const result = await fileService.deleteNode(fileNodeId, principalId, user);

    res.json({
      messageCode: SERVER_MESSAGE_CODES.files.deleteSuccess,
      nodeId: fileNodeId,
      deletedCount: result.deletedCount,
    });
  })
);

module.exports = router;
