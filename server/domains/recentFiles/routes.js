const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, mapServiceError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const recentFilesService = require('./service');

const ERROR_MAP = {
  pathRequired: SERVER_ERROR_CODES.recentFiles.pathRequired,
  movesRequired: SERVER_ERROR_CODES.recentFiles.movesRequired,
  pathsMustBeArrays: SERVER_ERROR_CODES.recentFiles.pathsMustBeArrays,
};

function handleServiceError(error) {
  return mapServiceError(error, ERROR_MAP);
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  res.json(await recentFilesService.getRecentFiles(req.user.full.id));
}));

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await recentFilesService.addRecentFile(req.user.full.id, req.body));
  } catch (e) { throw handleServiceError(e); }
}));

router.delete('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await recentFilesService.clearRecentFiles(req.user.full.id);
  res.json({ messageCode: SERVER_MESSAGE_CODES.recentFiles.clearedSuccess });
}));

router.delete('/:filePath(*)', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await recentFilesService.removeRecentFile(req.user.full.id, req.params.filePath));
  } catch (e) { throw handleServiceError(e); }
}));

router.post('/apply-moves', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await recentFilesService.applyBulkMove(req.user.full.id, req.body.moves));
  } catch (e) { throw handleServiceError(e); }
}));

router.post('/remove-paths', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    res.json(await recentFilesService.removePaths(req.user.full.id, req.body.filePaths, req.body.folderPaths));
  } catch (e) { throw handleServiceError(e); }
}));

module.exports = router;
