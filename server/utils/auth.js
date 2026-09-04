const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { getSharedResolver } = require('../infrastructure/configResolver');

// The well-known insecure default some templates still ship. When explicitly
// set it is used as-is but triggers a "change it" warning — never an error.
const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';

// JWT_SECRET is an optional, .env-owned T0 key (docs/features/
// config-source-resolution.md). Resolution is frozen at require time:
// - when the env var is set, it is used verbatim (the legacy default only warns);
// - when it is unset/empty, an ephemeral random secret is generated for THIS
//   boot. A restart yields a new secret and invalidates every outstanding
//   session (full re-login; refresh tokens are in-memory). Multi-instance
//   deployments MUST set one unified JWT_SECRET so all instances share the key.
const envSecret =
  process.env.JWT_SECRET && process.env.JWT_SECRET.trim() !== '' ? process.env.JWT_SECRET : null;
const JWT_SECRET = envSecret || crypto.randomBytes(48).toString('hex');

if (envSecret === DEFAULT_JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  JWT_SECRET is using the default value. Set the JWT_SECRET environment variable for security.'
  );
} else if (envSecret === null && process.env.NODE_ENV !== 'test') {
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  JWT_SECRET is unset — generated an ephemeral random secret for this boot. A restart will invalidate all sessions; set one unified JWT_SECRET for multi-instance deployments.'
  );
}

function generateToken(user) {
  const tokenVersion = Number.isInteger(user?.token_version) ? user.token_version : 0;
  const isAdmin = user?.is_admin ? 1 : 0;
  // JWT_EXPIRES_IN is T2 (hot): read lazily at sign time from the shared
  // resolver (env → DB → default) so changes apply immediately.
  const expiresIn = getSharedResolver().getConfigSync('JWT_EXPIRES_IN') || '30m';
  return jwt.sign(
    { id: user.id, username: user.username, token_version: tokenVersion, is_admin: isAdmin },
    JWT_SECRET,
    { expiresIn }
  );
}

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
}

async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res
      .status(HTTP_STATUS.UNAUTHORIZED)
      .json({ errorCode: SERVER_ERROR_CODES.utilsAuth.accessTokenRequired });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res
      .status(HTTP_STATUS.FORBIDDEN)
      .json({ errorCode: SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken });
  }

  // Stateless: no userStore/cache; token_version checked at refresh time
  req.user = decoded;
  req.user.full = {
    id: decoded.id,
    username: decoded.username,
    is_admin: decoded.is_admin ? 1 : 0,
  };
  return next();
}

/**
 * Authenticate via JWT or Share Token.
 * When both are present, share token wins so that logged-in users can view share links.
 * 1. X-Share-Token header or ?shareToken= query -> req.shareContext, req.principalId = "share:" + token
 * 2. JWT (Authorization: Bearer <token>) -> req.user, req.principalId = userId
 * Neither present -> 401
 *
 * @param {import('express').Request} req - Express request object
 * @param {import('express').Response} res - Express response object
 * @param {import('express').NextFunction} next - Express next middleware function
 */
async function authenticateTokenOrShare(req, res, next) {
  const shareToken = req.headers['x-share-token'] || req.query.shareToken || req.body?.shareToken;
  if (shareToken) {
    const ShareLink = require('../models/ShareLink');
    const link = await ShareLink.findByToken(shareToken);
    if (!link) {
      return res
        .status(HTTP_STATUS.NOT_FOUND)
        .json({ errorCode: SERVER_ERROR_CODES.utilsAuth.shareLinkNotFound });
    }
    if (ShareLink.isExpired(link)) {
      return res
        .status(HTTP_STATUS.GONE)
        .json({ errorCode: SERVER_ERROR_CODES.utilsAuth.shareLinkExpired });
    }
    const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
    const rootPath = normalizePath(link.filePath);
    req.shareContext = {
      link,
      token: shareToken,
      rootPath,
      isDirectory: false,
    };
    req.principalId = 'share:' + shareToken;
    return next();
  }

  const authHeader = req.headers['authorization'];
  const jwtToken = authHeader && authHeader.split(' ')[1];
  if (jwtToken) {
    const decoded = verifyToken(jwtToken);
    if (decoded) {
      req.user = decoded;
      req.user.full = {
        id: decoded.id,
        username: decoded.username,
        is_admin: decoded.is_admin ? 1 : 0,
      };
      req.principalId = decoded.id;
      return next();
    }
  }

  return res
    .status(HTTP_STATUS.UNAUTHORIZED)
    .json({ errorCode: SERVER_ERROR_CODES.utilsAuth.tokenRequired });
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  authenticateTokenOrShare,
};
