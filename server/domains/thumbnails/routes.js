const express = require('express');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { asyncHandler } = require('../../utils/errorHandler');
const thumbnailService = require('./services/thumbnailService');

const router = express.Router();

router.get(
  '/:hash.:ext',
  asyncHandler(async (req, res) => {
    const { hash, ext } = req.params;
    const token = req.query.token;

    if (!(await thumbnailService.verifyThumbnailToken(token, hash))) {
      return res
        .status(HTTP_STATUS.UNAUTHORIZED)
        .json({ errorCode: SERVER_ERROR_CODES.thumbnails.invalidOrExpiredToken });
    }

    const found = thumbnailService.findCachedThumbnailByHash(hash);

    if (!found || found.thumbnail.extension !== ext) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ errorCode: SERVER_ERROR_CODES.thumbnails.notFound });
    }

    res.setHeader('Content-Type', found.thumbnail.mimeType);
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.send(found.thumbnail.buffer);
  })
);

module.exports = router;
