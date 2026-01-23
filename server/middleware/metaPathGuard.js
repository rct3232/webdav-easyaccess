/**
 * Middleware to guard against meta path access
 * Only admin users can access meta paths (/.wea)
 * 
 * Usage: router.get('/path', authenticateToken, requireUser, checkMetaPathAccess, handler)
 */

const { isMetaPath } = require('../store/metaPaths');
const { forbiddenError } = require('../utils/errorHandler');

/**
 * Middleware to check if path is a meta path and block non-admin access
 * Requires requireUser to be called first (to have req.user.full)
 * 
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function checkMetaPathAccess(req, res, next) {
  // Extract path from query, body, or params
  const path = req.query.path || req.body.path || req.params.path || req.body.sourcePath || req.body.destinationPath;
  
  if (path && isMetaPath(path)) {
    const user = req.user?.full || req.user;
    if (!user || !user.is_admin) {
      throw forbiddenError('Access denied');
    }
  }
  
  // Check multiple paths in body (for operations like move/copy)
  if (req.body.sourcePath && isMetaPath(req.body.sourcePath)) {
    const user = req.user?.full || req.user;
    if (!user || !user.is_admin) {
      throw forbiddenError('Access denied');
    }
  }
  
  if (req.body.destinationPath && isMetaPath(req.body.destinationPath)) {
    const user = req.user?.full || req.user;
    if (!user || !user.is_admin) {
      throw forbiddenError('Access denied');
    }
  }
  
  next();
}

/**
 * Middleware factory to check specific path parameter
 * @param {Function} pathExtractor - Function to extract path from request
 * @returns {Function} Express middleware
 */
function checkMetaPath(pathExtractor = (req) => req.query.path || req.body.path) {
  return (req, res, next) => {
    const path = pathExtractor(req);
    if (path && isMetaPath(path)) {
      const user = req.user?.full || req.user;
      if (!user || !user.is_admin) {
        throw forbiddenError('Access denied');
      }
    }
    next();
  };
}

module.exports = {
  checkMetaPathAccess,
  checkMetaPath,
};
