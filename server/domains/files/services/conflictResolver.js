const { getComposition } = require('../../../service/composition');

async function getConflictsByNodeIds(operations, opts = {}) {
  const limit = opts.limit !== false;
  const conflicts = [];

  if (!Array.isArray(operations) || operations.length === 0) {
    return conflicts;
  }

  const { fileNodeService } = getComposition();

  for (const op of operations) {
    if (limit && conflicts.length > 100) break;

    try {
      let sourceNodeId, destinationParentNodeId, name;

      if (op.type === 'upload') {
        sourceNodeId = null;
        destinationParentNodeId = op.destinationParentNodeId;
        name = op.name;
      } else {
        sourceNodeId = op.sourceNodeId;
        destinationParentNodeId = op.destinationParentNodeId;
        name = null;
      }

      if (!destinationParentNodeId) continue;

      if (sourceNodeId && !name) {
        const sourceNode = await fileNodeService.getNode(sourceNodeId);
        if (sourceNode) {
          name = sourceNode.name;
        } else {
          continue;
        }
      }

      if (!name) continue;

      const children = await fileNodeService.listDirectory(destinationParentNodeId);
      const existingChild = children.find(c => c.name === name && c.type !== 'directory');

      if (existingChild) {
        conflicts.push({
          sourceNodeId: sourceNodeId || -1,
          destinationParentNodeId,
          conflictingNodeId: existingChild.id,
          name,
          type: op.type || 'move',
        });
      }
    } catch (_) {
      // Skip operations that fail (e.g., invalid nodeIds)
    }
  }

  return conflicts;
}

module.exports = {
  getConflictsByNodeIds,
};
