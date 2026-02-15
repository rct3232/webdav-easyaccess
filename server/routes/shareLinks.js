const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const requireUser = require('../middleware/requireUser');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../utils/errorHandler');
const ShareLink = require('../models/ShareLink');
const Permission = require('../models/Permission');
const { pathExists, listDirectory } = require('../utils/webdav');
const { getFileContents } = require('../utils/webdav');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { isMetaPath } = require('../store/metaPaths');

/**
 * 공유 링크 생성
 * POST /api/share-links
 */
router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { filePath, expiresInDays } = req.body;
  const user = req.user.full;

  if (!filePath) {
    throw validationError('File path is required');
  }

  const normalizedPath = normalizePath(filePath);

  // 메타 경로는 공유 불가
  if (isMetaPath(normalizedPath)) {
    throw forbiddenError('Cannot share metadata paths');
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(normalizedPath);
  if (!exists) {
    throw notFoundError('File or folder not found');
  }

  // 디렉터리 여부 판별 (listDirectory 성공 시 디렉터리)
  let isDirectory = false;
  try {
    await listDirectory(normalizedPath);
    isDirectory = true;
  } catch (_) {
    try {
      const alt = normalizedPath.endsWith('/') ? normalizedPath.slice(0, -1) : normalizedPath + '/';
      await listDirectory(alt);
      isDirectory = true;
    } catch (_2) {
      isDirectory = false;
    }
  }

  // 유효기간 검증
  let expiresInDaysValue = expiresInDays;
  if (expiresInDaysValue !== null && expiresInDaysValue !== undefined) {
    const days = parseInt(expiresInDaysValue, 10);
    if (isNaN(days) || days < 0) {
      throw validationError('Invalid expiration days. Must be a non-negative number or null for unlimited.');
    }
    expiresInDaysValue = days;
  }

  const link = await ShareLink.create(normalizedPath, user.id, expiresInDaysValue);
  await Permission.grantSharePermission(link.token, normalizedPath, isDirectory);

  res.json({
    token: link.token,
    filePath: link.filePath,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
  });
}));

/**
 * 사용자가 생성한 공유 링크 목록 조회
 * GET /api/share-links
 */
router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const user = req.user.full;
  const links = await ShareLink.findByUserId(user.id);

  res.json(links.map(link => ({
    token: link.token,
    filePath: link.filePath,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    isExpired: ShareLink.isExpired(link),
  })));
}));

/**
 * 공유 링크 정보 조회
 * GET /api/share-links/:token
 */
router.get('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;
  const user = req.user.full;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    throw notFoundError('Share link not found');
  }

  // 자신이 생성한 링크만 조회 가능
  if (link.createdBy !== user.id && !user.is_admin) {
    throw forbiddenError('Access denied');
  }

  res.json({
    token: link.token,
    filePath: link.filePath,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    isExpired: ShareLink.isExpired(link),
  });
}));

/**
 * 공유 링크 수정 (유효기간 연장 등)
 * PUT /api/share-links/:token
 */
router.put('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { expiresInDays } = req.body;
  const user = req.user.full;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    throw notFoundError('Share link not found');
  }

  // 자신이 생성한 링크만 수정 가능
  if (link.createdBy !== user.id && !user.is_admin) {
    throw forbiddenError('Access denied');
  }

  let updates = {};
  if (expiresInDays !== undefined) {
    if (expiresInDays === null) {
      updates.expiresAt = null;
    } else {
      const days = parseInt(expiresInDays, 10);
      if (isNaN(days) || days < 0) {
        throw validationError('Invalid expiration days. Must be a non-negative number or null for unlimited.');
      }
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + days);
      updates.expiresAt = expiryDate.toISOString();
    }
  }

  const updatedLink = await ShareLink.update(token, updates);

  res.json({
    token: updatedLink.token,
    filePath: updatedLink.filePath,
    createdAt: updatedLink.createdAt,
    expiresAt: updatedLink.expiresAt,
    downloadCount: updatedLink.downloadCount,
    isExpired: ShareLink.isExpired(updatedLink),
  });
}));

/**
 * 공유 링크 삭제
 * DELETE /api/share-links/:token
 */
router.delete('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;
  const user = req.user.full;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    throw notFoundError('Share link not found');
  }

  // 자신이 생성한 링크만 삭제 가능
  if (link.createdBy !== user.id && !user.is_admin) {
    throw forbiddenError('Access denied');
  }

  await ShareLink.delete(token);
  await Permission.revokeSharePermission(token);

  res.json({ message: 'Share link deleted successfully' });
}));

module.exports = router;
