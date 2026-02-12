/**
 * Centralized permission policy helpers.
 *
 * Goals:
 * - Keep owner-folder exception: anything under /{username}/ is readable/writable for that user.
 * - Read checks are direct-only (no inheritance). Write checks remain direct-only for shared paths.
 * - Admin/owner bypass applies to both read and write.
 *
 * NOTE: Permission storage supports both "/path" and "/path/" keys for compatibility.
 */
const path = require('path');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const Permission = require('../models/Permission');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { checkFilePermission, checkFolderPermission } = require('../middleware/permissions');
const User = require('../models/User');

function isAdminUser(user) {
  return Boolean(user?.is_admin);
}

function userRootPath(user) {
  if (!user?.username) return null;
  return `/${user.username}`;
}

/**
 * Owner-folder exception (safe prefix match):
 * - true if targetPath is exactly "/{username}" or starts with "/{username}/"
 */
function isOwnerPath(user, targetPath) {
  const root = userRootPath(user);
  if (!root) return false;
  const normalized = normalizePath(targetPath);
  return normalized === root || normalized.startsWith(`${root}/`);
}

/**
 * Get the user id of the home directory owner for a path.
 * Paths under /{username}/ have that user as "home owner".
 * @param {string} folderPath - Folder or file path (e.g. /alice/foo)
 * @returns {Promise<number|null>} User id if the first path segment matches a username, else null
 */
async function getHomeOwnerUserIdForPath(folderPath) {
  const normalized = normalizePath(folderPath);
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const username = segments[0];
  const user = await User.findByUsername(username);
  return user ? user.id : null;
}

/**
 * Direct folder permission check (slash + no-slash compatibility).
 * Uses Permission.checkPermission only (no ancestor traversal).
 */
async function hasDirectFolderPermission(userId, folderPath, requiredPermission = PERMISSIONS.READ) {
  const dirPath = normalizePath(folderPath, { isDirectory: true });
  const noSlashPath = normalizePath(folderPath);

  let ok = await Permission.checkPermission(userId, dirPath, requiredPermission);
  if (!ok && noSlashPath !== '/') {
    ok = await Permission.checkPermission(userId, noSlashPath, requiredPermission);
  }
  return ok;
}

/**
 * Direct-only read check for folders (no ancestor traversal).
 * Delegates to middleware (includes admin + owner exceptions).
 */
async function canReadFolder(userId, folderPath, requiredPermission = PERMISSIONS.READ) {
  return await checkFolderPermission(userId, folderPath, requiredPermission);
}

/**
 * Direct-only read check for files (parent folder only; no ancestor traversal).
 * Delegates to middleware (includes admin + owner exceptions).
 */
async function canReadFile(userId, filePath, requiredPermission = PERMISSIONS.READ) {
  return await checkFilePermission(userId, filePath, requiredPermission);
}

/**
 * Direct-only write check for folders (shared paths), with admin/owner bypass.
 */
async function canWriteFolder(user, folderPath) {
  if (!user) return false;
  if (isAdminUser(user) || isOwnerPath(user, folderPath)) return true;
  return await hasDirectFolderPermission(user.id, folderPath, PERMISSIONS.WRITE);
}

/**
 * Write check for file operations. Uses file effective permission (file-level if present, else parent path).
 * Admin/owner bypass.
 */
async function canWriteFileByParent(user, filePath) {
  if (!user) return false;
  if (isAdminUser(user) || isOwnerPath(user, filePath)) return true;
  return await checkFilePermission(user.id, filePath, PERMISSIONS.WRITE);
}

/**
 * Build a synchronous write checker (path) => boolean using a preloaded permission doc.
 * Use for batch operations to avoid per-path async permission calls.
 */
function buildSyncWriteChecker(user, doc) {
  return (folderPath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, folderPath)) return true;
    return Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.WRITE);
  };
}

/**
 * Build a synchronous read checker (path) => boolean using a preloaded permission doc.
 * Direct-only read (no ancestor traversal). Use for batch/list only.
 * @param {Object} user - User object (is_admin, username)
 * @param {Object} doc - Permission doc from getPermissionDoc(userId)
 * @returns {(folderPath: string) => boolean}
 */
function buildSyncReadChecker(user, doc) {
  return (folderPath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, folderPath)) return true;
    return Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.READ);
  };
}

