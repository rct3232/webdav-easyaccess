const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { asyncHandler } = require('../utils/errorHandler');
const ShareLink = require('../models/ShareLink');
const { pathExists } = require('../utils/webdav');
const { getFileContents } = require('../utils/webdav');
const { getFileType, getContentType } = require('@webdav-easyaccess/shared/fileTypes');

/**
 * 공유 링크 정보 조회 (인증 불필요)
 * GET /api/share/:token/info
 */
router.get('/:token/info', asyncHandler(async (req, res) => {
  const { token } = req.params;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Share link not found' });
  }

  // 만료 확인
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ error: 'Share link has expired' });
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'File not found' });
  }

  const fileName = link.filePath.split('/').pop();
  const fileType = getFileType(fileName);

  let isDirectory = false;
  try {
    const Permission = require('../models/Permission');
    const shareDoc = await Permission.getSharePermissionDoc(token);
    if (shareDoc) {
      isDirectory = Boolean(shareDoc.isDirectory);
    }
  } catch (_) {
    // Default to file for legacy links without permission doc
  }

  res.json({
    token: link.token,
    filePath: link.filePath,
    fileName: fileName,
    fileType: fileType,
    isDirectory,
    createdAt: link.createdAt,
    expiresAt: link.expiresAt,
    downloadCount: link.downloadCount,
    isExpired: ShareLink.isExpired(link),
  });
}));

/**
 * 공개 미리보기 엔드포인트 (인증 불필요)
 * GET /api/share/:token/preview
 */
router.get('/:token/preview', asyncHandler(async (req, res) => {
  const { token } = req.params;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Share link not found' });
  }

  // 만료 확인
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ error: 'Share link has expired' });
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'File not found' });
  }

  // 파일 미리보기 (inline)
  try {
    const buffer = await getFileContents(link.filePath);
    const fileName = link.filePath.split('/').pop();
    const fileType = getFileType(fileName);
    const contentType = getContentType(fileName);

    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', contentType);
    res.send(buffer);
  } catch (error) {
    console.error('Failed to preview file:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to preview file' });
  }
}));

/**
 * 공개 다운로드 엔드포인트 (인증 불필요)
 * GET /api/share/:token
 */
router.get('/:token', asyncHandler(async (req, res) => {
  const { token } = req.params;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Share link not found' });
  }

  // 만료 확인
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ error: 'Share link has expired' });
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'File not found' });
  }

  // 파일 다운로드
  try {
    const buffer = await getFileContents(link.filePath);
    const fileName = link.filePath.split('/').pop();

    // 다운로드 횟수 증가
    await ShareLink.incrementDownloadCount(token);

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.send(buffer);
  } catch (error) {
    console.error('Failed to download file:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to download file' });
  }
}));


module.exports = router;
