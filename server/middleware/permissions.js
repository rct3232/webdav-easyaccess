/**
 * Permission check middleware for Express routes
 */

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');

const userCache = new Map(); // userId -> { user, expiresAt }
const USER_CACHE_TTL_MS =
  process.env.NODE_ENV === 'test'
    ? 0
    : parseInt(process.env.USER_CACHE_TTL_MS || '3000', 10) || 3000;

async function getCachedUser(userId) {
  const key = String(userId);
  const cached = userCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  const user = await User.findById(userId);
  if (user && USER_CACHE_TTL_MS > 0) {
    userCache.set(key, { user, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  }
  return user;
}

function isOwnerPathSafe(user, targetPath) {
  if (!user?.username) return false;
  const root = `/${user.username}`;
  const normalized = normalizePath(targetPath);
  return normalized === root || normalized.startsWith(`${root}/`);
}

function isSharePrincipal(principalId) {
  return typeof principalId === 'string' && principalId.startsWith('share:');
}

function extractShareToken(principalId) {
  if (!isSharePrincipal(principalId)) return null;
  return principalId.slice(6); // 'share:'.length
}

/**
 * Check if principal has permission to access a file.
 * principalId: number (userId) or string ("share:token").
 * For Share principal: read-only, path must be within share rootPath.
 *
 * @param {number|string} principalId - User ID or "share:token"
 * @param {string} filePath - File path to check
 * @param {string} requiredPermission - Required permission level ('read', 'write', or 'admin')
 * @returns {Promise<boolean>} True if principal has permission
 */
async function checkFilePermission(principalId, filePath, requiredPermission = PERMISSIONS.READ) {
  if (isSharePrincipal(principalId)) {
    const token = extractShareToken(principalId);
    return token ? Permission.checkSharePermission(token, filePath, requiredPermission) : false;
  }

  const userId = principalId;
  const user = await getCachedUser(userId);
  if (!user) {
    return false;
  }

  if (user.is_admin) {
    return true;
  }

  if (isOwnerPathSafe(user, filePath)) {
    return true;
  }

  const doc = await Permission.getPermissionDoc(userId);
  const normalizedFile = normalizePath(filePath);
  const fp = doc.file_permissions || {};
  const filePerm = fp[normalizedFile];
  if (filePerm != null) {
    const rank = (p) => PERMISSIONS.ALL.indexOf(p);
    return rank(filePerm) >= rank(requiredPermission);
  }

  const folderPath = getParentPath(filePath);
  const normalizedFolderPath = normalizePath(folderPath, { isDirectory: true });

  let hasPermission = await Permission.checkPermission(userId, normalizedFolderPath, requiredPermission);
  if (!hasPermission && folderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  }

  if (!hasPermission) {
    if (isOwnerPathSafe(user, normalizedFolderPath) || isOwnerPathSafe(user, folderPath)) {
      hasPermission = true;
    }
  }

  return hasPermission;
}

/**
 * Check if principal has permission to access a folder (direct-only; no ancestor traversal).
 * principalId: number (userId) or string ("share:token").
 *
 * @param {number|string} principalId - User ID or "share:token"
 * @param {string} folderPath - Folder path to check
 * @param {string} requiredPermission - Required permission level ('read' or 'write')
 * @returns {Promise<boolean>} True if principal has permission
 */
async function checkFolderPermission(principalId, folderPath, requiredPermission = PERMISSIONS.READ) {
  if (isSharePrincipal(principalId)) {
    const token = extractShareToken(principalId);
    return token ? Permission.checkSharePermission(token, folderPath, requiredPermission) : false;
  }

  const userId = principalId;
  const user = await getCachedUser(userId);
  if (!user) {
    return false;
  }

  if (user.is_admin) {
    return true;
  }

  const normalizedPath = normalizePath(folderPath, { isDirectory: true });

  let hasPermission = await Permission.checkPermission(userId, normalizedPath, requiredPermission);
  if (!hasPermission && folderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, normalizePath(folderPath), requiredPermission);
  }

  if (!hasPermission) {
    if (isOwnerPathSafe(user, normalizedPath)) {
      hasPermission = true;
    }
  }

  return hasPermission;
}

/**
 * Check if user can access a path (for non-admin users)
 * 
 * @param {number} userId - User ID
 * @param {string} requestedPath - Path to check
 * @returns {Promise<boolean>} True if user can access
 */
async function canAccessPath(userId, requestedPath) {
  const user = await getCachedUser(userId);
  
  if (!user) {
    return false;
  }

  if (user.is_admin) {
    return true;
  }

  const normalizedPath = normalizePath(requestedPath);
  const userFolder = `/${user.username}`;
  
  if (normalizedPath === '/' || normalizedPath === '') {
    return false;
  }
  
  return normalizedPath === userFolder || normalizedPath.startsWith(`${userFolder}/`);
}

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

