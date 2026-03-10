import React, { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from '../../hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { FileListSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import FileListItem, { getFileListItemContainerStyles } from './FileListItem';

const FileList = ({ files, onFileClick, onMoreClick, showMoreButton, onLongPressSelect, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, currentPath, onPathClick, loading = false, onThumbnailsLoaded, loadMoreRef, hasMore, shareToken }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const theme = useTheme();
  const longPressTimersRef = useRef(new Map());
  const touchMovedRef = useRef(new Map());
  
  // 썸네일 레이지 로딩
  useThumbnailLazyLoad(files, onThumbnailsLoaded, shareToken != null ? { shareToken } : {});
  
  const {
    draggedFile,
    dropTarget,
    getFileState,
    getDragHandlers,
    getDropHandlers,
  } = useFileViewCommon({
    onFileDrop,
    selectionMode,
    selectedFiles,
    onFileCheck,
    processingMap,
    theme,
    isMobile,
  });

  // Long-press handlers: mobile long-press enters selection mode and selects file (not context menu)
  const getLongPressHandlers = useCallback((file) => {
    if (!isMobile || selectionMode || !onLongPressSelect) return {};

    const handleTouchStart = () => {
      touchMovedRef.current.set(file.path, false);
      const timer = setTimeout(() => {
        if (!touchMovedRef.current.get(file.path)) {
          if (navigator.vibrate) navigator.vibrate(50);
          onLongPressSelect(file);
        }
      }, 500);
      longPressTimersRef.current.set(file.path, timer);
    };

    const handleTouchEnd = () => {
      const timer = longPressTimersRef.current.get(file.path);
      if (timer) {
        clearTimeout(timer);
        longPressTimersRef.current.delete(file.path);
      }
    };

    const handleTouchMove = () => {
      touchMovedRef.current.set(file.path, true);
      const timer = longPressTimersRef.current.get(file.path);
      if (timer) {
        clearTimeout(timer);
        longPressTimersRef.current.delete(file.path);
      }
    };

    return {
      onTouchStart: handleTouchStart,
      onTouchEnd: handleTouchEnd,
      onTouchMove: handleTouchMove,
    };
  }, [isMobile, selectionMode, onLongPressSelect]);

  // 컴포넌트 언마운트 시 모든 타이머 정리
  useEffect(() => {
    const timers = longPressTimersRef.current;
    const touchMoved = touchMovedRef.current;
    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      touchMoved.clear();
    };
  }, []);

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
        const { isSelected, isDisabled, isProcessing, processingType } = getFileState(file);
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
              const allowContextMenu = getFileState(file).isPermissionDisabled && !getFileState(file).isProcessing;
              const canOpenMenu = !isDisabled || allowContextMenu;
              if (canOpenMenu) {
                onContextMenu(e, file);
              }
            }}
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
