import React, { useRef, useCallback } from 'react';
import {
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  Checkbox,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from '../hooks/useFileViewCommon';
import { renderProcessingIcon } from '../utils/fileViewUtils';
import { getFileIconForGrid, getThumbnail } from '../utils/fileIconUtils';
import { useResponsive } from '../hooks/useResponsive';
import { FileGridSkeleton } from './FileSkeletons';

const FileGrid = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, hasWritePermission, currentPath, onPathClick, loading = false }) => {
  const { isMobile } = useResponsive();
  const gridRef = useRef(null);
  const theme = useTheme();
  const longPressTimersRef = useRef(new Map());
  const touchMovedRef = useRef(new Map());
  
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
  const getLongPressHandlers = useCallback((file, canOpenMenu = false) => {
    if (!isMobile || selectionMode) return {};
    
    const handleTouchStart = (e) => {
      if (e.cancelable) e.preventDefault();
      touchMovedRef.current.set(file.path, false);
      const timer = setTimeout(() => {
        if (!touchMovedRef.current.get(file.path)) {
          if (navigator.vibrate) navigator.vibrate(50);
          if (canOpenMenu) {
            onContextMenu(e, file);
          }
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

  return (
    <Grid 
      container 
      spacing={isMobile ? 1.5 : 2}
      ref={gridRef}
      sx={{
        position: 'relative',
        minHeight: files.length === 0 ? '200px' : 'auto',
      }}
    >
      {loading && files.length === 0 ? (
        <FileGridSkeleton selectionMode={selectionMode} />
      ) : (
        files.map((file, index) => {
        const thumbnail = getThumbnail(file);
        const { isSelected: checked, isDisabled, isProcessing, processingType, isPermissionDisabled } = getFileState(file);
        const allowContextMenu = isPermissionDisabled && !isProcessing;
        const canOpenMenu = !isDisabled || allowContextMenu;
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        
        return (
          <Grid item xs={6} sm={4} md={3} lg={2} xl={2} key={index}>
            <Card
              {...dragHandlers}
              {...dropHandlers}
              {...getLongPressHandlers(file, canOpenMenu)}
              sx={{
                cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
                '&:hover': {
                  boxShadow: isDisabled ? 2 : 4,
                },
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : 1),
                border: isDropTarget ? '2px solid' : checked ? '2px solid' : 'none',
                borderColor: checked ? 'primary.main' : 'primary.main',
                backgroundColor: checked ? 'action.selected' : 'transparent',
                transition: 'all 0.2s',
                position: 'relative',
                color: isDisabled ? 'text.disabled' : 'inherit',
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
              onClick={() => {
                if (!isDisabled) {
                  onFileClick(file);
                }
              }}
              onContextMenu={(e) => {
                if (!isDisabled || allowContextMenu) {
                  onContextMenu(e, file);
                }
              }}
            >
              {selectionMode && (
                <Checkbox
                  checked={checked}
                  onChange={(e) => handleCheck(file, e.target.checked, e)}
                  onClick={(e) => e.stopPropagation()}
                  sx={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    zIndex: 1,
                    backgroundColor: 'rgba(255, 255, 255, 0.9)',
                  }}
                />
              )}
              <Box
                sx={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDropTarget ? 'primary.main' : 'grey.100',
                  position: 'relative',
                  transition: 'all 0.2s',
                  overflow: 'hidden',
                  ...(isDropTarget && {
                    '& .MuiSvgIcon-root': {
                      color: 'white',
                    },
                    '& img': {
                      filter: 'brightness(0.7)',
                    },
                  }),
                }}
              >
                {thumbnail ? (
                  <CardMedia
                    component="img"
                    image={thumbnail}
                    alt={file.basename}
                    sx={{ 
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover' 
                    }}
                  />
                ) : (
                  getFileIconForGrid(file)
                )}
              </Box>
              <CardContent sx={{ 
                p: 1, 
                pt: 0.5, 
                pb: 1,
                ...(isDropTarget && {
                  backgroundColor: 'primary.main',
                }),
              }}>
                <Typography
                  variant="body2"
                  noWrap
                  title={file.basename}
                  sx={{ 
                    fontWeight: 'medium',
                    fontSize: '0.875rem',
                    textAlign: 'center',
                    color: isDropTarget ? 'white' : 'inherit',
                  }}
                >
                  {file.basename}
                </Typography>
              </CardContent>
              {isProcessing && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
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
            </Card>
          </Grid>
        );
        })
      )}
      {!loading && files.length === 0 && (
        <Grid item xs={12}>
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography color="text.secondary">파일이 없습니다</Typography>
          </Box>
        </Grid>
      )}
    </Grid>
  );
};

export default FileGrid;
