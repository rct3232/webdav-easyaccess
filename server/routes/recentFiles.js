const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const requireUser = require('../middleware/requireUser');
const { asyncHandler, validationError } = require('../utils/errorHandler');
const recentFilesStore = require('../store/recentFilesStore');
const { normalizePath } = require('../utils/pathUtils');

/**
 * 사용자의 최근 파일 목록 조회
 * GET /api/recent-files
 */
router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const user = req.user.full;
  const files = await recentFilesStore.getUserRecentFiles(user.id);
  
  res.json(files);
}));

/**
 * 최근 파일 추가
 * POST /api/recent-files
 */
router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { path, name, type, basename } = req.body;
  const user = req.user.full;

  if (!path) {
    throw validationError('File path is required');
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
 * 특정 파일 제거
 * DELETE /api/recent-files/:filePath
 */
router.delete('/:filePath(*)', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { filePath } = req.params;
  const user = req.user.full;

  if (!filePath) {
    throw validationError('File path is required');
  }

  // URL 디코딩
  const decodedPath = decodeURIComponent(filePath);
  const normalizedPath = normalizePath(decodedPath);

  const updatedFiles = await recentFilesStore.removeRecentFile(user.id, normalizedPath);
  
  res.json(updatedFiles);
}));

/**
 * 전체 최근 파일 목록 초기화
 * DELETE /api/recent-files
 */
router.delete('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const user = req.user.full;
  
  await recentFilesStore.clearRecentFiles(user.id);
  
  res.json({ message: 'Recent files cleared successfully' });
}));

module.exports = router;
