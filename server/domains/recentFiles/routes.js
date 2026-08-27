const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const recentFilesService = require('./service');

const ERROR_MAP = {
  pathRequired: SERVER_ERROR_CODES.recentFiles.pathRequired,
  fileNotFound: SERVER_ERROR_CODES.files.notFound,
};

function handleServiceError(error) {
  return mapServiceError(error, ERROR_MAP);
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  res.json(await recentFilesService.getRecentFiles(req.user.full.id));
}));

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await recentFilesService.addRecentFile(req.user.full.id, req.body.fileNodeId));
  } catch (e) { throw handleServiceError(e); }
}));

router.delete('/:fileNodeId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await recentFilesService.removeRecentFile(req.user.full.id, req.params.fileNodeId));
  } catch (e) { throw handleServiceError(e); }
}));

router.delete('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await recentFilesService.clearRecentFiles(req.user.full.id);
  res.json({ messageCode: SERVER_MESSAGE_CODES.recentFiles.clearedSuccess });
}));

module.exports = router;
