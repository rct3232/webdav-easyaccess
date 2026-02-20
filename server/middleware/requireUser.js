/**
 * Middleware to require authenticated user and load full user object
 * Adds req.user.full with complete user information
 * 
 * Usage: router.get('/path', authenticateToken, requireUser, handler)
 * 
 * After this middleware, you can access the full user object via req.user.full
 * instead of calling User.findById(req.user.id) in each route handler.
 */

const { HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const User = require('../models/User');
const { notFoundError } = require('../utils/errorHandler');

/**
 * Require authentication (JWT or Share). Passes when req.principalId is set.
 * For JWT users: loads req.user.full if not already set.
 * Use after authenticateTokenOrShare.
 */
async function requireAuth(req, res, next) {
  try {
    if (req.principalId) {
      if (req.user && !req.user.full) {
        const user = await User.findById(req.user.id);
        if (user) req.user.full = user;
      }
      return next();
    }
    if (req.user && req.user.id) {
      if (!req.user.full) {
        const user = await User.findById(req.user.id);
        if (!user) throw notFoundError(SERVER_ERROR_CODES.auth.userNotFound);
        req.user.full = user;
      }
      req.principalId = req.user.id;
      return next();
    }
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.requireUser.authenticationRequired });
  } catch (error) {
    next(error);
  }
}

/**
 * Middleware to load full user object
 * Requires authenticateToken to be called first
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 * @example
 * router.get('/profile', authenticateToken, requireUser, asyncHandler(async (req, res) => {
 *   const user = req.user.full; // Full user object available here
 *   res.json(user);
 * }));
 */
async function requireUser(req, res, next) {
  try {
    if (!req.user || !req.user.id) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.requireUser.authenticationRequired });
    }

    // Skip userStore if authenticateToken already set req.user.full (e.g. from cache)
    if (req.user.full && typeof req.user.full === 'object') {
      return next();
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      throw notFoundError(SERVER_ERROR_CODES.auth.userNotFound);
    }

    // Reject token if password (or token_version) was changed after this token was issued
    const jwtVersion = req.user.token_version;
    const dbVersion = Number.isInteger(user.token_version) ? user.token_version : 0;
    if (Number.isInteger(jwtVersion) && jwtVersion !== dbVersion) {
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.utilsAuth.invalidOrExpiredToken });
    }

    req.user.full = user;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireUser;
module.exports.requireAuth = requireAuth;
