/**
 * Owner detection via nodeId ancestry checks using the closure table.
 * Honors the permissionPolicy convention — an ADMIN is the owner of every
 * node (admin-owns-everything, docs/features/permissions.md "Owner exception"
 * + fileService.md): the admin check precedes the home/ancestry path.
 */
const { createFileNodesStore } = require('../../../store/fileNodesStore');
const userStore = require('../../../store/userStore');

let _fileNodesStore;
function getFileNodesStore() {
  if (!_fileNodesStore) _fileNodesStore = createFileNodesStore();
  return _fileNodesStore;
}

/* ------------------------------------------------------------------ */
/* Primary API: nodeId-based owner detection                          */
/* ------------------------------------------------------------------ */

async function isOwnerNode(userId, targetNodeId) {
  // Admin convention (mirrors permissionPolicy.isAdminUser — permissionPolicy
  // requires this module, so importing it back would create a cycle):
  // admin ⇒ owner of everything. Same user resolution as
  // FileNodeRepository.getUserRootNode (userStore.findById).
  const user = await userStore.findById(Number(userId));
  if (user?.is_admin) return true;

  const store = getFileNodesStore();
  const rootNode = await store.getUserRootNode(userId);
  if (!rootNode) return false;
  if (targetNodeId === rootNode.id) return true;
  const result = await store.isAncestor(rootNode.id, targetNodeId);
  return !!result;
}

module.exports = {
  isOwnerNode,
};
