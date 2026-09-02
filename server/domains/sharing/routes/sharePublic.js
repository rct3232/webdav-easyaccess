const express = require('express');
const router = express.Router();
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler } = require('../../../utils/errorHandler');
const { authenticateToken } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { sendBufferAsChunks } = require('../../../utils/responseWriter');
const shareAccessService = require('../services/shareAccessService');

function handleServiceError(res, result) {
  return res.status(result.status).json({ errorCode: SERVER_ERROR_CODES.share[result.code] });
}

router.get(
  '/:token/check-my-permission',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const result = await shareAccessService.checkUserSharePermission(req.params.token, req.user.id);
    if (result.error) return handleServiceError(res, result);
    res.json(result.data);
  })
);

router.post(
  '/:token/add-to-my-permissions',
  authenticateToken,
  requireUser,
  asyncHandler(async (req, res) => {
    const result = await shareAccessService.addToMyPermissions(req.params.token, req.user.id);
    if (result.error) return handleServiceError(res, result);
    res.json({ messageCode: SERVER_MESSAGE_CODES.share[result.data.messageCode] });
  })
);

router.get(
  '/:token/info',
  asyncHandler(async (req, res) => {
    const result = await shareAccessService.getShareLinkMetadata(req.params.token);
    if (result.error) return handleServiceError(res, result);
    res.json(result.data);
  })
);

router.get(
  '/:token/preview',
  asyncHandler(async (req, res) => {
    const result = await shareAccessService.previewFile(req.params.token);
    if (result.error) return handleServiceError(res, result);
    const { buffer, fileName, contentType } = result.data;
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', buffer.length);
    await sendBufferAsChunks(res, buffer);
  })
);

router.get(
  '/:token',
  asyncHandler(async (req, res) => {
    const result = await shareAccessService.downloadFile(req.params.token);
    if (result.error) return handleServiceError(res, result);
    const { buffer, fileName } = result.data;
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  })
);

module.exports = router;
