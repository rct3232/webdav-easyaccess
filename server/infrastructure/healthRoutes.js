const express = require('express');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getBackendHealth } = require('./backendHealth');

const router = express.Router();

router.get('/health', (req, res) => {
  const backends = getBackendHealth().getHealth();
  res.json({
    status: 'ok',
    messageCode: SERVER_MESSAGE_CODES.api.healthOk,
    backends: {
      postgresql: backends.postgresql.status,
      s3: backends.s3.status,
      webdav: backends.webdav.status,
    },
  });
});

module.exports = router;
