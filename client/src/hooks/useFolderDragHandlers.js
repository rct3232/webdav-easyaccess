import { useState, useCallback } from 'react';
import { useExplorerDragAndDrop } from './useExplorerDragAndDrop';

/**
 * 폴더 드래그앤드롭 핸들러를 위한 커스텀 훅
 * BaseFolderTreeItem과 SharedFolderTreeItem에서 공유되는 드래그 로직을 추출
 * 
 * @param {object} options - 옵션 객체
 * @param {string} options.path - 폴더 경로
 * @param {boolean} options.isDisabled - 비활성화 여부
 * @param {boolean} options.hasWritePermission - 쓰기 권한 여부
 * @param {function} options.onExplorerDrop - 드롭 핸들러
 * @returns {object} 드래그 핸들러 및 상태
 */
const useFolderDragHandlers = ({ 
  path, 
  isDisabled = false, 
  hasWritePermission = true, 
  onExplorerDrop 
}) => {
  const [isDropTarget, setIsDropTarget] = useState(false);
  
  const {
    isDraggingOver,
    handleDragEnter: baseDragEnter,
    handleDragOver: baseDragOver,
    handleDragLeave: baseDragLeave,
    handleDrop: baseDrop,
  } = useExplorerDragAndDrop();

  const handleFolderDragOver = useCallback((e) => {
    if (isDisabled || !hasWritePermission) return;
    const types = e.dataTransfer.types;
    if (types && types.includes('Files')) {
      baseDragOver(e);
      setIsDropTarget(true);
    }
  }, [isDisabled, hasWritePermission, baseDragOver]);

  const handleFolderDragEnter = useCallback((e) => {
    if (isDisabled || !hasWritePermission) return;
    const types = e.dataTransfer.types;
    if (types && types.includes('Files')) {
      baseDragEnter(e);
      setIsDropTarget(true);
    }
  }, [isDisabled, hasWritePermission, baseDragEnter]);

  const handleFolderDragLeave = useCallback((e) => {
    if (isDisabled || !hasWritePermission) return;
    const types = e.dataTransfer.types;
    if (types && types.includes('Files')) {
      baseDragLeave(e);
      setIsDropTarget(false);
    }
  }, [isDisabled, hasWritePermission, baseDragLeave]);

  const handleFolderDrop = useCallback((e) => {
    if (isDisabled || !hasWritePermission) return;
    const types = e.dataTransfer.types;
    if (types && types.includes('Files') && onExplorerDrop) {
      baseDrop(e, path, onExplorerDrop);
      setIsDropTarget(false);
    }
  }, [isDisabled, hasWritePermission, path, onExplorerDrop, baseDrop]);

  return {
    isDropTarget,
    isDraggingOver,
    setIsDropTarget,
    handleFolderDragOver,
    handleFolderDragEnter,
    handleFolderDragLeave,
    handleFolderDrop,
  };
};

export default useFolderDragHandlers;
