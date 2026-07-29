const express = require('express');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { testConnection } = require('./webdavTest');

const router = express.Router();

router.get('/test', async (req, res) => {
  try {
    const result = await testConnection();
    res.json(result);
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      errorCode: SERVER_ERROR_CODES.api.webdavTestFailed,
      params: { reason: error.message },
    });
  }
});

router.get('/info', (req, res) => {
  try {
    const webdavUrl = process.env.WEBDAV_URL || '';
    let displayUrl = webdavUrl;
    try {
      const url = new URL(webdavUrl);
      displayUrl = url.hostname + (url.port ? `:${url.port}` : '') + url.pathname;
      if (displayUrl.endsWith('/')) {
        displayUrl = displayUrl.slice(0, -1);
      }
    } catch (e) {
      displayUrl = webdavUrl;
    }
    res.json({ url: displayUrl });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.errorHandler.internalServerError });
  }
});

module.exports = router;
