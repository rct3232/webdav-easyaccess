import React, { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from './hooks/useFileViewCommon';
import { useLongPressSelect } from './hooks/useLongPressSelect';
import { useResponsive } from '../../hooks/useResponsive';
import { FileGridSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import FileGridItem from './FileGridItem';

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

  const { getLongPressHandlers } = useLongPressSelect({ isMobile, selectionMode, onLongPressSelect });

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
        const allowContextMenu = isPermissionDisabled && !isProcessing;
        const canOpenMenu = !isDisabled || allowContextMenu;
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        const longPressHandlers = getLongPressHandlers(file);

        return (
          <Box
            key={file.path}
            data-file-path={file.path}
            {...dragHandlers}
            {...dropHandlers}
            {...longPressHandlers}
            onClick={(e) => {
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
