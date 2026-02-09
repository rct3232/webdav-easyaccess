/**
 * Permission check middleware for Express routes
 */

const { PERMISSIONS, HTTP_STATUS } = require('@webdav-easyaccess/shared/constants');
const Permission = require('../models/Permission');
const User = require('../models/User');
const { normalizePath, getParentPath, getParentPaths } = require('@webdav-easyaccess/shared/pathUtils');

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

/**
 * Check if user has permission to access a file
 * Checks the file's parent directory permissions
 * 
 * @param {number} userId - User ID
 * @param {string} filePath - File path to check
 * @param {string} requiredPermission - Required permission level ('read' or 'write')
 * @returns {Promise<boolean>} True if user has permission
 */
async function checkFilePermission(userId, filePath, requiredPermission = PERMISSIONS.READ) {
  const user = await getCachedUser(userId);
  if (!user) {
    return false;
  }

  // Admin has all permissions
  if (user.is_admin) {
    return true;
  }

  const folderPath = getParentPath(filePath);
  const normalizedFolderPath = normalizePath(folderPath, { isDirectory: true });
  
  // Check exact path permission
  let hasPermission = await Permission.checkPermission(userId, normalizedFolderPath, requiredPermission);
  
  // Check without trailing slash for backward compatibility
  if (!hasPermission && folderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  }
  
  // Check parent paths
  if (!hasPermission && normalizedFolderPath !== '/') {
    const parentPaths = getParentPaths(normalizedFolderPath);
    for (const parentPath of parentPaths) {
      const parentDirPath = normalizePath(parentPath, { isDirectory: true });
      hasPermission = await Permission.checkPermission(userId, parentDirPath, requiredPermission);
      if (!hasPermission && parentPath !== '/') {
        hasPermission = await Permission.checkPermission(userId, parentPath, requiredPermission);
      }
      if (hasPermission) {
        break;
      }
    }
  }
  
  // Check if it's user's own folder
  if (!hasPermission) {
    if (isOwnerPathSafe(user, normalizedFolderPath) || isOwnerPathSafe(user, folderPath)) {
      hasPermission = true;
    }
  }
  
  return hasPermission;
}

/**
 * Check if user has permission to access a folder
 * Checks parent folders recursively
 * 
 * @param {number} userId - User ID
 * @param {string} folderPath - Folder path to check
 * @param {string} requiredPermission - Required permission level ('read' or 'write')
 * @returns {Promise<boolean>} True if user has permission
 */
async function checkFolderPermission(userId, folderPath, requiredPermission = PERMISSIONS.READ) {
  const user = await getCachedUser(userId);
  if (!user) {
    return false;
  }

  // Admin has all permissions
  if (user.is_admin) {
    return true;
  }

  const normalizedPath = normalizePath(folderPath, { isDirectory: true });

  // Check exact path permission
  let hasPermission = await Permission.checkPermission(userId, normalizedPath, requiredPermission);

  // Check without trailing slash for backward compatibility
  if (!hasPermission && folderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, normalizePath(folderPath), requiredPermission);
  }
  
  // Check parent paths
  if (!hasPermission && normalizedPath !== '/') {
    const parentPaths = getParentPaths(normalizedPath);
    for (const parentPath of parentPaths) {
      const parentDirPath = normalizePath(parentPath, { isDirectory: true });
      hasPermission = await Permission.checkPermission(userId, parentDirPath, requiredPermission);
      if (!hasPermission && parentPath !== '/') {
        hasPermission = await Permission.checkPermission(userId, parentPath, requiredPermission);
      }
      if (hasPermission) {
        break;
      }
    }
  }
  
  // Check if it's user's own folder
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
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Path is required' });
      }

      const hasPermission = await checkFilePermission(req.user.id, path, permissionType);
      
      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to check permissions' });
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
        return res.status(HTTP_STATUS.BAD_REQUEST).json({ error: 'Path is required' });
      }

      const hasPermission = await checkFolderPermission(req.user.id, path, permissionType);
      
      if (!hasPermission) {
        return res.status(HTTP_STATUS.FORBIDDEN).json({ error: 'Access denied' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({ error: 'Failed to check permissions' });
    }
  };
}

module.exports = {
  checkFilePermission,
  checkFolderPermission,
  canAccessPath,
  requirePermission,
  requireFolderPermission,
};

