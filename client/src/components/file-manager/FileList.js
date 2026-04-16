import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from './hooks/useFileViewCommon';
import { useLongPressSelect } from './hooks/useLongPressSelect';
import { useResponsive } from '../../hooks/useResponsive';
import { FileListSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import FileListItem, { getFileListItemContainerStyles } from './FileListItem';

const FileList = ({ files, onFileClick, onMoreClick, showMoreButton, onLongPressSelect, onContextMenu, onFileDrop, onDropPermissionDenied, onDragStart, onDragEnd, internalDraggedPath, selectionMode, selectedFiles, onFileCheck, processingMap, currentPath, onPathClick, loading = false, onThumbnailsLoaded, loadMoreRef, hasMore, shareToken }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
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
    return <FileListSkeleton selectionMode={selectionMode} />;
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
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))',
        gap: 2,
      }}
    >
      {files.map((file, index) => {
        const fileState = getFileState(file);
        const { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } = fileState;
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        const longPressHandlers = getLongPressHandlers(file);
        const allowContextMenu = isPermissionDisabled && !isProcessing;
        const canOpenMenu = !isDisabled || allowContextMenu;

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
      })}
      {hasMore && (
        <Box
          ref={loadMoreRef}
          sx={{
            height: 20,
            gridColumn: '1 / -1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        />
      )}
    </Box>
  );
};

export default FileList;
