const express = require('express');
const router = express.Router();
const path = require('path');

const { authenticateTokenOrShare } = require('../../../utils/auth');
const { getFileContents, isVideoFile } = require('../../../utils/webdav');

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { requireAuth } = require('../../../middleware/requireUser');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const normalizePathParam = require('../../../middleware/normalizePathParam');
const { asyncHandler, validationError, notFoundError } = require('../../../utils/errorHandler');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');
const { checkFilePermission } = require('../../permissions/services/aclService');
const { createOperationProgressStore } = require('../stores/operationProgress');
const { downloadMultiple } = require('../services/downloadService');

const opStore = createOperationProgressStore();

/* ------------------------------------------------------------------ */
/* 1. POST /preview-ticket                                            */
/* ------------------------------------------------------------------ */
router.post('/preview-ticket', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.body?.path;
  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const principalId = req.principalId;
  const hasPermission = await checkFilePermission(principalId, filePath, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const filename = path.basename(filePath);
  if (!isVideoFile(filename)) {
    return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.files.previewNotVideo });
  }

  const ticket = opStore.issuePreviewTicket(principalId, filePath);
  res.json({ ticket });
}));

/* ------------------------------------------------------------------ */
/* 2. GET /preview-stream                                             */
/* ------------------------------------------------------------------ */
router.get('/preview-stream', normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const filePath = req.query.path;
  const ticket = req.query.ticket;

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired);
  }

  const entry = opStore.readPreviewTicket(ticket);
  if (!entry) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketInvalid });
  }

  const normalizedReqPath = normalizePath(filePath);
  const normalizedTicketPath = normalizePath(entry.filePath);
  if (normalizedReqPath !== normalizedTicketPath) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.previewTicketMismatch });
  }

  const hasPermission = await checkFilePermission(entry.principalId, normalizedReqPath, PERMISSIONS.READ);
  if (!hasPermission) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.files.accessDenied });
  }

  const buffer = await getFileContents(normalizedReqPath);
  const filename = path.basename(normalizedReqPath);
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
router.post('/download-multiple', authenticateTokenOrShare, requireAuth, normalizePathParam, checkMetaPathAccess, asyncHandler(async (req, res) => {
  await downloadMultiple(req, res, opStore);
}));

/* ------------------------------------------------------------------ */
/* 4. GET /download-progress/:id                                      */
/* ------------------------------------------------------------------ */
router.get('/download-progress/:id', authenticateTokenOrShare, requireAuth, asyncHandler(async (req, res) => {
  const { id } = req.params;
  const progress = opStore.getDownloadProgress(id);

  if (!progress) {
    throw notFoundError(SERVER_ERROR_CODES.files.progressNotFound);
  }

  res.json(progress);
}));

module.exports = router;
