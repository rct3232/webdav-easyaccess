import React, { useRef, useCallback } from 'react';
import {
  Typography,
  Box,
  Checkbox,
  Avatar,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { formatFileSize, formatDate } from '../utils/format';
import { useFileViewCommon } from '../hooks/useFileViewCommon';
import { renderProcessingIcon, getDropTargetStyles } from '../utils/fileViewUtils';
import { getFileIcon, getThumbnail } from '../utils/fileIconUtils';
import { useResponsive } from '../hooks/useResponsive';
import { FileListSkeleton } from './FileSkeletons';
import { useThumbnailLazyLoad } from '../hooks/useThumbnailLazyLoad';

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, currentPath, onPathClick, loading = false, onThumbnailsLoaded }) => {
  const { isMobile } = useResponsive();
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
      if (e.cancelable) e.preventDefault();
      touchMovedRef.current.set(file.path, false);
      const timer = setTimeout(() => {
        if (!touchMovedRef.current.get(file.path)) {
          if (navigator.vibrate) navigator.vibrate(50);
          onContextMenu(e, file);
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
      {files.map((file, index) => {
        const { isSelected: checked, isDisabled, isProcessing, processingType, isPermissionDisabled } = getFileState(file);
        const allowContextMenu = isPermissionDisabled && !isProcessing;
        const canOpenMenu = !isDisabled || allowContextMenu;
        const thumbnail = getThumbnail(file);
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        const longPressHandlers = getLongPressHandlers(file, canOpenMenu);
        
        return (
          <Box
            key={index}
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
              '&:hover': {
                backgroundColor: isDisabled ? 'transparent' : 'action.hover',
              },
              backgroundColor: dropTarget === file.path ? 'primary.main' : 'transparent',
              opacity: draggedFile?.path === file.path ? 0.5 : (isDisabled ? 0.4 : 1),
              cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
              transition: 'all 0.2s',
              color: isDisabled ? 'text.disabled' : (dropTarget === file.path ? 'white' : 'inherit'),
              position: 'relative',
              ...getDropTargetStyles(dropTarget === file.path),
              // Prevent text selection on mobile long-press
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
            {selectionMode && (
              <Box sx={{ minWidth: 40, display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  checked={checked}
                  onChange={(e) => handleCheck(file, e.target.checked, e)}
                  onClick={(e) => e.stopPropagation()}
                />
              </Box>
            )}
            <Box sx={{ minWidth: 56, display: 'flex', justifyContent: 'center', mr: 2 }}>
              {thumbnail ? (
                <Avatar
                  src={thumbnail}
                  alt={file.basename}
                  variant="rounded"
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: 'grey.200',
                  }}
                />
              ) : (
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 40, height: 40 }}>
                  {getFileIcon(file)}
                </Box>
              )}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" noWrap>
                {file.basename}
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  {file.type === 'directory' ? '폴더' : formatFileSize(file.size)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatDate(file.lastmod)}
                </Typography>
              </Box>
            </Box>
            {isProcessing && (
              <Box
                sx={{
                  position: 'absolute',
                  top: '50%',
                  right: 16,
                  transform: 'translateY(-50%)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  pointerEvents: 'none',
                }}
              >
                <CircularProgress size={18} thickness={5} />
                {renderProcessingIcon(processingType)}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default FileList;
