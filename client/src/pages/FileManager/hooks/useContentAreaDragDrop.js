import { useCallback } from 'react';
import { getParentPath } from '../../../utils/pathUtils';

/**
 * Centralizes content-area drag/drop: guards (mobile, selection mode, write permission),
 * same-parent skip, data-file-path skip, and delegation to file-area handlers or internal move.
 *
 * @param {Object} options
 * @param {boolean} options.isMobile - When true, all handlers no-op
 * @param {boolean} options.selectionMode - When true, all handlers no-op
 * @param {boolean} options.hasWritePermission - When false, all handlers no-op
 * @param {string} options.currentPath - Current folder path (target for drops)
 * @param {string|null} options.contentAreaDraggedPath - Path of file being dragged (internal); used for same-parent skip
 * @param {Function} options.setContentAreaDraggedPath - Setter for contentAreaDraggedPath
 * @param {Function} options.setContentAreaDragType - Setter for overlay type: 'external' | 'internal' | null
 * @param {Function} options.handleInternalFileDrop - (draggedPath, targetFolderPath) => void for internal move
 * @param {Function} options.handleExplorerDrop - Passed to file-area drop for external uploads
 * @param {Function} options.handleFileAreaDragEnter - From useDropToUpload
 * @param {Function} options.handleFileAreaDragOver - From useDropToUpload
 * @param {Function} options.handleFileAreaDragLeave - From useDropToUpload
 * @param {Function} options.handleFileAreaDrop - From useDropToUpload
 * @param {Function} [options.resetFileAreaDrag] - From useDropToUpload (optional)
 * @returns {{ handleContentAreaDragEnter: Function, handleContentAreaDragOver: Function, handleContentAreaDragLeave: Function, handleContentAreaDrop: Function }}
 */
export function useContentAreaDragDrop(options) {
  const {
    isMobile,
    selectionMode,
    hasWritePermission,
    currentPath,
    contentAreaDraggedPath,
    setContentAreaDraggedPath,
    setContentAreaDragType,
    handleInternalFileDrop,
    handleExplorerDrop,
    handleFileAreaDragEnter,
    handleFileAreaDragOver,
    handleFileAreaDragLeave,
    handleFileAreaDrop,
    resetFileAreaDrag,
  } = options;

  const getDragTypes = useCallback((e) => {
    const types = e.dataTransfer?.types || [];
    return {
      isExternal: types.includes('Files'),
      isInternalTree: types.includes('text/plain'),
    };
  }, []);

  const handleContentAreaDragEnter = useCallback(
    (e) => {
      if (isMobile || selectionMode || !hasWritePermission) return;

      const { isExternal, isInternalTree } = getDragTypes(e);
      if (isInternalTree && contentAreaDraggedPath && getParentPath(contentAreaDraggedPath) === currentPath) {
        return;
      }
      if (e.target.closest('[data-file-path]')) return;
      if (isExternal || isInternalTree) {
        setContentAreaDragType(isExternal ? 'external' : 'internal');
        handleFileAreaDragEnter(e);
      }
    },
    [
      isMobile,
      selectionMode,
      hasWritePermission,
      getDragTypes,
      contentAreaDraggedPath,
      currentPath,
      setContentAreaDragType,
      handleFileAreaDragEnter,
    ]
  );

  const handleContentAreaDragOver = useCallback(
    (e) => {
      if (isMobile || selectionMode || !hasWritePermission) return;

      const { isExternal, isInternalTree } = getDragTypes(e);
      if (isInternalTree && contentAreaDraggedPath && getParentPath(contentAreaDraggedPath) === currentPath) {
        return;
      }
      if (e.target.closest('[data-file-path]')) {
        handleFileAreaDragLeave(e);
        return;
      }
      if (isExternal || isInternalTree) {
        handleFileAreaDragOver(e);
      }
    },
    [
      isMobile,
      selectionMode,
      hasWritePermission,
      getDragTypes,
      contentAreaDraggedPath,
      currentPath,
      handleFileAreaDragLeave,
      handleFileAreaDragOver,
    ]
  );

  const handleContentAreaDragLeave = useCallback(
    (e) => {
      if (isMobile || selectionMode || !hasWritePermission) return;

      const { isExternal, isInternalTree } = getDragTypes(e);
      if (isExternal || isInternalTree) {
        if (!e.currentTarget.contains(e.relatedTarget)) {
          setContentAreaDragType(null);
        }
        handleFileAreaDragLeave(e);
      }
    },
    [
      isMobile,
      selectionMode,
      hasWritePermission,
      getDragTypes,
      setContentAreaDragType,
      handleFileAreaDragLeave,
    ]
  );

  const handleContentAreaDrop = useCallback(
    (e) => {
      if (isMobile || selectionMode || !hasWritePermission) return;

      const types = e.dataTransfer?.types || [];
      const isExternal = types.includes('Files');
      const internalPath = types.includes('text/plain') ? e.dataTransfer?.getData?.('text/plain') : null;

      setContentAreaDraggedPath(null);
      setContentAreaDragType(null);

      if (internalPath) {
        e.preventDefault();
        e.stopPropagation();
        resetFileAreaDrag?.();
        handleInternalFileDrop(internalPath, currentPath);
        return;
      }

      if (isExternal) {
        handleFileAreaDrop(e, currentPath, handleExplorerDrop);
      }
    },
    [
      isMobile,
      selectionMode,
      hasWritePermission,
      setContentAreaDraggedPath,
      setContentAreaDragType,
      resetFileAreaDrag,
      handleInternalFileDrop,
      currentPath,
      handleFileAreaDrop,
      handleExplorerDrop,
    ]
  );

  return {
    handleContentAreaDragEnter,
    handleContentAreaDragOver,
    handleContentAreaDragLeave,
    handleContentAreaDrop,
  };
}
