/**
 * Permission check middleware for Express routes.
 * Delegates core logic to domains/permissions/services/aclService.
 */

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const {
  checkFilePermission,
  checkFolderPermission,
  canAccessPath,
  isSharePrincipal,
  extractShareToken,
} = require('../domains/permissions/services/aclService');

/**
 * Express middleware factory to require specific permission
 * Usage: router.get('/path', requirePermission('read'), handler)
 *
 * @param {string} permissionType - Required permission type ('read' or 'write')
 * @param {function} pathExtractor - Function to extract path from req (default: req.query.path)
 * @returns {function} Express middleware function
 */
function requirePermission(permissionType = PERMISSIONS.READ, pathExtractor = (req) => req.query.path || req.body.path) {
  return async (req, res, next) => {
    try {
      const path = pathExtractor(req);
      if (!path) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.pathRequired });
      }

      const principalId = req.principalId ?? req.user?.id;
      if (principalId == null) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired });
      }

      const hasPermission = await checkFilePermission(principalId, path, permissionType);

      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.checkFail });
    }
  };
}

/**
 * Express middleware factory to require folder permission
 *
 * @param {string} permissionType - Required permission type ('read' or 'write')
 * @param {function} pathExtractor - Function to extract path from req
 * @returns {function} Express middleware function
 */
function requireFolderPermission(permissionType = PERMISSIONS.READ, pathExtractor = (req) => req.query.path || req.body.path) {
  return async (req, res, next) => {
    try {
      const path = pathExtractor(req);
      if (!path) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.pathRequired });
      }

      const principalId = req.principalId ?? req.user?.id;
      if (principalId == null) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired });
      }

      const hasPermission = await checkFolderPermission(principalId, path, permissionType);

      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ errorCode: SERVER_ERROR_CODES.permissionsMiddleware.checkFail });
    }
  };
}

module.exports = {
  checkFilePermission,
  checkFolderPermission,
  canAccessPath,
  requirePermission,
  requireFolderPermission,
  isSharePrincipal,
  extractShareToken,
};
