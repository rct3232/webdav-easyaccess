import React from 'react';
import { Box } from '@mui/material';
import { useLongPress } from '../../hooks/useLongPress';
import { useLongPressSelect } from './hooks/useLongPressSelect';
import { getEntryKey } from '../../utils/fileViewUtils';
import FileListItem, { getFileListItemContainerStyles } from './FileListItem';

const FileItem = ({
  file,
  index,
  onFileClick,
  onMoreClick,
  showMoreButton,
  onLongPressSelect,
  onContextMenu,
  isDisabled,
  isProcessing,
  processingType,
  isPermissionDisabled,
  isDragging,
  isDropTarget,
  isSelected,
  selectionMode,
  isMobile,
  dragHandlers,
  dropHandlers,
}) => {
  const { isLongPressEnabled, onLongPressSelect: onLongPressCallback } = useLongPressSelect({
    isMobile,
    selectionMode,
    onLongPressSelect,
  });

  const {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    wasLongPress,
  } = useLongPress(() => {
    if (onLongPressCallback) {
      onLongPressCallback(file);
    }
  });

  const allowContextMenu = isPermissionDisabled && !isProcessing;
  const canOpenMenu = !isDisabled || allowContextMenu;

  return (
    <Box
      key={getEntryKey(file)}
      data-file-path={file.path}
      data-file-node-id={file.nodeId}
      {...dragHandlers}
      {...dropHandlers}
      {...(isLongPressEnabled ? {
        onTouchStart,
        onTouchEnd,
        onTouchMove,
        onMouseDown,
        onMouseUp,
        onMouseLeave,
      } : {})}
      onClick={(e) => {
        if (wasLongPress()) return;
        if (!isDisabled) {
          onFileClick(file, e, index);
        }
      }}
      onContextMenu={(e) => {
        if (canOpenMenu) {
          onContextMenu(e, file);
        }
      }}
      aria-selected={isSelected}
      sx={getFileListItemContainerStyles({
        isDisabled,
        isDropTarget,
        isDragging,
        isHidden: file.isHidden,
        isMobile,
        selectionMode,
        isSelected,
      })}
    >
      <FileListItem
        file={file}
        isSelected={isSelected}
        isDisabled={isDisabled}
        isProcessing={isProcessing}
        processingType={processingType}
        isDropTarget={isDropTarget}
        isDragging={isDragging}
        selectionMode={selectionMode}
        showMoreButton={showMoreButton ?? !selectionMode}
        onMoreClick={onMoreClick}
        isMobile={isMobile}
      />
    </Box>
  );
};

export default React.memo(FileItem);
