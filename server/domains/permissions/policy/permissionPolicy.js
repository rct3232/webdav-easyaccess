/**
 * Centralized permission policy helpers.
 * nodeId-based API only.
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const User = require('../../../models/User');
const { checkFilePermission } = require('../services/aclService');
const permStore = require('../stores/permissionStore');
const { isOwnerNode } = require('./ownerNodeResolver');

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
  isAdminUser,
  canReadFolderNode,
  canWriteFolderNode,
  canReadFileNode,
  canWriteFileNode,
  canGrantPermissionNode,
  canRevokePermissionNode,
  canViewPermissionsNode,
  getUserOrNull,
};
