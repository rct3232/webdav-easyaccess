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
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const Permission = require('../../../models/Permission');
const User = require('../../../models/User');
const { checkFilePermission, checkFolderPermission, isSharePrincipal } = require('../services/aclService');
const { isOwnerPath, getHomeOwnerUserIdForPath } = require('./ownerPathResolver');

function isAdminUser(user) {
  return Boolean(user?.is_admin);
}

/**
 * Direct folder permission check (slash + no-slash compatibility).
 * Uses Permission.checkPermission only (no ancestor traversal).
 */
async function hasDirectFolderPermission(userId, folderPath, requiredPermission = PERMISSIONS.READ) {
  const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
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
 * principalId: number (userId) or string ("share:token"). Delegates to checkFolderPermission.
 */
async function canReadFolder(principalId, folderPath, requiredPermission = PERMISSIONS.READ) {
  return await checkFolderPermission(principalId, folderPath, requiredPermission);
}

/**
 * Direct-only read check for files (parent folder only; no ancestor traversal).
 * principalId: number (userId) or string ("share:token"). Delegates to checkFilePermission.
 */
async function canReadFile(principalId, filePath, requiredPermission = PERMISSIONS.READ) {
  return await checkFilePermission(principalId, filePath, requiredPermission);
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
 */
async function canGrantPermission(user, folderPath, userId) {
  if (!user) return false;

  if (isAdminUser(user)) {
    return true;
  }

  if (isOwnerPath(user, folderPath)) {
    return true;
  }

  return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.ADMIN);
}

/**
 * Check if user can revoke permission from a folder
 */
async function canRevokePermission(user, folderPath, userId, targetUserId) {
  if (!user) return false;

  if (userId === targetUserId) {
    return true;
  }

  if (isAdminUser(user)) {
    return true;
  }

  if (isOwnerPath(user, folderPath)) {
    return true;
  }

  return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.ADMIN);
}

/**
 * Check if user can view permissions for a folder
 */
async function canViewPermissions(user, folderPath, userId) {
  if (!user) return false;

  if (isAdminUser(user)) {
    return true;
  }

  if (isOwnerPath(user, folderPath)) {
    return true;
  }

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
