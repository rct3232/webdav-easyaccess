import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from './hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { FileGridSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import FileGridItemContainer from './FileGridItemContainer';

const FileGrid = ({ files, onFileClick, onMoreClick, showMoreButton, onLongPressSelect, onContextMenu, onFileDrop, onDropPermissionDenied, onDragStart, onDragEnd, internalDraggedPath, selectionMode, selectedFiles, onFileCheck, processingMap, hasWritePermission, currentPath, onPathClick, loading = false, onThumbnailsLoaded, loadMoreRef, hasMore, shareToken }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const gridRef = useRef(null);
  const theme = useTheme();

  useThumbnailLazyLoad(files, onThumbnailsLoaded, shareToken != null ? { shareToken } : {});

  const {
    draggedFile,
    dropTarget,
    getFileState,
    getDragHandlers,
    getDropHandlers,
  } = useFileViewCommon({
    onFileDrop,
    onDropPermissionDenied,
    onDragStart,
    onDragEnd,
    internalDraggedPath,
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
        <Typography color="text.secondary">{t('fileManager.noFiles')}</Typography>
      </Box>
    );
  }

  return (
    <Box
      ref={gridRef}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          sm: 'repeat(3, 1fr)',
          md: 'repeat(4, 1fr)',
          lg: 'repeat(6, 1fr)',
          xl: 'repeat(auto-fill, minmax(150px, 1fr))',
        },
        gap: { xs: 1.5, md: 2 },
        position: 'relative',
        minHeight: 'auto',
      }}
    >
      {files.map((file, index) => {
        const { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } = getFileState(file);
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);

        return (
          <FileGridItemContainer
            key={file.path}
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
            dragHandlers={dragHandlers}
            dropHandlers={dropHandlers}
          />
        );
      })}
      {hasMore && (
        <Box
          ref={loadMoreRef}
          sx={{
            gridColumn: '1 / -1',
            height: 20,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      )}
    </Box>
  );
};

export default FileGrid;
