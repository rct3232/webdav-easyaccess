import { useCallback, useRef, useEffect } from 'react';
import { useDragAndDrop } from '../../../hooks/useDragAndDrop';
import { getFileItemState, getEntryKey } from '../../../utils/fileViewUtils';

// Reusable empty drag/drop handler objects to preserve reference identity.
const emptyDragHandlers = {
  draggable: false,
  onDragStart: undefined,
  onDragEnd: undefined,
};

const emptyDropHandlers = {
  onDragOver: undefined,
  onDragLeave: undefined,
  onDrop: undefined,
};

/**
 * Common hook for file view components
 * Provides shared logic for file list, grid, and detail views
 * 
 * @param {Object} options - Hook options
 * @param {Function} options.onFileDrop - Callback for file drop
 * @param {Function} options.onDropPermissionDenied - Callback when drop target has no write permission (destinationPath) => void
 * @param {Function} options.onDragStart - Callback when drag starts (path) => void
 * @param {Function} options.onDragEnd - Callback when drag ends () => void
 * @param {boolean} options.selectionMode - Whether selection mode is active
 * @param {Set} options.selectedFiles - Set of selected entry keys (file.nodeId, path fallback)
 * @param {Function} options.onFileCheck - Callback for file check
 * @param {Map} options.processingMap - Map of file nodeIds to processing types
 * @param {Object} options.theme - MUI theme object
 * @param {boolean} options.isMobile - Whether the device is mobile
 * @returns {Object} Common view logic and handlers
 */
export const useFileViewCommon = ({
  onFileDrop,
  onDropPermissionDenied,
  onDragStart,
  onDragEnd,
  internalDraggedNodeId,
  selectionMode,
  selectedFiles,
  onFileCheck,
  processingMap,
  theme,
  isMobile = false,
}) => {
  // ref로 관리하여 useCallback 의존성에서 제거 (리렌더링 방지)
  const selectionModeRef = useRef(selectionMode);
  const isMobileRef = useRef(isMobile);
  
  useEffect(() => {
    selectionModeRef.current = selectionMode;
  }, [selectionMode]);
  
  useEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);
  
  const dragAndDrop = useDragAndDrop(
    onFileDrop,
    selectionMode,
    theme,
    onDropPermissionDenied,
    onDragStart,
    onDragEnd,
    internalDraggedNodeId
  );
  
  /**
   * Get file state for rendering
   */
  const getFileState = useCallback((file) => {
    return getFileItemState(file, selectionMode, selectedFiles, processingMap);
  }, [selectionMode, selectedFiles, processingMap]);
  
  /**
   * Handle file check (selection)
   */
  const handleFileCheck = useCallback((file, checked, event) => {
    event?.stopPropagation();
    if (onFileCheck) {
      onFileCheck(file, checked);
    }
  }, [onFileCheck]);
  
  /**
   * Check if file is selected
   */
  const isSelected = useCallback((file) => {
    return selectedFiles && selectedFiles.has(getEntryKey(file));
  }, [selectedFiles]);
  
  /**
   * Get drag handlers for a file
   * ref 사용으로 selectionMode/isMobile 변경 시 함수 재생성 방지
   */
  const getDragHandlers = useCallback((file, isDisabled) => {
    if (isMobileRef.current || selectionModeRef.current || isDisabled || file.hasWritePermission === false) {
      return emptyDragHandlers;
    }

    return {
      draggable: true,
      onDragStart: (e) => dragAndDrop.handleDragStart(e, file),
      onDragEnd: dragAndDrop.handleDragEnd,
    };
  }, [dragAndDrop]);
  
  /**
   * Get drop handlers for a file
   * ref 사용으로 selectionMode/isMobile 변경 시 함수 재생성 방지
   */
  const getDropHandlers = useCallback((file, isDisabled) => {
    if (isMobileRef.current || selectionModeRef.current || isDisabled) {
      return emptyDropHandlers;
    }
    
    return {
      onDragOver: (e) => dragAndDrop.handleDragOver(e, file),
      onDragLeave: dragAndDrop.handleDragLeave,
      onDrop: (e) => dragAndDrop.handleDrop(e, file),
    };
  }, [dragAndDrop]);
  
  return {
    ...dragAndDrop,
    getFileState,
    handleFileCheck,
    isSelected,
    getDragHandlers,
    getDropHandlers,
  };
};
