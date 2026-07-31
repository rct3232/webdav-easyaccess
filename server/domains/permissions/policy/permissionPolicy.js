/**
 * Centralized permission policy helpers.
 *
 * nodeId-based API (primary):
 * - canReadFolder(userId, dirNodeId)
 * - canWriteFolder(userId, dirNodeId)
 * - canGrantPermission(userId, targetNodeId)
 *
 * path-based API (backward-compat for non-migrated callers):
 * - canWriteFolder(user, folderPath) — accepts user object + path string
 * - canGrantPermission(user, folderPath, userId) — original signature
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const Permission = require('../../../models/Permission');
const User = require('../../../models/User');
const { checkFilePermission, checkFolderPermission, isSharePrincipal } = require('../services/aclService');
const permStore = require('../stores/permissionStore');
const { isOwnerNode, isOwnerPath, getHomeOwnerUserIdForPath, userRootPath } = require('./ownerNodeResolver');

function isAdminUser(user) {
  return Boolean(user?.is_admin);
}

// ============================================================================
// nodeId-based API (primary — new callers should use these)
// ============================================================================

/**
 * Check if user can read a folder (nodeId-based).
 */
async function canReadFolderNode(userId, dirNodeId, requiredPermission = PERMISSIONS.READ) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (await isOwnerNode(userId, dirNodeId)) return true;
  return await permStore.checkPermission(userId, dirNodeId, requiredPermission || PERMISSIONS.READ);
}

/**
 * Check if user can read a file (nodeId-based).
 */
async function canReadFileNode(userId, fileNodeId, requiredPermission = PERMISSIONS.READ) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return await checkFilePermission(userId, fileNodeId, requiredPermission);
}

/**
 * Check if user can write to a folder (nodeId-based).
 */
async function canWriteFolderNode(userId, dirNodeId) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (await isOwnerNode(userId, dirNodeId)) return true;
  return await permStore.checkPermission(userId, dirNodeId, PERMISSIONS.WRITE);
}

/**
 * Check if user can write to a file (nodeId-based).
 */
async function canWriteFileNode(userId, fileNodeId) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (isAdminUser(user)) return true;
  return await checkFilePermission(userId, fileNodeId, PERMISSIONS.WRITE);
}

/**
 * Check if user can grant permission on a node (nodeId-based).
 */
async function canGrantPermissionNode(userId, targetNodeId) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (await isOwnerNode(userId, targetNodeId)) return true;
  return await permStore.checkPermission(userId, targetNodeId, PERMISSIONS.ADMIN);
}

/**
 * Check if user can revoke permission on a node (nodeId-based).
 */
async function canRevokePermissionNode(userId, targetNodeId, targetUserId) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (userId === targetUserId) return true;
  if (isAdminUser(user)) return true;
  if (await isOwnerNode(userId, targetNodeId)) return true;
  return await permStore.checkPermission(userId, targetNodeId, PERMISSIONS.ADMIN);
}

/**
 * Check if user can view permissions for a node (nodeId-based).
 */
async function canViewPermissionsNode(userId, targetNodeId) {
  const user = await getUserOrNull(userId);
  if (!user) return false;
  if (isAdminUser(user)) return true;
  if (await isOwnerNode(userId, targetNodeId)) return true;
  return await permStore.checkPermission(userId, targetNodeId, PERMISSIONS.ADMIN);
}

// ============================================================================
// path-based API (backward-compat — original signatures preserved)
// ============================================================================

/**
 * Direct folder permission check. Uses Permission model directly for compat.
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
 * Direct-only read check for folders. Delegates to aclService.
 */
async function canReadFolder(principalId, folderPath, requiredPermission = PERMISSIONS.READ) {
  if (typeof principalId === 'number' && typeof folderPath === 'number') {
    return await canReadFolderNode(principalId, folderPath, requiredPermission);
  }
  return await checkFolderPermission(principalId, folderPath, requiredPermission);
}

/**
 * Direct-only read check for files. Delegates to aclService.
 */
async function canReadFile(principalId, filePath, requiredPermission = PERMISSIONS.READ) {
  if (typeof principalId === 'number' && typeof filePath === 'number') {
    return await canReadFileNode(principalId, filePath, requiredPermission);
  }
  return await checkFilePermission(principalId, filePath, requiredPermission);
}

/**
 * Write check for folders. Admin/owner bypass + direct permission.
 */
async function canWriteFolder(user, folderPath) {
  if (!user) return false;
  const userId = typeof user === 'number' ? user : user.id;
  if (isAdminUser(user)) return true;
  if (typeof folderPath === 'string') {
    if (isOwnerPath(user, folderPath)) return true;
    return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.WRITE);
  }
  return await canWriteFolderNode(userId, folderPath);
}

