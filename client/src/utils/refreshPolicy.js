/**
 * Refresh policy for async file operations.
 *
 * Goal: prevent stale-closure refreshes from reloading the wrong directory
 * after the user navigates elsewhere. NodeIds are compared by identity.
 */

/**
 * Decide whether to refresh the file list after an operation completes.
 *
 * Rules:
 * - If user didn't navigate (current === started): refresh.
 * - For move/copy: if user navigated to the target parent folder: refresh.
 * - For non move/copy: if user navigated away: do NOT refresh.
 */
export const shouldRefreshAfterOperation = ({
  opType,
  startedNodeId,
  currentNodeIdNow,
  targetParentNodeId,
}) => {
  const op = opType || 'refresh';

  if (op === 'move' || op === 'copy') {
    return (
      currentNodeIdNow === startedNodeId ||
      (targetParentNodeId != null && currentNodeIdNow === targetParentNodeId)
    );
  }

  return currentNodeIdNow === startedNodeId;
};
