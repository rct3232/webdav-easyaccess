import { useCallback, useRef, useState } from 'react';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';

function createForbiddenError() {
  const error = new Error('Permission denied');
  error.response = { status: HTTP_STATUS.FORBIDDEN };
  return error;
}

export function useExplorerNavigation({
  currentNodeId,
  getPreviousNodeId,
  setCurrentNodeId,
  onAfterNavigate,
  onTrackNodeHistory,
  canNavigateToNode,
} = {}) {
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationSeqRef = useRef(0);

  const navigateToNode = useCallback(
    async (nextNodeId) => {
      if (nextNodeId == null) return;

      const previousNodeId =
        typeof getPreviousNodeId === 'function' ? getPreviousNodeId() : currentNodeId;

      if (previousNodeId != null && previousNodeId === nextNodeId) return;

      if (typeof onTrackNodeHistory === 'function' && previousNodeId != null) {
        onTrackNodeHistory(nextNodeId, previousNodeId);
      }

      // Optimistic update: transition immediately.
      setCurrentNodeId(nextNodeId);
      if (typeof onAfterNavigate === 'function') onAfterNavigate(nextNodeId);

      if (typeof canNavigateToNode !== 'function') return;

      navigationSeqRef.current += 1;
      const seq = navigationSeqRef.current;
      setIsNavigating(true);

      try {
        const ok = await canNavigateToNode(nextNodeId);
        if (seq !== navigationSeqRef.current) return;
        if (ok === false) {
          throw createForbiddenError();
        }
      } catch (error) {
        if (seq !== navigationSeqRef.current) return;
        if (previousNodeId != null) {
          setCurrentNodeId(previousNodeId);
        }
        throw error;
      } finally {
        if (seq === navigationSeqRef.current) {
          setIsNavigating(false);
        }
      }
    },
    [
      currentNodeId,
      getPreviousNodeId,
      setCurrentNodeId,
      onAfterNavigate,
      onTrackNodeHistory,
      canNavigateToNode,
    ]
  );

  const handleFolderOpen = useCallback((nodeId) => navigateToNode(nodeId), [navigateToNode]);

  return { navigateToNode, handleFolderOpen, isNavigating };
}
