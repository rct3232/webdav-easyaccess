'use strict';

const express = require('express');
const router = express.Router();
const path = require('path');

const { authenticateTokenOrShare } = require('../../../utils/auth');
const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { requireAuth } = require('../../../middleware/requireUser');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const { asyncHandler, validationError, notFoundError } = require('../../../utils/errorHandler');
const { parseNodeId } = require('../../../middleware/validateNodeIdParam');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');
const { createOperationProgressStore } = require('../stores/operationProgress');
const { getComposition } = require('../../../service/composition');

const opStore = createOperationProgressStore();

/* ------------------------------------------------------------------ */
/* 1. POST /preview-ticket                                            */
/* ------------------------------------------------------------------ */
router.post('/preview-ticket', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { nodeId } = req.body || {};
  if (!nodeId) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const fileNodeId = parseNodeId(nodeId, 'nodeId');
  const principalId = req.principalId;

  const { aclService, fileNodeService } = getComposition();
  const hasPermission = await aclService.checkFilePermission(principalId, fileNodeId, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const node = await fileNodeService.getNode(fileNodeId);
  if (!node) {
    throw notFoundError(SERVER_ERROR_CODES.files.notFound);
  }

  const filename = node.name;
  if (!/\.(mp4|webm|ogg|mov|m4v)$/i.test(filename)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.files.previewNotVideo });
  }

  const ticket = opStore.issuePreviewTicket(principalId, fileNodeId);
  res.json({ ticket });
}));

/* ------------------------------------------------------------------ */
/* 2. GET /preview-stream                                             */
/* ------------------------------------------------------------------ */
router.get('/preview-stream', checkMetaPathAccess, asyncHandler(async (req, res) => {
  const nodeIdValue = req.query.nodeId;
  const ticket = req.query.ticket;

  if (!nodeIdValue) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const fileNodeId = parseNodeId(nodeIdValue, 'nodeId');

  const entry = opStore.readPreviewTicket(ticket);
  if (!entry) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketInvalid });
  }

  if (entry.fileNodeId !== fileNodeId) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketMismatch });
  }

  const { aclService, blobStorageService, fileNodeService } = getComposition();
  const hasPermission = await aclService.checkFilePermission(entry.principalId, fileNodeId, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const buffer = await blobStorageService.downloadBlob(fileNodeId);
  if (!buffer) {
    throw notFoundError(SERVER_ERROR_CODES.files.notFound);
  }

  const node = await fileNodeService.getNode(fileNodeId);
  const filename = node ? node.name : 'preview';
  const encodedFilename = encodeURIComponent(filename);
  const asciiFilename = filename.replace(/[^\x00-\x7F]/g, '_');

  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.setHeader('Content-Disposition', `inline; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`);
  res.setHeader('Content-Type', getContentType(filename));
  res.setHeader('Content-Length', buffer.length);
  res.setHeader('Accept-Ranges', 'bytes');

  await sendBufferAsChunks(res, buffer);
}));

/* ------------------------------------------------------------------ */
/* 3. POST /download-multiple                                         */
/* ------------------------------------------------------------------ */
router.post('/download-multiple', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { nodeIds } = req.body || {};
  if (!nodeIds || !Array.isArray(nodeIds) || nodeIds.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const parsedNodeIds = nodeIds.map(id => parseNodeId(id, 'nodeId'));

  const principalId = req.principalId;
  const user = req.user?.full;

  const { downloadService } = getComposition();

  const result = await downloadService.downloadMultiple(parsedNodeIds, principalId, user);

  const { zipStream: archive, totalFiles, downloadId, errors } = result;

  const zipName = (parsedNodeIds.length === 1 && totalFiles === 1)
    ? path.basename(String(parsedNodeIds[0]), path.extname(String(parsedNodeIds[0])))
    : 'download';

  const encodedZipName = encodeURIComponent(`${zipName}.zip`);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, X-WEA-Skipped-Count, X-WEA-Skipped');
  res.setHeader('X-WEA-Skipped-Count', String(errors.length));

  if (errors.length > 0) {
    const maxLen = 7000;
    let payload = {
      paths: errors.slice(0, 100).map(e => String(e.nodeId)),
      truncated: errors.length > 100,
    };
    let encoded = encodeURIComponent(JSON.stringify(payload));

    while (encoded.length > maxLen && payload.paths.length > 0) {
      payload.paths.pop();
      payload.truncated = true;
      encoded = encodeURIComponent(JSON.stringify(payload));
    }

    if (encoded.length > maxLen) {
      encoded = encodeURIComponent(JSON.stringify({ paths: [], truncated: true }));
    }

    res.setHeader('X-WEA-Skipped', encoded);
  } else {
    res.setHeader('X-WEA-Skipped', encodeURIComponent(JSON.stringify({ paths: [], truncated: false })));
  }

  res.setHeader('Content-Disposition', `attachment; filename="${zipName}.zip"; filename*=UTF-8''${encodedZipName}`);

  archive.on('error', (err) => {
    console.error('Archive error:', err);
    opStore.setDownloadProgress(downloadId, {
      status: 'error',
      progress: 0,
      total: totalFiles,
      current: '',
      zipName: `${zipName}.zip`,
      errorCode: SERVER_ERROR_CODES.files.zipFail,
    });
  });

  archive.pipe(res);
  await archive.finalize();

  opStore.setDownloadProgress(downloadId, {
    status: 'completed',
    progress: totalFiles,
    total: totalFiles,
    current: '',
    zipName: `${zipName}.zip`,
  });

  opStore.cleanupDownloadProgress(downloadId);
}));

/* ------------------------------------------------------------------ */
/* 4. GET /download-progress/:id                                      */
/* ------------------------------------------------------------------ */
router.get('/download-progress/:id', authenticateTokenOrShare, requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;

  const { downloadService } = getComposition();
  const progress = downloadService.getDownloadProgress(id);

  if (!progress) {
    throw notFoundError(SERVER_ERROR_CODES.files.progressNotFound);
  }

  res.json(progress);
}));

module.exports = router;
