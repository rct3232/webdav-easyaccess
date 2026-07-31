/**
 * Owner detection via nodeId ancestry checks using the closure table.
 * Replaces path-string prefix matching with nodeId-based ancestor verification.
 *
 * Primary API (nodeId-based):
 *   - isOwnerNode(userId, targetNodeId)
 *   - getUserRootNodeId(userId)
 *   - canAccessNode(userId, targetNodeId)
 *
 * Backward-compat API (path-based, re-exported from former ownerPathResolver):
 *   - userRootPath(user)
 *   - isOwnerPath(user, targetPath)
 *   - getHomeOwnerUserIdForPath(folderPath)
 */
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const User = require('../../../models/User');

let _fileNodesStore;
function getFileNodesStore() {
  if (!_fileNodesStore) _fileNodesStore = createFileNodesStore();
  return _fileNodesStore;
}

/* ------------------------------------------------------------------ */
/* Primary API: nodeId-based owner detection                          */
/* ------------------------------------------------------------------ */

async function getUserRootNodeId(userId) {
  const store = getFileNodesStore();
  const rootNode = await store.getUserRootNode(userId);
  if (!rootNode) return null;
  return rootNode.id;
}

async function isOwnerNode(userId, targetNodeId) {
  const store = getFileNodesStore();
  const rootNode = await store.getUserRootNode(userId);
  if (!rootNode) return false;
  if (targetNodeId === rootNode.id) return true;
  const result = await store.isAncestor(rootNode.id, targetNodeId);
  return !!result;
}

async function canAccessNode(userId, targetNodeId) {
  return isOwnerNode(userId, targetNodeId);
}

/* ------------------------------------------------------------------ */
/* Backward-compat API: path-based helpers (from ownerPathResolver)   */
/* ------------------------------------------------------------------ */

function userRootPath(user) {
  if (!user || !user.username) return null;
  return `/${user.username}`;
}

function isOwnerPath(user, targetPath) {
  const root = userRootPath(user);
  if (!root) return false;
  const normalized = normalizePath(targetPath);
  return normalized === root || normalized.startsWith(`${root}/`);
}

async function getHomeOwnerUserIdForPath(folderPath) {
  const normalized = normalizePath(folderPath);
  const segments = normalized.split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const username = segments[0];
  const user = await User.findByUsername(username);
  return user ? user.id : null;
}

module.exports = {
  // Primary nodeId-based API
  getUserRootNodeId,
  isOwnerNode,
  canAccessNode,

  // Backward-compat path-based API
  userRootPath,
  isOwnerPath,
  getHomeOwnerUserIdForPath,
};
