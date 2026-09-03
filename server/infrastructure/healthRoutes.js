const express = require('express');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getBackendHealth } = require('./backendHealth');

const router = express.Router();

router.get('/health', (req, res) => {
  const backends = getBackendHealth().getHealth();
  res.json({
    status: 'ok',
    messageCode: SERVER_MESSAGE_CODES.api.healthOk,
    // Effective file-storage backend (populateT1Env refreshes process.env from
    // env → DB at boot). Public so any authenticated client can decide whether
    // the ACTIVE file backend is failing without admin config access.
    activeFileStorage: process.env.WEA_FILE_STORAGE || 's3',
    backends: {
      postgresql: backends.postgresql.status,
      s3: backends.s3.status,
      webdav: backends.webdav.status,
    },
  });
});

module.exports = router;
