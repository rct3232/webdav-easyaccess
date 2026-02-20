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

router.post('/register', async (req, res) => {
  let createdUser = null;
  
  try {
    const registrationEnabled = await Settings.isRegistrationEnabled();
    if (!registrationEnabled) {
      return res.status(403).json({ errorCode: SERVER_ERROR_CODES.auth.registrationDisabled });
    }

    const { username, email, password } = req.body;

    if (!username || !email || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.auth.requiredFields });
    }

    const existingUser = await User.findByUsername(username);
    if (existingUser) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.auth.usernameTaken });
    }

    const existingEmail = await User.findByEmail(email);
    if (existingEmail) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.auth.emailTaken });
    }

    // Note: WebDAV folder existence check removed - will be handled during approval

    createdUser = await User.create(username, email, password, false);

    try {
      await sendRegistrationPendingEmail(email, username);
    } catch (emailError) {
      if (createdUser && createdUser.id) {
        await User.delete(createdUser.id);
      }
      return res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        errorCode: SERVER_ERROR_CODES.auth.emailSendFail,
      });
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
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.auth.registerFail });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.auth.loginRequiredFields });
    }

    const limit = checkLoginRateLimit(req, username);
    if (!limit.ok) {
      const retryAfterSeconds = Math.max(1, Math.ceil((limit.retryAfterMs || 0) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json({
        errorCode: SERVER_ERROR_CODES.auth.loginRateLimit,
      });
    }

    // Admin 계정이 없으면 자동 복구 (/.wea 삭제 등으로 인한 복구)
    if (username === 'admin') {
      const adminExists = await User.findByUsername('admin');
      if (!adminExists) {
        try {
          // 필요한 디렉토리 재생성
          await ensureDirs();
          // Admin 계정 재생성
          await ensureDefaultAdmin();
        } catch (recoveryError) {
          console.error('[Auth] Failed to auto-recreate admin account:', recoveryError);
          // 복구 실패해도 계속 진행 (기존 로직대로 처리)
        }
      }
    }

    const user = await User.findByUsername(username);
    if (!user) {
      recordLoginFailure(limit.key);
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.auth.invalidCredentials });
    }

    const isValid = await User.verifyPassword(user, password);
    if (!isValid) {
      recordLoginFailure(limit.key);
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.auth.invalidCredentials });
    }

    if (user.status === USER_STATUS.PENDING) {
      recordLoginFailure(limit.key);
      return res.status(403).json({
        errorCode: SERVER_ERROR_CODES.auth.pendingApproval,
        status: USER_STATUS.PENDING,
      });
    }

    if (user.status === USER_STATUS.REJECTED) {
      recordLoginFailure(limit.key);
      return res.status(403).json({
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
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.auth.loginFail });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body || {};
    const user = await validateRefreshToken(refreshToken);
    if (!user) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.auth.refreshTokenInvalid });
    }
    const token = generateToken(user);
    return res.json({ token });
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.auth.refreshFail });
  }
});

router.get('/me', authenticateToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.auth.userNotFound });
    }
    const jwtVersion = req.user.token_version;
    const dbVersion = Number.isInteger(user.token_version) ? user.token_version : 0;
    if (Number.isInteger(jwtVersion) && jwtVersion !== dbVersion) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken });
    }
    res.json(user);
  } catch (error) {
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.auth.userLoadFail });
  }
});

module.exports = router;

