/**
 * ACL Service — core permission-checking logic.
 * No Express coupling. Consumed by middleware, routes, and policy layer.
 */

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const Permission = require('../../../models/Permission');
const User = require('../../../models/User');
const { normalizePath, getParentPath } = require('@webdav-easyaccess/shared/pathUtils');
const { meetsRank } = require('../policy/permissionRank');

// --- User cache (extracted from middleware/permissions.js) ---
const userCache = new Map();
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

// --- Share principal helpers ---
function isSharePrincipal(principalId) {
  return typeof principalId === 'string' && principalId.startsWith('share:');
}

function extractShareToken(principalId) {
  if (!isSharePrincipal(principalId)) return null;
  return principalId.slice(6);
}

// --- Core permission checks ---
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

  const { isOwnerPath: checkOwnerPath } = require('../policy/ownerPathResolver');
  if (checkOwnerPath(user, filePath)) {
    return true;
  }

  const doc = await Permission.getPermissionDoc(userId);
  const normalizedFile = normalizePath(filePath);
  const fp = doc.file_permissions || {};
  const filePerm = fp[normalizedFile];
  if (filePerm != null) {
    return meetsRank(filePerm, requiredPermission);
  }

  const folderPath = getParentPath(filePath);
  const normalizedFolderPath = normalizePath(folderPath, { isDirectory: true });

  let hasPermission = await Permission.checkPermission(userId, normalizedFolderPath, requiredPermission);
  if (!hasPermission && folderPath !== '/') {
    hasPermission = await Permission.checkPermission(userId, folderPath, requiredPermission);
  }

  if (!hasPermission) {
    if (checkOwnerPath(user, normalizedFolderPath) || checkOwnerPath(user, folderPath)) {
      hasPermission = true;
    }
  }

  return hasPermission;
}

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
    const { isOwnerPath: checkOwnerPath } = require('../policy/ownerPathResolver');
    if (checkOwnerPath(user, normalizedPath)) {
      hasPermission = true;
    }
  }

  return hasPermission;
}

/**
 * Unified permission check entry point.
 * Determines file vs folder automatically and delegates to the appropriate checker.
 */
async function checkPermission(path, principalId, action = PERMISSIONS.READ) {
  if (isSharePrincipal(principalId)) {
    const token = extractShareToken(principalId);
    return token ? Permission.checkSharePermission(token, path, action) : false;
  }

  const userId = principalId;
  const user = await getCachedUser(userId);
  if (!user || !user.is_admin) {
    // Non-admin: delegate to file/folder specific checkers
    const isDir = path.endsWith('/') || path === '/';
    if (isDir) {
      return await checkFolderPermission(principalId, path, action);
    } else {
      return await checkFilePermission(principalId, path, action);
    }
  }

  // Admin bypass
  return true;
}


async function canAccessPath(userId, requestedPath) {
  const user = await getCachedUser(userId);

  if (!user) {
    return false;
  }

  if (user.is_admin) {
    return true;
  }

  const normalizedPath = normalizePath(requestedPath);
  const { userRootPath } = require('../policy/ownerPathResolver');
  const userFolder = userRootPath(user);

  if (!userFolder || normalizedPath === '/' || normalizedPath === '') {
    return false;
  }

  return normalizedPath === userFolder || normalizedPath.startsWith(`${userFolder}/`);
}

function __clearUserCacheForTests() {
  userCache.clear();
}

module.exports = {
  isSharePrincipal,
  extractShareToken,
  checkFilePermission,
  checkFolderPermission,
  checkPermission,
  canAccessPath,
  getCachedUser,
  __clearUserCacheForTests,
};
