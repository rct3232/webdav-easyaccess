/**
 * Owner detection via nodeId ancestry checks using the closure table.
 */
const { createFileNodesStore } = require('../../../store/fileNodesStore');

let _fileNodesStore;
function getFileNodesStore() {
  if (!_fileNodesStore) _fileNodesStore = createFileNodesStore();
  return _fileNodesStore;
}

/* ------------------------------------------------------------------ */
/* Primary API: nodeId-based owner detection                          */
/* ------------------------------------------------------------------ */

async function isOwnerNode(userId, targetNodeId) {
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
