const express = require('express');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getBackendHealth } = require('./backendHealth');
const { getBackend } = require('../store/storage');

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
    // Effective metadata backend (T0/.env, presence-based — see
    // store/storage.getBackend). The file-screen banner uses it to also cover
    // a failing metadata DB (postgresql).
    activeMetadataBackend: getBackend(),
    backends: {
      postgresql: backends.postgresql.status,
      s3: backends.s3.status,
      webdav: backends.webdav.status,
    },
  });
});

module.exports = router;
