const express = require('express');
const router = express.Router();

router.use(require('./folderPermissions'));
router.use(require('./filePermissions'));
router.use(require('./queries'));

module.exports = router;
