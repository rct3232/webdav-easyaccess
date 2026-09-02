const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const {
  SERVER_ERROR_CODES,
  SERVER_MESSAGE_CODES,
} = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const Settings = require('../../../models/Settings');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const { isEmailEnabled } = require('../../../utils/email');
const { computeSetupStatus } = require('../../../infrastructure/setupStatus');

// Public settings endpoint (no authentication required)
router.get(
  '/public',
  asyncHandler(async (req, res) => {
    const registrationEnabled = await Settings.isRegistrationEnabled();
    const emailEnabled = isEmailEnabled();
    res.json({
      registration_enabled: registrationEnabled,
      email_enabled: emailEnabled,
      setup_complete: computeSetupStatus(process.env).setup_complete,
    });
  })
);

// Middleware to check if user is admin
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get settings
router.get(
  '/settings',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const settings = await Settings.getAll();
    res.json(settings);
  })
);

// Update settings
router.put(
  '/settings',
  authenticateToken,
  isAdmin,
  asyncHandler(async (req, res) => {
    const { registration_enabled } = req.body;

    if (registration_enabled !== undefined) {
      await Settings.set('registration_enabled', String(registration_enabled));
    }

    const settings = await Settings.getAll();
    res.json({
      messageCode: SERVER_MESSAGE_CODES.admin.settingsSaved,
      settings,
    });
  })
);

module.exports = router;
