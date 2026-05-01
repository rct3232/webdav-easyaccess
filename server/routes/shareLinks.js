const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../utils/auth');
const requireUser = require('../middleware/requireUser');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const ShareLink = require('../models/ShareLink');
const Permission = require('../models/Permission');
const { pathExists, listDirectory } = require('../utils/webdav');
const { getFileContents } = require('../utils/webdav');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { isMetaPath } = require('../store/metaPaths');

/**
 * Create a share link
 * POST /api/share-links
 */
router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { filePath, expiresInDays } = req.body;
  const user = req.user.full;

  if (!filePath) {
    throw validationError(SERVER_ERROR_CODES.share.pathRequired);
  }

  const normalizedPath = normalizePath(filePath);

  // Meta paths cannot be shared
  if (isMetaPath(normalizedPath)) {
    throw forbiddenError(SERVER_ERROR_CODES.share.cannotAddShare);
  }

  // Check if file exists
  const exists = await pathExists(normalizedPath);
  if (!exists) {
    throw notFoundError(SERVER_ERROR_CODES.share.fileNotFound);
  }

  // Determine if path is a directory (directory if listDirectory succeeds)
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

  // Validate expiration period
  let expiresInDaysValue = expiresInDays;
  if (expiresInDaysValue !== null && expiresInDaysValue !== undefined) {
    const days = parseInt(expiresInDaysValue, 10);
    if (isNaN(days) || days < 0) {
      throw validationError(SERVER_ERROR_CODES.share.invalidExpiration);
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
 * Get share links created by the user
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
 * Get share link info
 * GET /api/share-links/:token
 */
router.get('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;
  const user = req.user.full;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    throw notFoundError(SERVER_ERROR_CODES.share.shareLinkNotFound);
  }

  // Can only view links created by oneself
  if (link.createdBy !== user.id && !user.is_admin) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
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
 * Update share link (extend expiration, etc.)
 * PUT /api/share-links/:token
 */
router.put('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;
  const { expiresInDays } = req.body;
  const user = req.user.full;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    throw notFoundError(SERVER_ERROR_CODES.share.shareLinkNotFound);
  }

  // Can only update links created by oneself
  if (link.createdBy !== user.id && !user.is_admin) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  let updates = {};
  if (expiresInDays !== undefined) {
    if (expiresInDays === null) {
      updates.expiresAt = null;
    } else {
      const days = parseInt(expiresInDays, 10);
      if (isNaN(days) || days < 0) {
        throw validationError(SERVER_ERROR_CODES.share.invalidExpiration);
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
 * Delete share link
 * DELETE /api/share-links/:token
 */
router.delete('/:token', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { token } = req.params;
  const user = req.user.full;

  const link = await ShareLink.findByToken(token);
  if (!link) {
    throw notFoundError(SERVER_ERROR_CODES.share.shareLinkNotFound);
  }

  // Can only delete links created by oneself
  if (link.createdBy !== user.id && !user.is_admin) {
    throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
  }

  await ShareLink.delete(token);
  await Permission.revokeSharePermission(token);

  res.json({ messageCode: SERVER_MESSAGE_CODES.shareLinks.shareLinkDeleted });
}));

module.exports = router;
