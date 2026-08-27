function isMoveOrCopyAction(action) {
  return action === 'copy' || action === 'move';
}

function getSourceNodeIds(sourceNodeId, sourceNodeIds) {
  return sourceNodeId != null
    ? [sourceNodeId]
    : (Array.isArray(sourceNodeIds) ? sourceNodeIds : []);
}

/**
 * Resolve the landing nodeId for home/shared toggle changes without mutating
 * React state or calling IO.
 */
export function resolveFolderPickerToggleTarget({
  nextPathType,
  action,
  sourceNodeId,
  sourceNodeIds,
  sharedFolderRoots,
  homeNodeId,
} = {}) {
  if (!nextPathType) {
    return null;
  }

  const homeTargetNodeId = homeNodeId ?? null;
  const sharedRootNodeId = null;

  if (!isMoveOrCopyAction(action)) {
    return {
      nodeId: nextPathType === 'shared' ? sharedRootNodeId : homeTargetNodeId,
      pathType: nextPathType,
      presetHasWritePermission: nextPathType === 'shared' ? true : undefined,
    };
  }

  const sourceIds = getSourceNodeIds(sourceNodeId, sourceNodeIds).filter((id) => id != null);
  const primarySourceNodeId = sourceIds[0] ?? null;

  if (nextPathType === 'home') {
    return {
      nodeId: homeTargetNodeId,
      pathType: 'home',
      presetHasWritePermission: undefined,
    };
  }

  const sharedRootIdStrings = (sharedFolderRoots || []).map((id) => String(id));
  if (primarySourceNodeId != null && sharedRootIdStrings.includes(String(primarySourceNodeId))) {
    return {
      nodeId: primarySourceNodeId,
      pathType: 'shared',
      presetHasWritePermission: undefined,
    };
  }

  return {
    nodeId: sharedRootNodeId,
    pathType: 'shared',
    presetHasWritePermission: true,
  };
}
