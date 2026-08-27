const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../../utils/auth');
const requireUser = require('../../../middleware/requireUser');
const { asyncHandler, validationError, forbiddenError } = require('../../../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const shareLinkService = require('../services/shareLinkService');

const ERROR_MAP = {
  pathRequired: SERVER_ERROR_CODES.share.pathRequired,
  cannotAddShare: SERVER_ERROR_CODES.share.cannotAddShare,
  fileNotFound: SERVER_ERROR_CODES.share.fileNotFound,
  invalidExpiration: SERVER_ERROR_CODES.share.invalidExpiration,
  shareLinkNotFound: SERVER_ERROR_CODES.share.shareLinkNotFound,
  accessDenied: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
};

function handleServiceError(error) {
  const errorCode = ERROR_MAP[error.message];
  if (errorCode) {
    const err = new Error(errorCode);
    err.status = error.status || 400;
    err.errorCode = errorCode;
    throw err;
  }
  throw error;
}

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    const result = await shareLinkService.createShareLink(req.body.fileNodeId, req.user.full.id, req.body.expiresInDays);
    res.json(result);
  } catch (e) { throw handleServiceError(e); }
}));

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  res.json(await shareLinkService.listUserShareLinks(req.user.full.id));
}));

router.get('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await shareLinkService.getShareLinkInfo(req.params.token, req.user.full.id));
  } catch (e) { throw handleServiceError(e); }
}));

router.put('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await shareLinkService.updateShareLink(req.params.token, req.body.expiresInDays, req.user.full.id));
  } catch (e) { throw handleServiceError(e); }
}));

router.delete('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    await shareLinkService.deleteShareLink(req.params.token, req.user.full.id);
    res.json({ messageCode: SERVER_MESSAGE_CODES.shareLinks.shareLinkDeleted });
  } catch (e) { throw handleServiceError(e); }
}));

module.exports = router;
