import { useState } from 'react';
import { setupDragGhost } from '../utils/dragGhostImage';

export const useDragAndDrop = (
  onFileDrop,
  selectionMode,
  theme,
  onDropPermissionDenied,
  onDragStart,
  onDragEnd,
  internalDraggedNodeId
) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragStart = (e, file) => {
    if (selectionMode) return;
    setDraggedFile(file);
    onDragStart?.(file.nodeId);
    // In real browsers `dataTransfer` always exists; in tests it may be missing.
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(file.nodeId));
    }

    // Set custom drag ghost image if theme is available
    if (theme && e?.dataTransfer) {
      setupDragGhost(e, file, theme, 1);
    }
  };

  const handleDragEnd = () => {
    setDraggedFile(null);
    setDropTarget(null);
    onDragEnd?.();
  };

  const handleDragOver = (e, file) => {
    if (selectionMode) return;
    const fromList = draggedFile?.nodeId != null && draggedFile.nodeId !== file.nodeId;
    const fromTree = !draggedFile && e?.dataTransfer?.types?.includes('text/plain');
    const canDropOnFolder = file.type === 'directory' && (fromList || fromTree);
    if (canDropOnFolder) {
      e.preventDefault();
      if (e?.dataTransfer)
        e.dataTransfer.dropEffect = file.hasWritePermission === false ? 'none' : 'move';
      if (file.hasWritePermission === false) return;
      // No-op move: target is the parent of the dragged nodeId (item already lives there)
      const listNoOp = fromList && draggedFile.parentNodeId === file.nodeId;
      if (listNoOp) return;
      // Tree-origin no-op: target equals tree nodeId (drop on self)
      const treeNodeId = e?.dataTransfer?.getData?.('text/plain');
      const effectiveTreeNodeId = treeNodeId || internalDraggedNodeId;
      const treeNoOp =
        fromTree &&
        effectiveTreeNodeId != null &&
        String(effectiveTreeNodeId) === String(file.nodeId);
      if (treeNoOp) return;
      setDropTarget(file.nodeId);
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e, targetFolder) => {
    if (selectionMode) return;
    e.preventDefault();
    e.stopPropagation();

    if (targetFolder.hasWritePermission === false) {
      onDropPermissionDenied?.(targetFolder.nodeId);
      setDraggedFile(null);
      setDropTarget(null);
      return;
    }

    // List no-op: target is parent of dragged nodeId (same folder)
    if (
      draggedFile &&
      targetFolder.type === 'directory' &&
      draggedFile.parentNodeId === targetFolder.nodeId
    ) {
      setDraggedFile(null);
      setDropTarget(null);
      return;
    }
    // Tree no-op: tree nodeId equals target (drop on self)
    const treeNodeId = !draggedFile ? e?.dataTransfer?.getData?.('text/plain') : null;
    const effectiveTreeNodeId = treeNodeId || (!draggedFile ? internalDraggedNodeId : null);
    if (
      effectiveTreeNodeId != null &&
      targetFolder.type === 'directory' &&
      String(effectiveTreeNodeId) === String(targetFolder.nodeId)
    ) {
      setDraggedFile(null);
      setDropTarget(null);
      return;
    }

    const fromList =
      draggedFile &&
      targetFolder.type === 'directory' &&
      draggedFile.nodeId !== targetFolder.nodeId;
    const fromTree =
      effectiveTreeNodeId != null &&
      targetFolder.type === 'directory' &&
      String(effectiveTreeNodeId) !== String(targetFolder.nodeId);

    if (fromList) {
      onFileDrop?.(draggedFile, targetFolder);
    } else if (fromTree) {
      onFileDrop?.({ nodeId: Number(effectiveTreeNodeId) }, targetFolder);
    }

    setDraggedFile(null);
    setDropTarget(null);
  };

  return {
    draggedFile,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  };
};
