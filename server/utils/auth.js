const jwt = require('jsonwebtoken');
const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { computeSetupStatus } = require('../infrastructure/setupStatus');
const { getSharedResolver } = require('../infrastructure/configResolver');

const DEFAULT_JWT_SECRET = 'your-secret-key-change-in-production';
const JWT_SECRET = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;

// Fail fast in production if JWT_SECRET is not configured and setup is complete.
// In setup mode (first run) a prod install with a default secret boots with a
// warning instead of crashing so the wizard is reachable (D7, §5.2.1).
if (process.env.NODE_ENV === 'production' && JWT_SECRET === DEFAULT_JWT_SECRET) {
  const { setup_complete } = computeSetupStatus(process.env);
  if (setup_complete) {
    throw new Error('JWT_SECRET must be set in production'); // defense-in-depth; unreachable per §5.1
  }
  console.warn(
    '[setup-mode] NODE_ENV=production with default JWT_SECRET — booting in setup mode; the wizard must set JWT_SECRET before restart'
  );
}

// Warn in development when using the default secret.
if (JWT_SECRET === DEFAULT_JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.warn(
    '⚠️  JWT_SECRET is using the default value. Set the JWT_SECRET environment variable for security.'
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
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.accessTokenRequired });
  }

  const decoded = verifyToken(token);
  if (!decoded) {
    return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken });
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
  const shareToken =
    req.headers['x-share-token'] || req.query.shareToken || req.body?.shareToken;
  if (shareToken) {
    const ShareLink = require('../models/ShareLink');
    const link = await ShareLink.findByToken(shareToken);
    if (!link) {
      return res.status(HTTP_STATUS.NOT_FOUND).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.shareLinkNotFound });
    }
    if (ShareLink.isExpired(link)) {
      return res.status(HTTP_STATUS.GONE).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.shareLinkExpired });
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

  return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.tokenRequired });
}

module.exports = {
  generateToken,
  verifyToken,
  authenticateToken,
  authenticateTokenOrShare,
};

