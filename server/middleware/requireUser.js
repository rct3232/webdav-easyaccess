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
const User = require('../models/User');
const { notFoundError } = require('../utils/errorHandler');

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
      return res.status(HTTP_STATUS.UNAUTHORIZED).json({ error: 'Authentication required' });
    }

    // Skip userStore if authenticateToken already set req.user.full (e.g. from cache)
    if (req.user.full && typeof req.user.full === 'object') {
      return next();
    }

    const user = await User.findById(req.user.id);
    if (!user) {
      throw notFoundError('User not found');
    }

    req.user.full = user;
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = requireUser;
