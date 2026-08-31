const express = require('express');
const router = express.Router();
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../../models/User');
const Settings = require('../../../models/Settings');
const { authenticateToken } = require('../../../utils/auth');
const { asyncHandler, createError } = require('../../../utils/errorHandler');
const { getSharedResolver } = require('../../../infrastructure/configResolver');
const { TIER, getEntry, isT0, isTier, isSecret } = require('../../../infrastructure/configRegistry');
const { encryptSecret, hasEncryptedRows } = require('../../../utils/configEncryption');

// Middleware to check if user is admin (same pattern as settings.js)
const isAdmin = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  if (!user || !user.is_admin) {
    throw createError(SERVER_ERROR_CODES.admin.adminRequired, HTTP_STATUS.FORBIDDEN);
  }
  next();
});

// Get effective config (masked secrets, source/tier/secret per registry key)
// plus a key-lost warning: encrypted DB secret rows exist but the master key
// (encrypt_secret_key) is missing, so those secrets are undecryptable.
router.get('/config', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const resolver = getSharedResolver();
  const [config, all] = await Promise.all([
    resolver.getEffectiveConfig(),
    Settings.getAll(),
  ]);
  res.json({
    config,
    key_lost_warning: Boolean(hasEncryptedRows(all) && !process.env.encrypt_secret_key),
  });
}));

// Update allowlisted config keys (write to DB, encrypt secrets, invalidate T2 cache)
router.put('/config', authenticateToken, isAdmin, asyncHandler(async (req, res) => {
  const { values } = req.body;

  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw createError(SERVER_ERROR_CODES.admin.configInvalidPayload, HTTP_STATUS.BAD_REQUEST);
  }

  // Snapshot the current effective source per key so env-sourced writes can be
  // rejected (F4). getEffectiveConfig() primes the shared cache as a side
  // effect, which keeps the resolver consistent for the writes below.
  const current = await getSharedResolver().getEffectiveConfig();

  const applied = [];
  const restartRequired = [];
  const changedKeys = [];

  for (const [key, value] of Object.entries(values)) {
    if (!getEntry(key)) {
      throw createError(SERVER_ERROR_CODES.admin.configUnknownKey, HTTP_STATUS.BAD_REQUEST, { key });
    }
    if (isT0(key)) {
      throw createError(SERVER_ERROR_CODES.admin.configT0Protected, HTTP_STATUS.BAD_REQUEST, { key });
    }
    if (current[key]?.source === 'env') {
      throw createError(SERVER_ERROR_CODES.admin.configEnvSourcedProtected, HTTP_STATUS.BAD_REQUEST, { key });
    }

    if (isSecret(key)) {
      // Masked/blank secret keeps its existing ciphertext (only-re-encrypt-on-new-value).
      if (value === undefined || value === null || value === '' || value === '****') {
        continue;
      }
      const masterKey = process.env.encrypt_secret_key;
      if (!masterKey) {
        throw createError(SERVER_ERROR_CODES.admin.configEncryptKeyMissing, HTTP_STATUS.INTERNAL_SERVER_ERROR);
      }
      const payload = encryptSecret(String(value), masterKey);
      await Settings.set(key, JSON.stringify(payload));
    } else {
      await Settings.set(key, String(value));
    }

    changedKeys.push(key);
    if (isTier(key, TIER.T2)) {
      applied.push(key);
    } else {
      restartRequired.push(key);
    }
  }

  if (changedKeys.length > 0) {
    getSharedResolver().invalidateCache(changedKeys);
  }

  res.json({
    applied,
    restartRequired,
    messageCode: SERVER_MESSAGE_CODES.admin.configSaved,
  });
}));

module.exports = router;
