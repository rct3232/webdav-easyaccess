import React from 'react';
import {
  DriveFileMove as MoveIcon,
  ContentCopy as CopyIcon,
  Delete as DeleteIcon,
} from '@mui/icons-material';

/**
 * Consistent entry key for selection/processing state.
 * Uses file.nodeId when available (authoritative identity) and falls back to
 * file.path ONLY for entries that lack a nodeId (synthetic /__recent__ entries).
 * @param {Object} file - File object
 * @returns {number|string} nodeId when present, otherwise path
 */
export const getEntryKey = (file) => (file?.nodeId != null ? file.nodeId : file?.path);

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
 * @param {Set} selectedFiles - Set of selected entry keys (file.nodeId, path fallback)
 * @param {Map} processingMap - Map of file nodeIds to processing types
 * @returns {Object} State object with isSelected, isDisabled, isProcessing, processingType
 */
export const getFileItemState = (file, selectionMode, selectedFiles, processingMap) => {
  const isSelected = Boolean(
    selectionMode && selectedFiles && selectedFiles.has(getEntryKey(file))
  );

  // Directory permission check (files are always accessible)
  const isPermissionDisabled = file.type === 'directory' && file.hasReadPermission === false;

  const processingType = processingMap?.get(file.nodeId);
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
