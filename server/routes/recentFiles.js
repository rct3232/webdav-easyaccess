const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const requireUser = require('../middleware/requireUser');
const { asyncHandler, validationError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const recentFilesStore = require('../store/recentFilesStore');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

/**
 * Get user's recent files list
 * GET /api/recent-files
 */
router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const user = req.user.full;
  const files = await recentFilesStore.getUserRecentFiles(user.id);
  
  res.json(files);
}));

/**
 * Add a recent file
 * POST /api/recent-files
 */
router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { path, name, type, basename } = req.body;
  const user = req.user.full;

  if (!path) {
    throw validationError(SERVER_ERROR_CODES.recentFiles.pathRequired);
  }

  const normalizedPath = normalizePath(path);
  
  const fileData = {
    path: normalizedPath,
    name: name || basename || normalizedPath.split('/').pop(),
    type: type || 'file',
  };

  const updatedFiles = await recentFilesStore.addRecentFile(user.id, fileData);
  
  res.json(updatedFiles);
}));

/**
 * Clear all recent files
 * DELETE /api/recent-files
 * Must be defined before /:filePath(*) so it matches DELETE /api/recent-files (no path segment).
 */
router.delete('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const user = req.user.full;
  
  await recentFilesStore.clearRecentFiles(user.id);
  
  res.json({ messageCode: SERVER_MESSAGE_CODES.recentFiles.clearedSuccess });
}));

/**
 * Remove a specific file from recent files
 * DELETE /api/recent-files/:filePath
 */
router.delete('/:filePath(*)', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { filePath } = req.params;
  const user = req.user.full;

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.recentFiles.pathRequired);
  }

  // Decode URL
  const decodedPath = decodeURIComponent(filePath);
  const normalizedPath = normalizePath(decodedPath);

  const updatedFiles = await recentFilesStore.removeRecentFile(user.id, normalizedPath);
  
  res.json(updatedFiles);
}));

/**
 * Apply bulk moves (single call instead of N DELETE/POST for bulk moves)
 * POST /api/recent-files/apply-moves
 * Body: { moves: Array<{ oldPath, newPath, file?: { type, name, basename } }> }
 */
router.post('/apply-moves', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { moves } = req.body;
  const user = req.user.full;

  if (!Array.isArray(moves)) {
    throw validationError(SERVER_ERROR_CODES.recentFiles.movesRequired);
  }

  const updatedFiles = await recentFilesStore.applyBulkMove(user.id, moves);
  res.json(updatedFiles);
}));

/**
 * Remove paths in bulk (single call instead of N DELETE for bulk deletion)
 * POST /api/recent-files/remove-paths
 * Body: { filePaths: string[], folderPaths: string[] }
 */
router.post('/remove-paths', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { filePaths = [], folderPaths = [] } = req.body;
  const user = req.user.full;

  if (!Array.isArray(filePaths) || !Array.isArray(folderPaths)) {
    throw validationError(SERVER_ERROR_CODES.recentFiles.pathsMustBeArrays);
  }

  const updatedFiles = await recentFilesStore.removePaths(user.id, filePaths, folderPaths);
  res.json(updatedFiles);
}));

module.exports = router;
