import { useCallback, useMemo } from 'react';

/**
 * Centralizes content-area drag/drop: guards (mobile, selection mode, write permission),
 * same-parent skip (by parentNodeId), data-file-path skip, and delegation to file-area
 * handlers or internal move.
 *
 * @param {Object} options
 * @param {boolean} options.isMobile - When true, all handlers no-op
 * @param {boolean} options.selectionMode - When true, all handlers no-op
 * @param {boolean} options.hasWritePermission - When false, all handlers no-op
 * @param {boolean} options.isShareLinkMode - Reserved for overlay logic in caller; hook may not use
 * @param {number|null} options.currentNodeId - Current folder nodeId (target for drops)
 * @param {number|null} options.contentAreaDraggedNodeId - NodeId of file being dragged (internal); used for same-parent skip
 * @param {number|null} options.contentAreaDraggedParentNodeId - Parent nodeId of the dragged file (same-parent skip)
 * @param {Function} options.setContentAreaDraggedNodeId - Setter for contentAreaDraggedNodeId
 * @param {Function} options.setContentAreaDragType - Setter for overlay type: 'external' | 'internal' | null
 * @param {Function} options.handleInternalFileDrop - (draggedNodeId, targetNodeId) => void for internal move
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
    isShareLinkMode: _isShareLinkMode,
    currentNodeId,
    contentAreaDraggedNodeId,
    contentAreaDraggedParentNodeId,
    setContentAreaDraggedNodeId,
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

  const isSameParentSkip = useCallback(
    (isInternalTree) =>
      isInternalTree &&
      contentAreaDraggedNodeId != null &&
      contentAreaDraggedParentNodeId != null &&
      contentAreaDraggedParentNodeId === currentNodeId,
    [contentAreaDraggedNodeId, contentAreaDraggedParentNodeId, currentNodeId]
  );

  const handleContentAreaDragEnter = useCallback(
    (e) => {
      if (isMobile || selectionMode || !hasWritePermission) return;

      const { isExternal, isInternalTree } = getDragTypes(e);
      if (isSameParentSkip(isInternalTree)) {
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
      isSameParentSkip,
      setContentAreaDragType,
      handleFileAreaDragEnter,
    ]
  );

  const handleContentAreaDragOver = useCallback(
    (e) => {
      if (isMobile || selectionMode || !hasWritePermission) return;

      const { isExternal, isInternalTree } = getDragTypes(e);
      if (isSameParentSkip(isInternalTree)) {
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
      isSameParentSkip,
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
      const internalNodeIdText = types.includes('text/plain')
        ? e.dataTransfer?.getData?.('text/plain')
        : null;

      setContentAreaDraggedNodeId(null);
      setContentAreaDragType(null);

      if (internalNodeIdText) {
        e.preventDefault();
        e.stopPropagation();
        resetFileAreaDrag?.();
        const draggedNodeId = Number(internalNodeIdText);
        if (!Number.isFinite(draggedNodeId)) return;
        if (contentAreaDraggedParentNodeId === currentNodeId) return;
        handleInternalFileDrop(draggedNodeId, currentNodeId);
        return;
      }

      if (isExternal) {
        handleFileAreaDrop(e, currentNodeId, handleExplorerDrop);
      }
    },
    [
      isMobile,
      selectionMode,
      hasWritePermission,
      setContentAreaDraggedNodeId,
      setContentAreaDragType,
      resetFileAreaDrag,
      handleInternalFileDrop,
      currentNodeId,
      contentAreaDraggedParentNodeId,
      handleFileAreaDrop,
      handleExplorerDrop,
    ]
  );

  return useMemo(
    () => ({
      handleContentAreaDragEnter,
      handleContentAreaDragOver,
      handleContentAreaDragLeave,
      handleContentAreaDrop,
    }),
    [
      handleContentAreaDragEnter,
      handleContentAreaDragOver,
      handleContentAreaDragLeave,
      handleContentAreaDrop,
    ]
  );
}
