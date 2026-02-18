/**
 * Middleware to guard against meta path access
 * Only admin users can access meta paths (/.wea)
 * 
 * Usage: router.get('/path', authenticateToken, requireUser, checkMetaPathAccess, handler)
 */

const { isMetaPath } = require('../store/metaPaths');
const { forbiddenError } = require('../utils/errorHandler');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');

/**
 * Middleware to check if path is a meta path and block non-admin access
 * For Share context: block all meta path access; block paths outside share root
 * Requires authenticateTokenOrShare + requireAuth before this (req.principalId, req.shareContext)
 *
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
function checkMetaPathAccess(req, res, next) {
  const user = req.user?.full || req.user;

  if (req.shareContext) {
    const { rootPath, isDirectory } = req.shareContext;
    const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
    const { isPathUnder } = require('@webdav-easyaccess/shared/pathUtils');

    const pathsToCheck = [
      req.query.path,
      req.body.path,
      req.params.path,
      req.body.sourcePath,
      req.body.destinationPath,
      ...(Array.isArray(req.body.paths) ? req.body.paths : []),
    ].filter(Boolean);

    for (const p of pathsToCheck) {
      const pathVal = typeof p === 'string' ? p.trim() : '';
      if (!pathVal) continue;
      const normalized = normalizePath(pathVal);
      if (isMetaPath(normalized)) {
        throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
      }
      if (!isPathUnder(normalized, rootPath)) {
        throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
      }
    }
    return next();
  }

  const path = req.query.path || req.body.path || req.params.path || req.body.sourcePath || req.body.destinationPath;

  if (path && isMetaPath(path)) {
    if (!user || !user.is_admin) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
  }

  if (req.body.sourcePath && isMetaPath(req.body.sourcePath)) {
    if (!user || !user.is_admin) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
    }
  }

  if (req.body.destinationPath && isMetaPath(req.body.destinationPath)) {
    if (!user || !user.is_admin) {
      throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
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
        throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);
      }
    }
    next();
  };
}

module.exports = {
  checkMetaPathAccess,
  checkMetaPath,
};
