'use strict';

const express = require('express');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const { getMigrationGate } = require('../../../infrastructure/migrationGate');
const { checkMetadataPresence } = require('../../../infrastructure/metadataPresence');

// Middleware to check if user is admin (same pattern as config.js/settings.js)
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

const router = express.Router();

// Public migration gate status — mounted at /api/migration/status (no auth) so
// the client app-guard and the /migration page can poll it before login.
router.get('/migration/status', (req, res) => {
  res.json(getMigrationGate().getStatus());
});

// ".env setup needed" presence (PLAN D13) — admin-only; the router itself
// applies authenticateToken + isAdmin, mirroring the admin config routes.
router.get(
  '/admin/migration/presence',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const presence = await checkMetadataPresence();
    res.json(presence);
  })
);

module.exports = router;
