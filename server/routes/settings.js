const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { isEmailEnabled } = require('../utils/email');
const { asyncHandler } = require('../utils/errorHandler');

// Public settings endpoint (no authentication required)
router.get('/public', asyncHandler(async (req, res) => {
  const registrationEnabled = await Settings.isRegistrationEnabled();
  const emailEnabled = isEmailEnabled();
  res.json({ 
    registration_enabled: registrationEnabled,
    email_enabled: emailEnabled
  });
}));

module.exports = router;


