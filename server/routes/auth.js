const express = require('express');
const router = express.Router();
const { HTTP_STATUS, USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES, SERVER_MESSAGE_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../models/User');
const Settings = require('../models/Settings');
const {
  generateToken,
  authenticateToken,
  generateRefreshTokenId,
  addRefreshToken,
  validateRefreshToken,
  deleteAllRefreshTokensForUser,
  REFRESH_TOKEN_EXPIRES_IN_DAYS,
} = require('../utils/auth');
const { sendRegistrationPendingEmail } = require('../utils/email');
const { ensureDefaultAdmin, ensureDirs } = require('../store/bootstrap');
const { asyncHandler, createError, validationError } = require('../utils/errorHandler');

// Simple in-memory login rate limiter (best-effort, per-process).
// Configure via env:
// - LOGIN_RATE_LIMIT_WINDOW_MS (default: 900000 = 15m)
// - LOGIN_RATE_LIMIT_MAX (default: 20)
const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '900000', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '20', 10);
const loginAttempts = new Map();

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || '';
}

function loginKey(req, username) {
  // Key by IP to avoid bypass by rotating usernames.
  return `${getClientIp(req)}`;
}

function checkLoginRateLimit(req, username) {
  const key = loginKey(req, username);
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) return { ok: true, key };
  if (entry.count >= LOGIN_RATE_LIMIT_MAX) {
    return { ok: false, key, retryAfterMs: entry.resetAt - now };
  }
  return { ok: true, key };
}

function recordLoginFailure(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS });
    return;
  }
  entry.count += 1;
  loginAttempts.set(key, entry);
}

function clearLoginFailures(key) {
  loginAttempts.delete(key);
}

router.post('/register', asyncHandler(async (req, res) => {
  let createdUser = null;

  try {
    const registrationEnabled = await Settings.isRegistrationEnabled();
    if (!registrationEnabled) {
      throw createError(SERVER_ERROR_CODES.auth.registrationDisabled, HTTP_STATUS.FORBIDDEN);
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      throw validationError(SERVER_ERROR_CODES.auth.requiredFields);
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      throw validationError(SERVER_ERROR_CODES.auth.usernameTaken);
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      throw validationError(SERVER_ERROR_CODES.auth.emailTaken);
    }

    // Note: WebDAV folder existence check removed - will be handled during approval

    createdUser = await User.create(username, email, password, false);

    try {
      await sendRegistrationPendingEmail(email, username);
    } catch (emailError) {
      if (createdUser && createdUser.id) {
        await User.delete(createdUser.id);
      }
      throw createError(SERVER_ERROR_CODES.auth.emailSendFail, HTTP_STATUS.INTERNAL_SERVER_ERROR);
    }

    res.status(HTTP_STATUS.CREATED).json({
      messageCode: SERVER_MESSAGE_CODES.auth.registerSuccess,
      status: USER_STATUS.PENDING,
      user: { id: createdUser.id, username: createdUser.username, email: createdUser.email, status: createdUser.status },
    });
  } catch (error) {
    if (createdUser && createdUser.id) {
      try {
        await User.delete(createdUser.id);
      } catch (deleteError) {
        // Ignore delete error
      }
    }
    throw error;
  }
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    throw validationError(SERVER_ERROR_CODES.auth.loginRequiredFields);
  }

  const limit = checkLoginRateLimit(req, username);
  if (!limit.ok) {
    const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 0) / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    throw createError(SERVER_ERROR_CODES.auth.loginRateLimit, HTTP_STATUS.TOO_MANY_REQUESTS);
  }

  // Auto-recover admin account if missing (e.g., after /.wea deletion)
  if (username === 'admin') {
    const adminExists = await User.findByUsername('admin');
    if (!adminExists) {
      try {
        // Recreate required directories
        await ensureDirs();
        // Recreate admin account
        await ensureDefaultAdmin();
      } catch (recoveryError) {
        console.error('[Auth] Failed to auto-recreate admin account:', recoveryError);
        // Continue even if recovery fails (handled by existing logic)
      }
    }
  }

  const user = await User.findByUsername(username);
  if (!user) {
    recordLoginFailure(limit.key);
    throw createError(SERVER_ERROR_CODES.auth.invalidCredentials, HTTP_STATUS.UNAUTHORIZED);
  }

  const isValid = await User.verifyPassword(user, password);
  if (!isValid) {
    recordLoginFailure(limit.key);
    throw createError(SERVER_ERROR_CODES.auth.invalidCredentials, HTTP_STATUS.UNAUTHORIZED);
  }

  if (user.status === USER_STATUS.PENDING) {
    recordLoginFailure(limit.key);
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      errorCode: SERVER_ERROR_CODES.auth.pendingApproval,
      status: USER_STATUS.PENDING,
    });
  }

  if (user.status === USER_STATUS.REJECTED) {
    recordLoginFailure(limit.key);
    return res.status(HTTP_STATUS.FORBIDDEN).json({
      errorCode: SERVER_ERROR_CODES.auth.rejected,
      status: USER_STATUS.REJECTED,
    });
  }

  const token = generateToken(user);
  const refreshTokenId = generateRefreshTokenId();
  const refreshExpiresAt = Date.now() + REFRESH_TOKEN_EXPIRES_IN_DAYS * 24 * 60 * 60 * 1000;
  addRefreshToken(refreshTokenId, user.id, refreshExpiresAt);
  clearLoginFailures(limit.key);

  res.json({
    messageCode: SERVER_MESSAGE_CODES.auth.loginSuccess,
    token,
    refreshToken: refreshTokenId,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      status: user.status,
    },
  });
}));

router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body || {};
  const user = await validateRefreshToken(refreshToken);
  if (!user) {
    throw createError(SERVER_ERROR_CODES.auth.refreshTokenInvalid, HTTP_STATUS.UNAUTHORIZED);
  }
  const token = generateToken(user);
  res.json({ token });
}));

router.get('/me', authenticateToken, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.id);
  if (!user) {
    throw createError(SERVER_ERROR_CODES.auth.userNotFound, HTTP_STATUS.NOT_FOUND);
  }
  const jwtVersion = req.user.token_version;
  const dbVersion = Number.isInteger(user.token_version) ? user.token_version : 0;
  if (Number.isInteger(jwtVersion) && jwtVersion !== dbVersion) {
    throw createError(SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken, HTTP_STATUS.UNAUTHORIZED);
  }
  res.json(user);
}));

module.exports = router;

