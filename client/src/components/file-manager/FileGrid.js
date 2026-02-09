import React, { useRef, useCallback, useEffect } from 'react';
import {
  Grid,
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from '../../hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { FileGridSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import FileGridItem from './FileGridItem';

const FileGrid = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, hasWritePermission, currentPath, onPathClick, loading = false, onThumbnailsLoaded, loadMoreRef, hasMore }) => {
  const { isMobile } = useResponsive();
  const gridRef = useRef(null);
  const theme = useTheme();
  const longPressTimersRef = useRef(new Map());
  const touchMovedRef = useRef(new Map());
  
  // 썸네일 레이지 로딩
  useThumbnailLazyLoad(files, onThumbnailsLoaded);
  
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
    return <FileGridSkeleton selectionMode={selectionMode} />;
  }

  if (files.length === 0) {
    return (
      <Box sx={{ textAlign: 'center', py: 4 }}>
        <Typography color="text.secondary">파일이 없습니다</Typography>
      </Box>
    );
  }

  return (
    <Grid 
      container 
      spacing={isMobile ? 1.5 : 2}
      ref={gridRef}
      sx={{
        position: 'relative',
        minHeight: 'auto',
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
          <Grid item xs={6} sm={4} md={3} lg={2} xl={2} key={file.path}>
            <Box
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
              sx={{ height: '100%' }}
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
                isMobile={isMobile}
                onCheck={handleCheck}
              />
            </Box>
          </Grid>
        );
      })}
      {hasMore && (
        <Grid item xs={12}>
          <Box
            ref={loadMoreRef}
            sx={{
              height: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          />
        </Grid>
      )}
    </Grid>
  );
};

export default FileGrid;