/**
 * Write check for files. Admin/owner bypass + effective permission.
 */
async function canWriteFileByParent(user, filePath) {
  if (!user) return false;
  const userId = typeof user === 'number' ? user : user.id;
  if (isAdminUser(user)) return true;
  if (typeof filePath === 'string') {
    if (isOwnerPath(user, filePath)) return true;
    return await checkFilePermission(userId, filePath, PERMISSIONS.WRITE);
  }
  return await canWriteFileNode(userId, filePath);
}

/**
 * Check if user can grant permission to a folder.
 */
async function canGrantPermission(user, folderPath, userId) {
  if (!user) return false;
  const callerId = typeof user === 'number' ? user : user.id;
  if (isAdminUser(user)) return true;

  if (typeof folderPath === 'string') {
    if (isOwnerPath(user, folderPath)) return true;
    return await hasDirectFolderPermission(userId || callerId, folderPath, PERMISSIONS.ADMIN);
  }
  const targetId = userId !== undefined ? userId : folderPath;
  if (await isOwnerNode(callerId, targetId)) return true;
  return await permStore.checkPermission(callerId, targetId, PERMISSIONS.ADMIN);
}

/**
 * Check if user can revoke permission from a folder.
 */
async function canRevokePermission(user, folderPath, userId, targetUserId) {
  if (!user) return false;
  const callerId = typeof user === 'number' ? user : user.id;

  if (typeof folderPath === 'string') {
    if (userId === targetUserId) return true;
    if (isAdminUser(user)) return true;
    if (isOwnerPath(user, folderPath)) return true;
    return await hasDirectFolderPermission(userId, folderPath, PERMISSIONS.ADMIN);
  }

  if (callerId === targetUserId) return true;
  if (isAdminUser(user)) return true;
  const targetNodeId = userId;
  if (await isOwnerNode(callerId, targetNodeId)) return true;
  return await permStore.checkPermission(callerId, targetNodeId, PERMISSIONS.ADMIN);
}

/**
 * Check if user can view permissions for a folder.
 */
async function canViewPermissions(user, folderPath, userId) {
  if (!user) return false;
  const callerId = typeof user === 'number' ? user : user.id;
  if (isAdminUser(user)) return true;

  if (typeof folderPath === 'string') {
    if (isOwnerPath(user, folderPath)) return true;
    return await hasDirectFolderPermission(userId || callerId, folderPath, PERMISSIONS.ADMIN);
  }

  const targetNodeId = userId !== undefined ? userId : folderPath;
  if (await isOwnerNode(callerId, targetNodeId)) return true;
  return await permStore.checkPermission(callerId, targetNodeId, PERMISSIONS.ADMIN);
}

// --- Sync checkers (backward-compat) ---

function buildSyncWriteChecker(user, doc) {
  return (folderPath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, folderPath)) return true;
    return Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.WRITE);
  };
}

function buildSyncReadChecker(user, doc) {
  return (folderPath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, folderPath)) return true;
    return Permission.checkPermissionSync(doc, folderPath, PERMISSIONS.READ);
  };
}

function buildSyncReadFileChecker(user, doc) {
  return (filePath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, filePath)) return true;
    return Permission.checkFilePermissionSync(doc, filePath, PERMISSIONS.READ);
  };
}

function buildSyncWriteFileByParentChecker(user, doc) {
  return (filePath) => {
    if (!user) return false;
    if (isAdminUser(user) || isOwnerPath(user, filePath)) return true;
    return Permission.checkFilePermissionSync(doc, filePath, PERMISSIONS.WRITE);
  };
}

/**
 * Fetch user by id.
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
  // Identity helpers
  isAdminUser,
  isOwnerPath,
  getHomeOwnerUserIdForPath,

  // nodeId-based API (primary)
  canReadFolderNode,
  canWriteFolderNode,
  canReadFileNode,
  canWriteFileNode,
  canGrantPermissionNode,
  canRevokePermissionNode,
  canViewPermissionsNode,

  // path-based API (backward-compat — dual-mode: detects nodeId vs path)
  hasDirectFolderPermission,
  canReadFolder,
  canReadFile,
  canWriteFolder,
  canWriteFileByParent,
  canGrantPermission,
  canRevokePermission,
  canViewPermissions,

  // Sync checkers (backward-compat)
  buildSyncWriteChecker,
  buildSyncReadChecker,
  buildSyncReadFileChecker,
  buildSyncWriteFileByParentChecker,

  // Utilities
  getUserOrNull,
};
