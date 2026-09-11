/**
 * Centralized permission policy helpers.
 * nodeId-based API only.
 */
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const User = require('../../../models/User');
const permStore = require('../stores/permissionStore');
const { isOwnerNode } = require('./ownerNodeResolver');

function isAdminUser(user) {
  return Boolean(user?.is_admin);
}

// ============================================================================
// nodeId-based API (primary — new callers should use these)
// ============================================================================

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
  canGrantPermissionNode,
  canRevokePermissionNode,
  canViewPermissionsNode,
  getUserOrNull,
};
