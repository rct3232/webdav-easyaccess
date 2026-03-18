import { useState } from 'react';
import { setupDragGhost } from '../utils/dragGhostImage';
import { getParentPath } from '../utils/pathUtils';

export const useDragAndDrop = (
  onFileDrop,
  selectionMode,
  theme,
  onDropPermissionDenied,
  onDragStart,
  onDragEnd,
  internalDraggedPath
) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragStart = (e, file) => {
    if (selectionMode) return;
    setDraggedFile(file);
    onDragStart?.(file.path);
    // In real browsers `dataTransfer` always exists; in tests it may be missing.
    if (e?.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', file.path);
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
    const fromList = draggedFile?.path && draggedFile.path !== file.path;
    const fromTree = !draggedFile && e?.dataTransfer?.types?.includes('text/plain');
    const canDropOnFolder = file.type === 'directory' && (fromList || fromTree);
    if (canDropOnFolder) {
      e.preventDefault();
      if (e?.dataTransfer) e.dataTransfer.dropEffect = file.hasWritePermission === false ? 'none' : 'move';
      if (file.hasWritePermission === false) return;
      // No-op move: target is the parent of the dragged path (item already lives there)
      const listNoOp = fromList && getParentPath(draggedFile.path) === file.path;
      if (listNoOp) return;
      // Tree-origin no-op: target is parent of tree path or tree path equals target (drop on self)
      const treePath = e?.dataTransfer?.getData?.('text/plain');
      const effectiveTreePath = treePath || internalDraggedPath;
      const treeNoOp =
        fromTree &&
        effectiveTreePath &&
        (getParentPath(effectiveTreePath) === file.path || effectiveTreePath === file.path);
      if (treeNoOp) return;
      setDropTarget(file.path);
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
      onDropPermissionDenied?.(targetFolder.path);
      setDraggedFile(null);
      setDropTarget(null);
      return;
    }

    // List no-op: target is parent of dragged path (same folder)
    if (draggedFile && targetFolder.type === 'directory' && getParentPath(draggedFile.path) === targetFolder.path) {
      setDraggedFile(null);
      setDropTarget(null);
      return;
    }
    // Tree no-op: target is parent of tree path or tree path equals target (drop on self)
    const treePath = !draggedFile ? e?.dataTransfer?.getData?.('text/plain') : null;
    const effectiveTreePath = treePath || (!draggedFile ? internalDraggedPath : null);
    if (
      effectiveTreePath &&
      targetFolder.type === 'directory' &&
      (getParentPath(effectiveTreePath) === targetFolder.path || effectiveTreePath === targetFolder.path)
    ) {
      setDraggedFile(null);
      setDropTarget(null);
      return;
    }

    const fromList = draggedFile && targetFolder.type === 'directory' && draggedFile.path !== targetFolder.path;
    const fromTree = effectiveTreePath && targetFolder.type === 'directory' && effectiveTreePath !== targetFolder.path;

    if (fromList) {
      onFileDrop?.(draggedFile, targetFolder);
    } else if (fromTree) {
      onFileDrop?.({ path: effectiveTreePath }, targetFolder);
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

