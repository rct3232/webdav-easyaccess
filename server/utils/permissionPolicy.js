/**
 * Centralized permission policy helpers.
 *
 * Goals:
 * - Keep owner-folder exception: anything under /{username}/ is readable/writable for that user.
 * - Read checks use inherited/effective permissions (parent traversal).
 * - Write checks for shared paths use direct permissions (no ancestor fallback), unless admin/owner.
 *
 * NOTE: Permission storage supports both "/path" and "/path/" keys for compatibility.
 */
const path = require('path');
const Permission = require('../models/Permission');
const { normalizePath, normalizePathWithSlash } = require('./pathUtils');
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
 * Direct folder permission check (slash + no-slash compatibility).
 * Uses Permission.checkPermission only (no ancestor traversal).
 */
async function hasDirectFolderPermission(userId, folderPath, requiredPermission = 'read') {
  const dirPath = normalizePathWithSlash(folderPath);
  const noSlashPath = normalizePath(folderPath);

  let ok = await Permission.checkPermission(userId, dirPath, requiredPermission);
  if (!ok && noSlashPath !== '/') {
    ok = await Permission.checkPermission(userId, noSlashPath, requiredPermission);
  }
  return ok;
}

/**
 * Effective/inherited read check for folders.
 * Delegates to existing middleware logic (includes admin + owner exceptions).
 */
async function canReadFolder(userId, folderPath, requiredPermission = 'read') {
  return await checkFolderPermission(userId, folderPath, requiredPermission);
}

/**
 * Effective/inherited read check for files.
 * Delegates to existing middleware logic (includes admin + owner exceptions).
 */
async function canReadFile(userId, filePath, requiredPermission = 'read') {
  return await checkFilePermission(userId, filePath, requiredPermission);
}

/**
 * Direct-only write check for folders (shared paths), with admin/owner bypass.
 */
async function canWriteFolder(user, folderPath) {
  if (!user) return false;
  if (isAdminUser(user) || isOwnerPath(user, folderPath)) return true;
  return await hasDirectFolderPermission(user.id, folderPath, 'write');
}

/**
 * Direct-only write check for operations that require parent folder write (files),
 * with admin/owner bypass.
 */
async function canWriteFileByParent(user, filePath) {
  if (!user) return false;
  if (isAdminUser(user) || isOwnerPath(user, filePath)) return true;
  const normalized = normalizePath(filePath);
  const parent = path.posix.dirname(normalized) || '/';
  return await hasDirectFolderPermission(user.id, parent, 'write');
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
  return await hasDirectFolderPermission(userId, folderPath, 'admin');
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
  return await hasDirectFolderPermission(userId, folderPath, 'admin');
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
  return await hasDirectFolderPermission(userId, folderPath, 'admin');
}

module.exports = {
  isAdminUser,
  isOwnerPath,
  hasDirectFolderPermission,
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  getUserOrNull,
  canGrantPermission,
  canRevokePermission,
  canViewPermissions,
};

