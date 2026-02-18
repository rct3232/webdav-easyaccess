const express = require('express');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler } = require('../utils/errorHandler');

const router = express.Router();

const { thumbnailCache, getThumbnailHash, verifyThumbnailToken } = require('../utils/thumbnail');

router.get('/:hash.:ext', asyncHandler(async (req, res) => {
  const { hash, ext } = req.params;
  const token = req.query.token;

  if (!verifyThumbnailToken(token, hash)) {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.thumbnails.invalidOrExpiredToken });
  }

  let foundThumbnail = null;
  for (const [webdavPath, thumbnail] of thumbnailCache.entries()) {
    if (getThumbnailHash(webdavPath) === hash) {
      foundThumbnail = thumbnail;
      break;
    }
  }

  if (!foundThumbnail || foundThumbnail.extension !== ext) {
    return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.thumbnails.notFound });
  }

  res.setHeader('Content-Type', foundThumbnail.mimeType);
  res.setHeader('Cache-Control', 'public, max-age=31536000');
  res.send(foundThumbnail.buffer);
}));

module.exports = router;

