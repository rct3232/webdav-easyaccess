import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from './hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { FileListSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import { getEntryKey } from '../../utils/fileViewUtils';
import FileItem from './FileItem';

const FileList = ({ files, onFileClick, onMoreClick, showMoreButton, onLongPressSelect, onContextMenu, onFileDrop, onDropPermissionDenied, onDragStart, onDragEnd, internalDraggedNodeId, selectionMode, selectedFiles, onFileCheck, processingMap, loading = false, onThumbnailsLoaded, loadMoreRef, hasMore, shareToken }) => {
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
    internalDraggedNodeId,
    selectionMode,
    selectedFiles,
    onFileCheck,
    processingMap,
    theme,
    isMobile,
  });

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
        const isDragging = draggedFile?.nodeId != null && getEntryKey(draggedFile) === getEntryKey(file);
        const isDropTarget = dropTarget != null && String(dropTarget) === String(getEntryKey(file));
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);

        return (
          <FileItem
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
            dragHandlers={dragHandlers}
            dropHandlers={dropHandlers}
          />
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
