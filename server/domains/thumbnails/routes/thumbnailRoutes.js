const express = require('express');
const router = express.Router();
const { authenticateToken, authenticateTokenOrShare } = require('../../../utils/auth');
const { getThumbnailHash, ensureThumbnailsBatch } = require('../services/thumbnailService');
const { getThumbnailCacheAdapter } = require('../cache');
const thumbnailCache = getThumbnailCacheAdapter();
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const requireUser = require('../../../middleware/requireUser');
const { requireAuth } = require('../../../middleware/requireUser');
const { checkMetaPathAccess } = require('../../../middleware/metaPathGuard');
const { asyncHandler, validationError, forbiddenError, notFoundError } = require('../../../utils/errorHandler');
const { checkFilePermission } = require('../../permissions/services/aclService');

/* ------------------------------------------------------------------ */
/* GET /thumbnail/:hash                                               */
/* ------------------------------------------------------------------ */
router.get('/thumbnail/:hash', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { hash } = req.params;

  let foundPath = null;
  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundPath = webdavPath;
      foundThumbnail = thumbnail;
      break;
    }
  }

  if (!foundThumbnail) {
    throw notFoundError(SERVER_ERROR_CODES.files.invalidPath);
  }

  const canRead = await checkFilePermission(req.user.id, foundPath, PERMISSIONS.READ);
  if (!canRead) {
    throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
  }

  res.setHeader('Content-Type', foundThumbnail.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.send(foundThumbnail.buffer);
}));

/* ------------------------------------------------------------------ */
/* POST /thumbnails/batch                                             */
/* ------------------------------------------------------------------ */
router.post('/thumbnails/batch', authenticateTokenOrShare, requireAuth, checkMetaPathAccess, asyncHandler(async (req, res) => {
  const { paths } = req.body;

  if (!paths || !Array.isArray(paths) || paths.length === 0) {
    throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
  }

  const principalId = req.principalId;
  const allowedPaths = [];
  for (const p of paths) {
    if (typeof p !== 'string') continue;
    const canRead = await checkFilePermission(principalId, p, PERMISSIONS.READ);
    if (canRead) allowedPaths.push(p);
  }

  const results = await ensureThumbnailsBatch(allowedPaths);

  res.json({ thumbnails: results });
}));

module.exports = router;
