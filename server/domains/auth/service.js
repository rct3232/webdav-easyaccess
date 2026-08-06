const { USER_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../../models/User');
const Settings = require('../../models/Settings');
const { generateToken } = require('../../utils/auth');
const { sendRegistrationPendingEmail } = require('../../utils/email');
const { ensureDefaultAdmin } = require('../../store/bootstrap');
const tokenStore = require('./tokenStore');
const { createCacheAdapter } = require('../../infrastructure/adapters/cache');

const LOGIN_RATE_LIMIT_WINDOW_MS = parseInt(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || '900000', 10);
const LOGIN_RATE_LIMIT_MAX = parseInt(process.env.LOGIN_RATE_LIMIT_MAX || '20', 10);

let _rateLimitCache = null;

function _getRateLimitCache() {
  if (!_rateLimitCache) {
    _rateLimitCache = createCacheAdapter();
  }
  return _rateLimitCache;
}

function setRateLimitCacheAdapter(adapter) {
  _rateLimitCache = adapter;
}

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim();
  }
  return req.ip || '';
}

function checkLoginRateLimit(req) {
  const key = getClientIp(req);
  const cache = _getRateLimitCache();
  const entry = cache.get(`ratelimit:${key}`);
  const now = Date.now();
  if (!entry || now > entry.resetAt) return { ok: true, key };
  if (entry.count >= LOGIN_RATE_LIMIT_MAX) {
    return { ok: false, key, retryAfterMs: entry.resetAt - now };
  }
  return { ok: true, key };
}

function recordLoginFailure(key) {
  const cache = _getRateLimitCache();
  const now = Date.now();
  const entry = cache.get(`ratelimit:${key}`);
  if (!entry || now > entry.resetAt) {
    cache.set(`ratelimit:${key}`, { count: 1, resetAt: now + LOGIN_RATE_LIMIT_WINDOW_MS }, LOGIN_RATE_LIMIT_WINDOW_MS);
    return;
  }
  cache.set(`ratelimit:${key}`, { count: entry.count + 1, resetAt: entry.resetAt }, entry.resetAt - now);
}

function clearLoginFailures(key) {
  _getRateLimitCache().delete(`ratelimit:${key}`);
}

async function registerUser({ username, email, password }) {
  const registrationEnabled = await Settings.isRegistrationEnabled();
  if (!registrationEnabled) {
    const err = new Error('registrationDisabled');
    err.errorCode = SERVER_ERROR_CODES.auth.registrationDisabled;
    err.status = 403;
    throw err;
  }

  if (!username || !email || !password) {
    const err = new Error('requiredFields');
    err.errorCode = SERVER_ERROR_CODES.auth.requiredFields;
    err.status = 400;
    throw err;
  }

  const existingUser = await User.findByUsername(username);
  if (existingUser) {
    const err = new Error('usernameTaken');
    err.errorCode = SERVER_ERROR_CODES.auth.usernameTaken;
    err.status = 400;
    throw err;
  }

  const existingEmail = await User.findByEmail(email);
  if (existingEmail) {
    const err = new Error('emailTaken');
    err.errorCode = SERVER_ERROR_CODES.auth.emailTaken;
    err.status = 400;
    throw err;
  }

  let createdUser = null;
  try {
    createdUser = await User.create(username, email, password, false);

    try {
      await sendRegistrationPendingEmail(email, username);
    } catch (emailError) {
      if (createdUser && createdUser.id) {
        await User.delete(createdUser.id);
      }
      const err = new Error('emailSendFail');
      err.errorCode = SERVER_ERROR_CODES.auth.emailSendFail;
      err.status = 500;
      throw err;
    }

    return {
      status: USER_STATUS.PENDING,
      user: { id: createdUser.id, username: createdUser.username, email: createdUser.email, status: createdUser.status },
    };
  } catch (error) {
    if (error.errorCode) throw error;
    if (createdUser && createdUser.id) {
      try { await User.delete(createdUser.id); } catch {}
    }
    throw error;
  }
}

