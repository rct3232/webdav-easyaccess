import React from 'react';
import { DriveFileMove as MoveIcon, ContentCopy as CopyIcon, Delete as DeleteIcon } from '@mui/icons-material';

/**
 * Render processing icon based on processing type
 * @param {string} processingType - Type of processing ('move', 'copy', 'delete')
 * @returns {JSX.Element|null} Icon component or null
 */
export const renderProcessingIcon = (processingType) => {
  if (processingType === 'move') return <MoveIcon fontSize="small" color="primary" />;
  if (processingType === 'copy') return <CopyIcon fontSize="small" color="primary" />;
  if (processingType === 'delete') return <DeleteIcon fontSize="small" color="primary" />;
  return null;
};

/**
 * Get file item state (selected, disabled, processing)
 * @param {Object} file - File object
 * @param {boolean} selectionMode - Whether selection mode is active
 * @param {Set} selectedFiles - Set of selected file paths
 * @param {Map} processingMap - Map of file paths to processing types
 * @returns {Object} State object with isSelected, isDisabled, isProcessing, processingType
 */
export const getFileItemState = (file, selectionMode, selectedFiles, processingMap) => {
  const isSelected = selectionMode && selectedFiles && selectedFiles.has(file.path);
  
  // Directory permission check (files are always accessible)
  const isPermissionDisabled = file.type === 'directory' && file.hasReadPermission === false;
  
  const processingType = processingMap?.get(file.path);
  const isProcessing = Boolean(processingType);
  const isDisabled = isPermissionDisabled || isProcessing;
  
  return {
    isSelected,
    isDisabled,
    isProcessing,
    processingType,
    isPermissionDisabled,
  };
};

/**
 * Common styles for drop target
 * @param {boolean} isDropTarget - Whether this is a drop target
 * @returns {Object} MUI sx style object
 */
export const getDropTargetStyles = (isDropTarget) => {
  if (!isDropTarget) return {};
  
  return {
    backgroundColor: 'primary.main',
    color: 'white',
    '& .MuiAvatar-root': {
      filter: 'brightness(0) invert(1)',
    },
    '& .MuiSvgIcon-root': {
      color: 'white',
    },
    '& .MuiTypography-root': {
      color: 'white',
    },
  };
};
