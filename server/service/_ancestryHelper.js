'use strict';

/**
 * Closure-table maintenance helper for node_ancestors.
 *
 * Called exclusively by fileNodeService — never exposed to routes.
 * No transaction wrapping; TX ownership belongs to the orchestration layer.
 */
function createAncestryHelper(fileNodesStore) {
  /* ------------------------------------------------------------------ */
  /*  Insert-time ancestor bookkeeping                                  */
  /* ------------------------------------------------------------------ */

  async function buildAncestorsForNode(nodeId, parentId) {
    if (parentId === null || parentId === undefined) {
      await fileNodesStore.insertAncestorRows([
        { ancestorId: nodeId, descendantId: nodeId, depth: 0 },
      ]);
      return;
    }

    const parentChain = await fileNodesStore.getAncestorChain(parentId);

    const rows = [{ ancestorId: nodeId, descendantId: nodeId, depth: 0 }];
    for (const entry of parentChain) {
      rows.push({
        ancestorId: entry.ancestorId,
        descendantId: nodeId,
        depth: entry.depth + 1,
      });
    }

    await fileNodesStore.insertAncestorRows(rows);
  }

  /* ------------------------------------------------------------------ */
  /*  Post-move subtree rebuild (delete-then-insert)                    */
  /* ------------------------------------------------------------------ */

  async function rebuildAncestorsAfterMove(movedNodeId, newParentId) {
    const descendantIds = await fileNodesStore.getDescendantIds(movedNodeId);

    await fileNodesStore.deleteAncestorByDescendant(descendantIds);

    let newParentChain = [];
    if (newParentId !== null && newParentId !== undefined) {
      newParentChain = await fileNodesStore.getAncestorChain(newParentId);
    }

    const allRows = [];
    const queue = [{ nodeId: movedNodeId, parentChainForParent: newParentChain }];

    while (queue.length > 0) {
      const { nodeId, parentChainForParent } = queue.shift();

      allRows.push({ ancestorId: nodeId, descendantId: nodeId, depth: 0 });
      for (const entry of parentChainForParent) {
        allRows.push({
          ancestorId: entry.ancestorId,
          descendantId: nodeId,
          depth: entry.depth + 1,
        });
      }

      const children = await fileNodesStore.getChildren(nodeId);
      const childParentChain = [
        { ancestorId: nodeId, depth: 0 },
        ...parentChainForParent.map((e) => ({
          ancestorId: e.ancestorId,
          depth: e.depth + 1,
        })),
      ];
      for (const child of children) {
        queue.push({ nodeId: child.id, parentChainForParent: childParentChain });
      }
    }

    if (allRows.length > 0) {
      await fileNodesStore.insertAncestorRows(allRows);
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Explicit cleanup on deletion (safety net; FK CASCADE is primary)   */
  /* ------------------------------------------------------------------ */

  async function cleanupAncestorsForDeletion(nodeIds) {
    if (!nodeIds || nodeIds.length === 0) return;
    await fileNodesStore.deleteAncestorByDescendant(nodeIds);
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                         */
  /* ------------------------------------------------------------------ */

  return {
    buildAncestorsForNode,
    rebuildAncestorsAfterMove,
    cleanupAncestorsForDeletion,
  };
}

module.exports = { createAncestryHelper };