async function loginUser({ username, password }, req) {
  if (!username || !password) {
    const err = new Error('loginRequiredFields');
    err.errorCode = SERVER_ERROR_CODES.auth.loginRequiredFields;
    err.status = 400;
    throw err;
  }

  const limit = checkLoginRateLimit(req);
  if (!limit.ok) {
    const err = new Error('loginRateLimit');
    err.errorCode = SERVER_ERROR_CODES.auth.loginRateLimit;
    err.status = 429;
    err.retryAfterMs = limit.retryAfterMs;
    throw err;
  }

  if (username === 'admin') {
    const adminExists = await User.findByUsername('admin');
    if (!adminExists) {
      try {
        await ensureDefaultAdmin();
      } catch (recoveryError) {
        console.error('[Auth] Failed to auto-recreate admin account:', recoveryError);
      }
    }
  }

  const user = await User.findByUsername(username);
  if (!user) {
    recordLoginFailure(limit.key);
    const err = new Error('invalidCredentials');
    err.errorCode = SERVER_ERROR_CODES.auth.invalidCredentials;
    err.status = 401;
    throw err;
  }

  const isValid = await User.verifyPassword(user, password);
  if (!isValid) {
    recordLoginFailure(limit.key);
    const err = new Error('invalidCredentials');
    err.errorCode = SERVER_ERROR_CODES.auth.invalidCredentials;
    err.status = 401;
    throw err;
  }

  if (user.status === USER_STATUS.PENDING) {
    recordLoginFailure(limit.key);
    const err = new Error('pendingApproval');
    err.errorCode = SERVER_ERROR_CODES.auth.pendingApproval;
    err.status = 403;
    err.body = { status: USER_STATUS.PENDING };
    throw err;
  }

  if (user.status === USER_STATUS.REJECTED) {
    recordLoginFailure(limit.key);
    const err = new Error('rejected');
    err.errorCode = SERVER_ERROR_CODES.auth.rejected;
    err.status = 403;
    err.body = { status: USER_STATUS.REJECTED };
    throw err;
  }

  const token = generateToken(user);
  const refreshTokenId = tokenStore.generateRefreshTokenId();
  tokenStore.addRefreshToken(refreshTokenId, user.id);
  clearLoginFailures(limit.key);

  return {
    token,
    refreshToken: refreshTokenId,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      is_admin: user.is_admin,
      status: user.status,
    },
  };
}

async function refreshAccessToken(refreshToken) {
  const user = await tokenStore.validateRefreshToken(refreshToken);
  if (!user) {
    const err = new Error('refreshTokenInvalid');
    err.errorCode = SERVER_ERROR_CODES.auth.refreshTokenInvalid;
    err.status = 401;
    throw err;
  }
  return { token: generateToken(user) };
}

async function getAuthenticatedUser(userId, tokenVersion) {
  const user = await User.findById(userId);
  if (!user) {
    const err = new Error('userNotFound');
    err.errorCode = SERVER_ERROR_CODES.auth.userNotFound;
    err.status = 404;
    throw err;
  }
  const dbVersion = Number.isInteger(user.token_version) ? user.token_version : 0;
  if (Number.isInteger(tokenVersion) && tokenVersion !== dbVersion) {
    const err = new Error('invalidOrExpiredToken');
    err.errorCode = SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken;
    err.status = 401;
    throw err;
  }
  return user;
}

function revokeAllUserTokens(userId) {
  tokenStore.deleteAllRefreshTokensForUser(userId);
}

module.exports = {
  setRateLimitCacheAdapter,
  registerUser,
  loginUser,
  refreshAccessToken,
  getAuthenticatedUser,
  revokeAllUserTokens,
  checkLoginRateLimit,
  recordLoginFailure,
  clearLoginFailures,
};
