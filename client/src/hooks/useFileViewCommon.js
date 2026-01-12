import { useCallback } from 'react';
import { useDragAndDrop } from './useDragAndDrop';
import { getFileItemState } from '../utils/fileViewUtils';

/**
 * Common hook for file view components
 * Provides shared logic for file list, grid, and detail views
 * 
 * @param {Object} options - Hook options
 * @param {Function} options.onFileDrop - Callback for file drop
 * @param {boolean} options.selectionMode - Whether selection mode is active
 * @param {Set} options.selectedFiles - Set of selected file paths
 * @param {Function} options.onFileCheck - Callback for file check
 * @param {Map} options.processingMap - Map of file paths to processing types
 * @param {Object} options.theme - MUI theme object
 * @returns {Object} Common view logic and handlers
 */
export const useFileViewCommon = ({
  onFileDrop,
  selectionMode,
  selectedFiles,
  onFileCheck,
  processingMap,
  theme,
}) => {
  const dragAndDrop = useDragAndDrop(onFileDrop, selectionMode, theme);
  
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
    return selectedFiles && selectedFiles.has(file.path);
  }, [selectedFiles]);
  
  /**
   * Get drag handlers for a file
   */
  const getDragHandlers = useCallback((file, isDisabled) => {
    if (selectionMode || isDisabled) {
      return {
        draggable: false,
        onDragStart: undefined,
        onDragEnd: undefined,
      };
    }
    
    return {
      draggable: true,
      onDragStart: (e) => dragAndDrop.handleDragStart(e, file),
      onDragEnd: dragAndDrop.handleDragEnd,
    };
  }, [selectionMode, dragAndDrop]);
  
  /**
   * Get drop handlers for a file
   */
  const getDropHandlers = useCallback((file, isDisabled) => {
    if (selectionMode || isDisabled) {
      return {
        onDragOver: undefined,
        onDragLeave: undefined,
        onDrop: undefined,
      };
    }
    
    return {
      onDragOver: (e) => dragAndDrop.handleDragOver(e, file),
      onDragLeave: dragAndDrop.handleDragLeave,
      onDrop: (e) => dragAndDrop.handleDrop(e, file),
    };
  }, [selectionMode, dragAndDrop]);
  
  return {
    ...dragAndDrop,
    getFileState,
    handleFileCheck,
    isSelected,
    getDragHandlers,
    getDropHandlers,
  };
};

