/**
 * Permission check middleware for Express routes
 */

const Permission = require('../models/Permission');
const User = require('../models/User');
const { normalizePath, normalizePathWithSlash, getParentPaths } = require('../utils/pathUtils');

/**
 * Check if user has permission to access a file
 * Checks the file's parent directory permissions
 * 
 * @param {number} userId - User ID
 * @param {string} filePath - File path to check
 * @param {string} requiredPermission - Required permission level ('read' or 'write')
 * @returns {Promise<boolean>} True if user has permission
 */
async function checkFilePermission(userId, filePath, requiredPermission = 'read') {
  const user = await User.findById(userId);
  if (!user) {
    return false;
  }

  // Admin has all permissions
  if (user.is_admin) {
    return true;
  }

  const folderPath = require('path').dirname(filePath) || '/';
  const normalizedFolderPath = normalizePathWithSlash(folderPath);
  
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
      const parentDirPath = normalizePathWithSlash(parentPath);
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
    const userFolder = `/${user.username}`;
    if (normalizedFolderPath.startsWith(userFolder) || folderPath.startsWith(userFolder)) {
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
async function checkFolderPermission(userId, folderPath, requiredPermission = 'read') {
  const user = await User.findById(userId);
  if (!user) {
    return false;
  }

  // Admin has all permissions
  if (user.is_admin) {
    return true;
  }

  const normalizedPath = normalizePathWithSlash(folderPath);
  
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
      const parentDirPath = normalizePathWithSlash(parentPath);
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
    const userFolder = `/${user.username}`;
    if (normalizedPath.startsWith(userFolder)) {
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
  const user = await User.findById(userId);
  
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
  
  return normalizedPath.startsWith(userFolder);
}

/**
 * Express middleware factory to require specific permission
 * Usage: router.get('/path', requirePermission('read'), handler)
 * 
 * @param {string} permissionType - Required permission type ('read' or 'write')
 * @param {function} pathExtractor - Function to extract path from req (default: req.query.path)
 * @returns {function} Express middleware function
 */
function requirePermission(permissionType = 'read', pathExtractor = (req) => req.query.path || req.body.path) {
  return async (req, res, next) => {
    try {
      const path = pathExtractor(req);
      if (!path) {
        return res.status(400).json({ error: 'Path is required' });
      }

      const hasPermission = await checkFilePermission(req.user.id, path, permissionType);
      
      if (!hasPermission) {
        return res.status(403).json({ error: 'Access denied' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
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
function requireFolderPermission(permissionType = 'read', pathExtractor = (req) => req.query.path || req.body.path) {
  return async (req, res, next) => {
    try {
      const path = pathExtractor(req);
      if (!path) {
        return res.status(400).json({ error: 'Path is required' });
      }

      const hasPermission = await checkFolderPermission(req.user.id, path, permissionType);
      
      if (!hasPermission) {
        return res.status(403).json({ error: 'Access denied' });
      }

      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({ error: 'Failed to check permissions' });
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

