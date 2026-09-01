/**
 * ACL Service — core permission-checking logic.
 * nodeId-based interface using closure table for inheritance.
 * No Express coupling. Consumed by middleware, routes, and policy layer.
 */

const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const permissionStore = require('../../../store/permissionStore');
const User = require('../../../models/User');
const { meetsRank } = require('../policy/permissionRank');
const { getSharedResolver } = require('../../../infrastructure/configResolver');

// --- User cache (extracted from middleware/permissions.js) ---
const userCache = new Map();

async function getCachedUser(userId) {
  const key = String(userId);
  const cached = userCache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user;
  }
  const user = await User.findById(userId);
  // USER_CACHE_TTL_MS is T2 (lazy): read the effective value per call. The
  // test-mode 0 short-circuit is preserved so unit tests never cache.
  const cacheTtlMs =
    process.env.NODE_ENV === 'test'
      ? 0
      : parseInt(await getSharedResolver().getConfig('USER_CACHE_TTL_MS'), 10) || 3000;
  if (user && cacheTtlMs > 0) {
    userCache.set(key, { user, expiresAt: Date.now() + cacheTtlMs });
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

function isAdminUser(userOrId) {
  if (typeof userOrId === 'object' && userOrId !== null) {
    return Boolean(userOrId.is_admin);
  }
  return false;
}

// --- Core permission checks (nodeId-based) ---

/**
 * Check file permission for a principal.
 * Resolves share principals via token, admin users bypass all checks,
 * and regular users are checked against direct file permissions first,
 * then ancestor folder permissions via the closure table.
 */
async function checkFilePermission(principalId, fileNodeId, requiredPermission = PERMISSIONS.READ) {
  // Share principal: resolve via token → permissions_shares → closure table descendant check
  if (isSharePrincipal(principalId)) {
    const token = extractShareToken(principalId);
    return token
      ? permissionStore.checkSharePermission(token, fileNodeId, requiredPermission)
      : false;
  }

  // Regular user: fetch and check admin status
  const userId = principalId;
  const user = await getCachedUser(userId);
  if (!user) {
    return false;
  }

  // Admin bypass
  if (isAdminUser(user)) {
    return true;
  }

  // Direct file permission takes precedence over inheritance.
  const filePerm = await permissionStore.getFilePermission(userId, fileNodeId);
  if (filePerm) {
    return meetsRank(filePerm.permission, requiredPermission);
  }

  // Inherited from ancestor folder via closure table?
  return await permissionStore.checkPermission(userId, fileNodeId, requiredPermission);
}

/**
 * Check folder/directory permission for a principal.
 * Resolves share principals via token, admin users bypass all checks,
 * and regular users are checked against the closure table for directory permissions.
 */
async function checkFolderPermission(
  principalId,
  dirNodeId,
  requiredPermission = PERMISSIONS.READ
) {
  // Share principal: resolve via token → permissions_shares → closure table descendant check
  if (isSharePrincipal(principalId)) {
    const token = extractShareToken(principalId);
    return token
      ? permissionStore.checkSharePermission(token, dirNodeId, requiredPermission)
      : false;
  }

  // Regular user: fetch and check admin status
  const userId = principalId;
  const user = await getCachedUser(userId);
  if (!user) {
    return false;
  }

  // Admin bypass
  if (isAdminUser(user)) {
    return true;
  }

  // Check via closure table (direct or inherited from ancestor)
  return await permissionStore.checkPermission(userId, dirNodeId, requiredPermission);
}

/**
 * Unified permission check entry point.
 * Determines file vs folder by the isDirectory flag and delegates accordingly.
 */
async function checkPermission(
  nodeId,
  principalId,
  action = PERMISSIONS.READ,
  isDirectory = false
) {
  if (isSharePrincipal(principalId)) {
    const token = extractShareToken(principalId);
    return token ? permissionStore.checkSharePermission(token, nodeId, action) : false;
  }

  const userId = principalId;
  const user = await getCachedUser(userId);
  if (!user || !isAdminUser(user)) {
    // Non-admin: delegate to file/folder specific checkers
    if (isDirectory) {
      return await checkFolderPermission(principalId, nodeId, action);
    }
    return await checkFilePermission(principalId, nodeId, action);
  }

  // Admin bypass
  return true;
}

// --- Write permission checks (admin bypass + async) ---

async function canWriteFolder(user, dirNodeId) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return await checkFolderPermission(user.id, dirNodeId, PERMISSIONS.WRITE);
}

async function canWriteFile(user, fileNodeId) {
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return await checkFilePermission(user.id, fileNodeId, PERMISSIONS.WRITE);
}

// --- Cache utilities ---
function __clearUserCacheForTests() {
  userCache.clear();
}

module.exports = {
  // Identity helpers
  isSharePrincipal,
  extractShareToken,
  isAdminUser,

  // Async permission checks (principalId + nodeId-based)
  checkFilePermission,
  checkFolderPermission,
  checkPermission,

  // User object-based write checks (admin bypass included)
  canWriteFolder,
  canWriteFile,

  // Cache utilities
  getCachedUser,
  __clearUserCacheForTests,
};
