import { useState } from 'react';
import { setupDragGhost } from '../utils/dragGhostImage';

export const useDragAndDrop = (onFileDrop, selectionMode, theme) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);

  const handleDragStart = (e, file) => {
    if (selectionMode) return;
    setDraggedFile(file);
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
  };

  const handleDragOver = (e, file) => {
    if (selectionMode) return;
    if (file.type === 'directory' && draggedFile?.path !== file.path) {
      e.preventDefault();
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
    
    if (draggedFile && targetFolder.type === 'directory' && draggedFile.path !== targetFolder.path) {
      onFileDrop?.(draggedFile, targetFolder);
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

