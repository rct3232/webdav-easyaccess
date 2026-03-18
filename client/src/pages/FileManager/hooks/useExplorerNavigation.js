import { useCallback, useRef, useState } from 'react';
import { normalizePath } from '../../../utils/pathUtils';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';

function createForbiddenError() {
  const error = new Error('Permission denied');
  error.response = { status: HTTP_STATUS.FORBIDDEN };
  return error;
}

export function useExplorerNavigation({
  currentPath,
  getPreviousPath,
  setCurrentPath,
  onAfterNavigate,
  onTrackPathHistory,
  canNavigateToPath,
} = {}) {
  const [isNavigating, setIsNavigating] = useState(false);
  const navigationSeqRef = useRef(0);

  const navigateToPath = useCallback(async (nextPath) => {
    if (!nextPath) return;

    const previousPath = typeof getPreviousPath === 'function'
      ? getPreviousPath()
      : currentPath;

    const normalizedPath = normalizePath(nextPath);
    if (!normalizedPath) return;
    if (normalizePath(previousPath || '') === normalizedPath) return;

    if (typeof onTrackPathHistory === 'function' && previousPath) {
      onTrackPathHistory(normalizedPath, previousPath);
      onTrackPathHistory(nextPath, previousPath);
    }

    // Optimistic update: transition immediately.
    setCurrentPath(normalizedPath);
    if (typeof onAfterNavigate === 'function') onAfterNavigate(normalizedPath);

    if (typeof canNavigateToPath !== 'function') return;

    navigationSeqRef.current += 1;
    const seq = navigationSeqRef.current;
    setIsNavigating(true);

    try {
      const ok = await canNavigateToPath(normalizedPath);
      if (seq !== navigationSeqRef.current) return;
      if (ok === false) {
        throw createForbiddenError();
      }
    } catch (error) {
      if (seq !== navigationSeqRef.current) return;
      if (previousPath) {
        setCurrentPath(previousPath);
      }
      throw error;
    } finally {
      if (seq === navigationSeqRef.current) {
        setIsNavigating(false);
      }
    }
  }, [
    currentPath,
    getPreviousPath,
    setCurrentPath,
    onAfterNavigate,
    onTrackPathHistory,
    canNavigateToPath,
  ]);

  const handleFolderOpen = useCallback((folderPath) => navigateToPath(folderPath), [navigateToPath]);

  return { navigateToPath, handleFolderOpen, isNavigating };
}

