const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const requireUser = require('../middleware/requireUser');
const { asyncHandler, validationError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const recentFilesStore = require('../store/recentFilesStore');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');

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
 * 특정 파일 제거
 * DELETE /api/recent-files/:filePath
 */
router.delete('/:filePath(*)', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { filePath } = req.params;
  const user = req.user.full;

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.recentFiles.pathRequired);
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
  
  res.json({ messageCode: SERVER_MESSAGE_CODES.recentFiles.clearedSuccess });
}));

/**
 * 일괄 이동 적용 (벌크 이동 시 N번 DELETE/POST 대신 1회 호출)
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
 * 일괄 경로 제거 (벌크 삭제 시 N번 DELETE 대신 1회 호출)
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