/**
 * Build a synchronous read checker for files (filePath) => boolean using a preloaded doc.
 * Uses file effective permission (file-level if present, else parent path). Use for batch copy/download.
 * @param {Object} user - User object (is_admin, username)
 * @param {Object} doc - Permission doc from getPermissionDoc(userId)
 * @returns {(filePath: string) => boolean}
 */
function buildSyncReadFileChecker(user, doc) {
  return (filePath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, filePath)) return true;
    return Permission.checkFilePermissionSync(doc, filePath, PERMISSIONS.READ);
  };
}

/**
 * Build a synchronous file write checker (filePath) => boolean using a preloaded doc.
 * Uses file effective permission (file-level if present, else parent path).
 */
function buildSyncWriteFileByParentChecker(user, doc) {
  return (filePath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, filePath)) return true;
    return Permission.checkFilePermissionSync(doc, filePath, PERMISSIONS.WRITE);
  };
}

/**
 * Convenience wrapper to fetch user once when a route only has userId.
 */
async function getUserOrNull(userId) {
  if (!userId) return null;
  try {
    return await User.findById(userId);
  } catch {
    return null;
  }
}

/**
 * Check if user can grant permission to a folder
 * 
 * @param {Object} user - User object (must have is_admin and username properties)
 * @param {string} folderPath - Folder path to check
 * @param {number} userId - User ID (for hasDirectFolderPermission check)
 * @returns {Promise<boolean>} True if user can grant permission
 * 
 * @description
 * A user can grant permission if:
 * - User is admin
 * - User owns the folder (isOwnerPath)
 * - User has admin permission on the folder
 */
async function canGrantPermission(user, folderPath, userId) {
  if (!user) return false;
  
  // 관리자는 모든 폴더에 대해 권한 부여 가능
  if (isAdminUser(user)) {
    return true;
  }
  
  // 폴더 소유자는 자신의 폴더에 대한 권한 부여 가능
  if (isOwnerPath(user, folderPath)) {
    return true;
  }
  
  // 해당 폴더에 admin 권한이 있으면 권한 부여 가능
  return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.ADMIN);
}

/**
 * Check if user can revoke permission from a folder
 * 
 * @param {Object} user - User object (must have is_admin and username properties)
 * @param {string} folderPath - Folder path to check
 * @param {number} userId - User ID (for hasDirectFolderPermission check)
 * @param {number} targetUserId - Target user ID whose permission is being revoked
 * @returns {Promise<boolean>} True if user can revoke permission
 * 
 * @description
 * A user can revoke permission if:
 * - User is revoking their own permission (always allowed)
 * - User is admin
 * - User owns the folder (isOwnerPath)
 * - User has admin permission on the folder
 */
async function canRevokePermission(user, folderPath, userId, targetUserId) {
  if (!user) return false;
  
  // 자기 자신의 권한을 취소하는 경우는 항상 허용
  if (userId === targetUserId) {
    return true;
  }
  
  // 관리자는 모든 폴더에 대해 권한 취소 가능
  if (isAdminUser(user)) {
    return true;
  }
  
  // 폴더 소유자는 자신의 폴더에 대한 권한 취소 가능
  if (isOwnerPath(user, folderPath)) {
    return true;
  }
  
  // 해당 폴더에 admin 권한이 있으면 권한 취소 가능
  return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.ADMIN);
}

/**
 * Check if user can view permissions for a folder
 * 
 * @param {Object} user - User object (must have is_admin and username properties)
 * @param {string} folderPath - Folder path to check
 * @param {number} userId - User ID (for hasDirectFolderPermission check)
 * @returns {Promise<boolean>} True if user can view permissions
 * 
 * @description
 * A user can view permissions if:
 * - User is admin
 * - User owns the folder (isOwnerPath)
 * - User has admin permission on the folder
 */
async function canViewPermissions(user, folderPath, userId) {
  if (!user) return false;
  
  // 관리자는 모든 폴더의 권한 정보를 볼 수 있음
  if (isAdminUser(user)) {
    return true;
  }
  
  // 폴더 소유자는 자신의 폴더의 권한 정보를 볼 수 있음
  if (isOwnerPath(user, folderPath)) {
    return true;
  }
  
  // 해당 폴더에 admin 권한이 있으면 권한 정보를 볼 수 있음
  return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.ADMIN);
}

module.exports = {
  isAdminUser,
  isOwnerPath,
  getHomeOwnerUserIdForPath,
  hasDirectFolderPermission,
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncReadFileChecker,
  buildSyncWriteFileByParentChecker,
  getUserOrNull,
  canGrantPermission,
  canRevokePermission,
  canViewPermissions,
};

