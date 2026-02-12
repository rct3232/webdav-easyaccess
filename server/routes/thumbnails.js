const express = require('express');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { asyncHandler } = require('../utils/errorHandler');

const router = express.Router();

const { thumbnailCache, getThumbnailHash, verifyThumbnailToken } = require('../utils/thumbnail');

router.get('/:hash.:ext', asyncHandler(async (req, res) => {
  const { hash, ext } = req.params;
  const token = req.query.token;

  if (!verifyThumbnailToken(token, hash)) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Invalid or expired thumbnail token' });
  }

  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundThumbnail = thumbnail;
      break;
    }
  }

  if (!foundThumbnail || foundThumbnail.extension !== ext) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ error: 'Thumbnail not found' });
  }

  res.setHeader('Content-Type', foundThumbnail.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.send(foundThumbnail.buffer);
}));

module.exports = router;

