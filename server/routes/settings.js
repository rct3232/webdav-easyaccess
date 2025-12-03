const express = require('express');
const router = express.Router();
const Settings = require('../models/Settings');
const { isEmailEnabled } = require('../utils/email');

// Public settings endpoint (no authentication required)
router.get('/public', async (req, res) => {
  try {
    const registrationEnabled = await Settings.isRegistrationEnabled();
    const emailEnabled = isEmailEnabled();
    res.json({ 
      registration_enabled: registrationEnabled,
      email_enabled: emailEnabled
    });
  } catch (error) {
    console.error('Get public settings error:', error);
    res.status(500).json({ error: '설정을 불러오는 중 문제가 발생했습니다.' });
  }
});

module.exports = router;


