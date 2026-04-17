import React from 'react';
import { Box } from '@mui/material';
import { useLongPress } from '../../hooks/useLongPress';
import { useLongPressSelect } from './hooks/useLongPressSelect';
import FileGridItem from './FileGridItem';

const FileGridItemContainer = ({
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
  } = useLongPress((e) => {
    if (onLongPressCallback) {
      onLongPressCallback(file);
    }
  });

  const allowContextMenu = isPermissionDisabled && !isProcessing;
  const canOpenMenu = !isDisabled || allowContextMenu;

  return (
    <Box
      key={file.path}
      data-file-path={file.path}
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
      sx={{ height: '100%', minWidth: 0 }}
    >
      <FileGridItem
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

export default React.memo(FileGridItemContainer);
