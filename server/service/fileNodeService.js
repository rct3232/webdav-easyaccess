'use strict';

const { createAncestryHelper } = require('./_ancestryHelper');
const storage = require('../store/storage');

/**
 * Factory: create a file-node service bound to one store + backend at creation time.
 */
function createFileNodeService({ fileNodesStore }) {
  const ancestry = createAncestryHelper(fileNodesStore);

  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  /* ------------------------------------------------------------------ */
  /*  Create                                                             */
  /* ------------------------------------------------------------------ */

  async function createFile(parentNodeId, name) {
    return await withTx(async () => {
      const node = await fileNodesStore.createNode(parentNodeId, name, 'file');
      await ancestry.buildAncestorsForNode(node.id, parentNodeId);
      return node;
    });
  }

  async function createDirectory(parentNodeId, name) {
    return await withTx(async () => {
      const node = await fileNodesStore.createNode(parentNodeId, name, 'directory');
      await ancestry.buildAncestorsForNode(node.id, parentNodeId);
      return node;
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Rename                                                             */
  /* ------------------------------------------------------------------ */

  async function renameNode(nodeId, newName) {
    await fileNodesStore.renameNode(nodeId, newName);
  }

  /* ------------------------------------------------------------------ */
  /*  Move                                                               */
  /* ------------------------------------------------------------------ */

  async function moveNode(nodeId, newParentId) {
    const descendants = await fileNodesStore.getDescendantIds(nodeId);
    if (descendants.includes(newParentId)) {
      throw new Error('Cannot move node into its own descendant');
    }

    return await withTx(async () => {
      await fileNodesStore.moveNode(nodeId, newParentId);
      await ancestry.rebuildAncestorsAfterMove(nodeId, newParentId);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Delete                                                             */
  /* ------------------------------------------------------------------ */

  async function deleteNode(nodeId) {
    const descendantIds = await fileNodesStore.getDescendantIds(nodeId);
    return await withTx(async () => {
      await ancestry.cleanupAncestorsForDeletion(descendantIds);
      await fileNodesStore.deleteNodeTree(descendantIds);
    });
  }

  /* ------------------------------------------------------------------ */
  /*  Read                                                               */
  /* ------------------------------------------------------------------ */

  async function listDirectory(parentNodeId) {
    return await fileNodesStore.getChildren(parentNodeId);
  }

  async function getNodePath(nodeId) {
    const chain = await fileNodesStore.getAncestorChain(nodeId);
    const pathParts = [];
    for (const entry of [...chain].reverse()) {
      const node = await fileNodesStore.getNode(entry.ancestorId);
      if (node) pathParts.push(node.name);
    }
    return '/' + pathParts.join('/');
  }

  async function resolvePath(pathString) {
    const segments = pathString.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    let currentParentId = null;

    for (const segment of segments) {
      const result = await fileNodesStore.resolvePathSegment(currentParentId, segment);
      if (!result) return null;
      currentParentId = result.id;
    }

    return await fileNodesStore.getNode(currentParentId);
  }

  /* ------------------------------------------------------------------ */
  /*  Proxy / Simple                                                     */
  /* ------------------------------------------------------------------ */

  async function getDescendantIds(nodeId) {
    return await fileNodesStore.getDescendantIds(nodeId);
  }

  async function updateSyncStatus(nodeId, status) {
    await fileNodesStore.updateSyncStatus(nodeId, status);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  return {
    createFile,
    createDirectory,
    renameNode,
    moveNode,
    deleteNode,
    listDirectory,
    getNodePath,
    resolvePath,
    getDescendantIds,
    updateSyncStatus,
  };
}

module.exports = { createFileNodeService };
