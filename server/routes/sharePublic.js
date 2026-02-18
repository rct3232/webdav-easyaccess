const express = require('express');
const router = express.Router();
const { HTTP_STATUS, PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { asyncHandler, forbiddenError } = require('../utils/errorHandler');
const ShareLink = require('../models/ShareLink');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { pathExists, listDirectory, getFileContents } = require('../utils/webdav');
const { getFileType, getContentType } = require('@webdav-easyaccess/shared/fileTypes');
const { authenticateToken } = require('../utils/auth');
const requireUser = require('../middleware/requireUser');
const { canGrantPermission } = require('../utils/permissionPolicy');

/**
 * Collect the share path and all paths under it (recursive). Used for permission check.
 * If rootPath is a file or list fails, returns [rootPath] only.
 * @param {string} rootPath - Normalized path (share link target)
 * @returns {Promise<string[]>}
 */
async function collectPathsUnderSharePath(rootPath) {
  let items;
  try {
    items = await listDirectory(rootPath);
  } catch (_) {
    return [rootPath];
  }
  const paths = [rootPath];
  const prefix = rootPath === '/' ? '' : rootPath;
  for (const item of items) {
    if (!item.basename || item.basename.trim() === '') continue;
    const childPath = prefix ? `${prefix}/${item.basename}` : `/${item.basename}`;
    paths.push(childPath);
    const sub = await collectPathsUnderSharePath(childPath);
    for (let i = 1; i < sub.length; i++) paths.push(sub[i]);
  }
  return paths;
}

/**
 * Collect only directory paths under the share path (recursive).
 * Used for grant so that file paths are not added to doc.permissions (they would show as tree nodes).
 * If rootPath is a file or list fails, returns [].
 * @param {string} rootPath - Normalized path (share link target)
 * @returns {Promise<string[]>}
 */
async function collectDirectoryPathsUnderSharePath(rootPath) {
  let items;
  try {
    items = await listDirectory(rootPath);
  } catch (_) {
    return [];
  }
  const paths = [rootPath];
  const prefix = rootPath === '/' ? '' : rootPath;
  for (const item of items) {
    if (!item.basename || item.basename.trim() === '') continue;
    const childPath = prefix ? `${prefix}/${item.basename}` : `/${item.basename}`;
    const sub = await collectDirectoryPathsUnderSharePath(childPath);
    if (sub.length > 0) {
      paths.push(childPath);
      for (let i = 1; i < sub.length; i++) paths.push(sub[i]);
    }
  }
  return paths;
}

/**
 * Check if current user has at least read permission on the share link path and all paths under it (authenticated).
 * GET /api/share/:token/check-my-permission
 */
router.get('/:token/check-my-permission', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkNotFound });
  }
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkExpired });
  }

  const folderPath = normalizePath(link.filePath);
  const pathsToCheck = await collectPathsUnderSharePath(folderPath);

  const readRank = PERMISSIONS.ALL.indexOf(PERMISSIONS.READ);
  let hasSufficientPermission = true;
  let firstMissingPath = null;

  for (const p of pathsToCheck) {
    const effective = await Permission.getEffectivePermission(req.user.id, p);
    const rank = effective ? PERMISSIONS.ALL.indexOf(effective) : -1;
    if (rank < readRank) {
      hasSufficientPermission = false;
      firstMissingPath = p;
      break;
    }
  }

  res.json({
    hasSufficientPermission,
    ...(hasSufficientPermission ? {} : { path: firstMissingPath ?? folderPath }),
  });
}));

/**
 * Add the share link path to current user's permissions (authenticated).
 * POST /api/share/:token/add-to-my-permissions
 */
router.post('/:token/add-to-my-permissions', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkNotFound });
  }
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkExpired });
  }

  const folderPath = normalizePath(link.filePath);
  const createdBy = link.createdBy;
  if (!createdBy) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.share.cannotAddShare });
  }

  const creatorUser = await User.findById(createdBy);
  if (!creatorUser) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.share.cannotAddShare });
  }

  const canGrant = await canGrantPermission(creatorUser, folderPath, createdBy);
  if (!canGrant) {
    throw forbiddenError(SERVER_ERROR_CODES.share.cannotAddShare);
  }

  const dirPaths = await collectDirectoryPathsUnderSharePath(folderPath);
  const pathsToGrant = dirPaths.length > 0 ? dirPaths : [folderPath];
  const readRank = PERMISSIONS.ALL.indexOf(PERMISSIONS.READ);

  for (const p of pathsToGrant) {
    const effective = await Permission.getEffectivePermission(req.user.id, p);
    const rank = effective ? PERMISSIONS.ALL.indexOf(effective) : -1;
    if (rank >= readRank) continue;
    await Permission.grant(req.user.id, p, PERMISSIONS.READ);
  }
  res.json({ messageCode: SERVER_MESSAGE_CODES.share.addedToShared });
}));

/**
 * 공유 링크 정보 조회 (인증 불필요)
 * GET /api/share/:token/info
 */
router.get('/:token/info', asyncHandler(async (req, res) => {
  const { token } = req.params;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkNotFound });
  }

  // 만료 확인
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkExpired });
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.fileNotFound });
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
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkNotFound });
  }

  // 만료 확인
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkExpired });
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.fileNotFound });
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
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.share.previewFail });
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
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkNotFound });
  }

  // 만료 확인
  if (ShareLink.isExpired(link)) {
    return res.status(HTTP_STATUS.GONE).json({ errorCode: SERVER_ERROR_CODES.share.shareLinkExpired });
  }

  // 파일 존재 여부 확인
  const exists = await pathExists(link.filePath);
  if (!exists) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.share.fileNotFound });
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
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.share.downloadFail });
  }
}));


module.exports = router;
