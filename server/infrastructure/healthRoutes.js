const express = require('express');
const { SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({ status: 'ok', messageCode: SERVER_MESSAGE_CODES.api.healthOk });
});

module.exports = router;
