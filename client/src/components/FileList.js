import React, { useRef } from 'react';
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

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, currentPath, onPathClick }) => {
  const { isMobile } = useResponsive();
  const theme = useTheme();
  const longPressTimerRef = useRef(null);
  const touchMovedRef = useRef(false);
  
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

  // Long-press handlers for mobile
  const handleTouchStart = (file) => (e) => {
    if (!isMobile || selectionMode) return;
    // Prevent text selection on long press
    e.preventDefault();
    touchMovedRef.current = false;
    longPressTimerRef.current = setTimeout(() => {
      if (!touchMovedRef.current) {
        // Haptic feedback
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
        onContextMenu(e, file);
      }
    }, 500);
  };

  const handleTouchEnd = (e) => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleTouchMove = (e) => {
    touchMovedRef.current = true;
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 2,
      }}
    >
      {files.map((file, index) => {
        const { isSelected: checked, isDisabled, isProcessing, processingType } = getFileState(file);
        const thumbnail = getThumbnail(file);
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        
        return (
          <Box
            key={index}
            {...dragHandlers}
            {...dropHandlers}
            onTouchStart={isMobile ? handleTouchStart(file) : undefined}
            onTouchEnd={isMobile ? handleTouchEnd : undefined}
            onTouchMove={isMobile ? handleTouchMove : undefined}
            onClick={() => {
              if (!isDisabled) {
                onFileClick(file);
              }
            }}
            onContextMenu={(e) => {
              if (!isDisabled) {
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
      {files.length === 0 && (
        <Box sx={{ gridColumn: '1 / -1', textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary">파일이 없습니다</Typography>
        </Box>
      )}
    </Box>
  );
};

export default FileList;
