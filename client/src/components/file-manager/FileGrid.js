import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Typography, Box, useTheme } from '@mui/material';
import { useFileViewCommon } from './hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { FileGridSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import { getEntryKey } from '../../utils/fileViewUtils';
import FileGridItemContainer from './FileGridItemContainer';
import ResponsiveCardGrid, { CardGridSpan } from './ResponsiveCardGrid';

const FileGrid = ({
  files,
  onFileClick,
  onMoreClick,
  showMoreButton,
  onLongPressSelect,
  onContextMenu,
  onFileDrop,
  onDropPermissionDenied,
  onDragStart,
  onDragEnd,
  internalDraggedNodeId,
  selectionMode,
  selectedFiles,
  onFileCheck,
  processingMap,
  loading = false,
  onThumbnailsLoaded,
  loadMoreRef,
  hasMore,
  shareToken,
  emptyText,
  membershipsByNodeId = null,
}) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const gridRef = useRef(null);
  const theme = useTheme();

  useThumbnailLazyLoad(files, onThumbnailsLoaded, shareToken != null ? { shareToken } : {});

  const { draggedFile, dropTarget, getFileState, getDragHandlers, getDropHandlers } =
    useFileViewCommon({
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
      isMobile,
    });

  if (loading && files.length === 0) {
    return <FileGridSkeleton selectionMode={selectionMode} />;
  }

  if (files.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary">{emptyText ?? t('fileManager.noFiles')}</Typography>
      </Box>
    );
  }

  return (
    <ResponsiveCardGrid ref={gridRef}>
      {files.map((file, index) => {
        const { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } =
          getFileState(file);
        const isDragging =
          draggedFile?.nodeId != null && getEntryKey(draggedFile) === getEntryKey(file);
        const isDropTarget = dropTarget != null && String(dropTarget) === String(getEntryKey(file));
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);

        return (
          <FileGridItemContainer
            key={getEntryKey(file)}
            file={file}
            index={index}
            onFileClick={onFileClick}
            onMoreClick={onMoreClick}
            showMoreButton={showMoreButton}
            onLongPressSelect={onLongPressSelect}
            onContextMenu={onContextMenu}
            isDisabled={isDisabled}
            isProcessing={isProcessing}
            processingType={processingType}
            isPermissionDisabled={isPermissionDisabled}
            isDragging={isDragging}
            isDropTarget={isDropTarget}
            isSelected={isSelected}
            selectionMode={selectionMode}
            isMobile={isMobile}
            memberships={membershipsByNodeId ? (membershipsByNodeId[file.nodeId] ?? null) : null}
            dragHandlers={dragHandlers}
            dropHandlers={dropHandlers}
          />
        );
      })}
      {hasMore && (
        <CardGridSpan
          ref={loadMoreRef}
          sx={{ height: 20, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        />
      )}
    </ResponsiveCardGrid>
  );
};

export default React.memo(FileGrid);
