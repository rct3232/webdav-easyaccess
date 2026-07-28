const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../../utils/auth');
const requireUser = require('../../middleware/requireUser');
const { asyncHandler, validationError } = require('../../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const recentFilesService = require('./service');

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const files = await recentFilesService.getRecentFiles(req.user.full.id);
  res.json(files);
}));

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    const updatedFiles = await recentFilesService.addRecentFile(req.user.full.id, req.body);
    res.json(updatedFiles);
  } catch (error) {
    if (error.message === 'pathRequired') {
      throw validationError(SERVER_ERROR_CODES.recentFiles.pathRequired);
    }
    throw error;
  }
}));

router.delete('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await recentFilesService.clearRecentFiles(req.user.full.id);
  res.json({ messageCode: SERVER_MESSAGE_CODES.recentFiles.clearedSuccess });
}));

router.delete('/:filePath(*)', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    const updatedFiles = await recentFilesService.removeRecentFile(req.user.full.id, req.params.filePath);
    res.json(updatedFiles);
  } catch (error) {
    if (error.message === 'pathRequired') {
      throw validationError(SERVER_ERROR_CODES.recentFiles.pathRequired);
    }
    throw error;
  }
}));

router.post('/apply-moves', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    const updatedFiles = await recentFilesService.applyBulkMove(req.user.full.id, req.body.moves);
    res.json(updatedFiles);
  } catch (error) {
    if (error.message === 'movesRequired') {
      throw validationError(SERVER_ERROR_CODES.recentFiles.movesRequired);
    }
    throw error;
  }
}));

router.post('/remove-paths', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  try {
    const updatedFiles = await recentFilesService.removePaths(req.user.full.id, req.body.filePaths, req.body.folderPaths);
    res.json(updatedFiles);
  } catch (error) {
    if (error.message === 'pathsMustBeArrays') {
      throw validationError(SERVER_ERROR_CODES.recentFiles.pathsMustBeArrays);
    }
    throw error;
  }
}));

module.exports = router;
