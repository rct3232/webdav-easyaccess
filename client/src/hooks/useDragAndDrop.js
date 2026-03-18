import { useState } from 'react';
import { setupDragGhost } from '../utils/dragGhostImage';
import { getParentPath } from '../utils/pathUtils';

export const useDragAndDrop = (onFileDrop, selectionMode, theme, onDropPermissionDenied, onDragStart, onDragEnd) => {
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
      if (file.hasWritePermission === false) {
        if (e?.dataTransfer) {
          e.dataTransfer.dropEffect = 'none';
        }
        return;
      }
      // No-op move: target is the parent of the dragged path (item already lives there)
      if (fromList && getParentPath(draggedFile.path) === file.path) {
        return;
      }
      if (e?.dataTransfer) {
        e.dataTransfer.dropEffect = 'move';
      }
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

    const fromList = draggedFile && targetFolder.type === 'directory' && draggedFile.path !== targetFolder.path;
    const treePath = !draggedFile ? e?.dataTransfer?.getData?.('text/plain') : null;
    const fromTree = treePath && targetFolder.type === 'directory' && treePath !== targetFolder.path;

    if (fromList) {
      onFileDrop?.(draggedFile, targetFolder);
    } else if (fromTree) {
      onFileDrop?.({ path: treePath }, targetFolder);
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

