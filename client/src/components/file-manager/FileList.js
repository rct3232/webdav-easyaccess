import React, { useRef, useCallback, useEffect } from 'react';
import {
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from '../../hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { FileListSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import FileListItem from './FileListItem';

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, currentPath, onPathClick, loading = false, onThumbnailsLoaded, loadMoreRef, hasMore, shareToken }) => {
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
    handleFileCheck: handleCheck,
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

  // Long-press handlers using useLongPress pattern
  const getLongPressHandlers = useCallback((file, canOpenMenu) => {
    if (!isMobile || selectionMode) return {};
    
    const handleTouchStart = (e) => {
      touchMovedRef.current.set(file.path, false);
      
      // 터치 이벤트에서 좌표 추출 (touches 배열 사용)
      const touch = e.touches?.[0] || e.changedTouches?.[0] || {};
      const syntheticEvent = {
        clientX: touch.clientX,
        clientY: touch.clientY,
        pageX: touch.pageX,
        pageY: touch.pageY,
        target: e.target,
        currentTarget: e.currentTarget,
        cancelable: false,
        preventDefault: () => {},
      };
      
      const timer = setTimeout(() => {
        if (!touchMovedRef.current.get(file.path)) {
          if (navigator.vibrate) navigator.vibrate(50);
          onContextMenu(syntheticEvent, file);
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
  }, [isMobile, selectionMode, onContextMenu]);

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
        <Typography color="text.secondary">파일이 없습니다</Typography>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 2,
      }}
    >
      {files.map((file) => {
        const { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } = getFileState(file);
        const allowContextMenu = isPermissionDisabled && !isProcessing;
        const canOpenMenu = !isDisabled || allowContextMenu;
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        const longPressHandlers = getLongPressHandlers(file, canOpenMenu);
        
        return (
          <Box
            key={file.path}
            data-file-path={file.path}
            {...dragHandlers}
            {...dropHandlers}
            {...longPressHandlers}
            onClick={() => {
              if (!isDisabled) {
                onFileClick(file);
              }
            }}
            onContextMenu={(e) => {
              if (canOpenMenu) {
                onContextMenu(e, file);
              }
            }}
            sx={{
              display: 'flex',
              alignItems: 'center',
              p: 1.5,
              borderRadius: 1,
              transition: 'all 0.2s',
              position: 'relative',
              '&:hover': {
                backgroundColor: isDisabled ? 'transparent' : 'action.hover',
              },
              backgroundColor: isDropTarget ? 'primary.main' : 'transparent',
              opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : (file.isHidden ? 0.5 : 1)),
              cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
              color: isDisabled ? 'text.disabled' : (isDropTarget ? 'white' : 'inherit'),
              ...(isMobile && {
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                WebkitTouchCallout: 'none',
                touchAction: 'manipulation',
              }),
            }}
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
              isMobile={isMobile}
              onCheck={handleCheck}
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
