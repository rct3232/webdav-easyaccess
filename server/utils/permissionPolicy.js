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

module.exports = {
  isAdminUser,
  isOwnerPath,
  hasDirectFolderPermission,
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  getUserOrNull,
};

