'use strict';

const express = require('express');

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const { authenticateToken, verifyToken } = require('../../../utils/auth');
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

// WS4: GET /api/migration/status is auth-optional. Returns true only when the
// request carries a valid token for a DB-confirmed admin. Missing/invalid/
// expired tokens and non-admin users resolve to false so the handler degrades
// to the minimal public { active } shape instead of an auth error (the
// app-guard polls this endpoint before login).
async function isAdminRequest(req) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return false;
  const decoded = verifyToken(token);
  if (!decoded) return false;
  const user = await User.findById(decoded.id);
  return Boolean(user && user.is_admin);
}

const router = express.Router();

// Migration gate status — mounted at /api/migration/status (no auth) so the
// client app-guard can poll it before login. Auth-optional: unauthenticated
// and non-admin callers get the minimal { active } shape only; a valid admin
// token gets the full gate status (type/jobId/startedAt while active) that the
// /migration page needs to restore a running job after a refresh.
router.get(
  '/migration/status',
  asyncHandler(async (req, res) => {
    const status = getMigrationGate().getStatus();
    if (!status.active) return res.json({ active: false });
    if (await isAdminRequest(req)) return res.json(status);
    return res.json({ active: true });
  })
);

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
