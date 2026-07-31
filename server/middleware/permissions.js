/**
 * Permission check middleware for Express routes.
 * Delegates core logic to domains/permissions/services/aclService.
 * nodeId-based interface: extracts nodeId from req, checks admin bypass, delegates to aclService.
 */

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const {
  checkFilePermission,
  checkFolderPermission,
  canAccessPath,
  isSharePrincipal,
  extractShareToken,
  getCachedUser,
  isAdminUser,
} = require('../domains/permissions/services/aclService');

/**
 * Express middleware factory to require specific permission on a nodeId.
 * Usage: router.get('/path', requirePermission('read'), handler)
 *
 * @param {string} permissionType - Required permission type ('read' or 'write')
 * @param {function} nodeIdExtractor - Function to extract nodeId from req (default: req.query.nodeId || req.body.nodeId)
 * @returns {function} Express middleware function
 */
function requirePermission(
  permissionType = PERMISSIONS.READ,
  nodeIdExtractor = (req) => req.query.nodeId || req.body.nodeId
) {
  return async (req, res, next) => {
    try {
      const nodeId = nodeIdExtractor(req);
      if (!nodeId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.pathRequired,
        });
      }

      const principalId = req.principalId ?? req.user?.id;
      if (principalId == null) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired,
        });
      }

      // Admin bypass
      const user = await getCachedUser(principalId);
      if (isAdminUser(user)) {
        return next();
      }

      const hasPermission = await checkFilePermission(
        principalId,
        nodeId,
        permissionType
      );

      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.checkFail,
      });
    }
  };
}

/**
 * Express middleware factory to require folder permission on a nodeId.
 *
 * @param {string} permissionType - Required permission type ('read' or 'write')
 * @param {function} nodeIdExtractor - Function to extract nodeId from req
 * @returns {function} Express middleware function
 */
function requireFolderPermission(
  permissionType = PERMISSIONS.READ,
  nodeIdExtractor = (req) => req.query.nodeId || req.body.nodeId
) {
  return async (req, res, next) => {
    try {
      const nodeId = nodeIdExtractor(req);
      if (!nodeId) {
        return res.status(HTTP_STATUS.BAD_REQUEST).json({
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.pathRequired,
        });
      }

      const principalId = req.principalId ?? req.user?.id;
      if (principalId == null) {
        return res.status(HTTP_STATUS.UNAUTHORIZED).json({
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.authenticationRequired,
        });
      }

      // Admin bypass
      const user = await getCachedUser(principalId);
      if (isAdminUser(user)) {
        return next();
      }

      const hasPermission = await checkFolderPermission(
        principalId,
        nodeId,
        permissionType
      );

      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({
          errorCode: SERVER_ERROR_CODES.permissionsMiddleware.accessDenied,
        });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
        errorCode: SERVER_ERROR_CODES.permissionsMiddleware.checkFail,
      });
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
