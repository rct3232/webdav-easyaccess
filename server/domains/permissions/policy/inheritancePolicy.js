/**
 * Inheritance policy for nodeId-based permission checks.
 *
 * Rules:
 * 1. Permission resolution uses closure table ancestor traversal via permStore.
 * 2. Nearest ancestor (smallest depth) wins.
 * 3. Admin/owner bypass is handled by the caller (permissionPolicy layer).
 */

const permStore = require('../stores/permissionStore');

/**
 * Get effective permission for a userId on a target nodeId.
 * Traverses closure table to find nearest ancestor with a direct grant.
 * Returns the permission string (e.g. 'read', 'write', 'admin') or null.
 */
async function getEffectivePermission(userId, targetNodeId) {
  return await permStore.getPathEffectivePermission(userId, targetNodeId);
}

/**
 * Check whether a userId has at least the required permission on a target nodeId
 * via ancestor inheritance (closure table). Does NOT check direct grants —
 * use permStore.checkPermission for that. This is a policy-level helper
 * for callers that want to know if inheritance alone would satisfy a requirement.
 */
async function hasInheritedPermission(userId, targetNodeId, requiredPermission) {
  return await permStore.checkPermission(userId, targetNodeId, requiredPermission);
}

module.exports = {
  getEffectivePermission,
  hasInheritedPermission,
};
