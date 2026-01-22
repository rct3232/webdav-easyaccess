import React, { useRef, useCallback } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
  Box,
  Checkbox,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { formatFileSize, formatDate } from '../utils/format';
import { useFileViewCommon } from '../hooks/useFileViewCommon';
import { renderProcessingIcon } from '../utils/fileViewUtils';
import { getFileIcon } from '../utils/fileIconUtils';
import { useResponsive } from '../hooks/useResponsive';
import { FileDetailSkeleton } from './FileSkeletons';

const FileDetail = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, hasWritePermission, currentPath, onPathClick, loading = false }) => {
  const { isMobile } = useResponsive();
  const tableRef = useRef(null);
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
    <TableContainer 
      component={Box}
      ref={tableRef}
      sx={{
        position: 'relative',
        minHeight: files.length === 0 ? '200px' : 'auto',
        overflowX: isMobile ? 'auto' : 'visible',
      }}
    >
      <Table 
        size="small" 
        sx={{ 
          borderCollapse: 'separate', 
          borderSpacing: 0,
          minWidth: isMobile ? 600 : 'auto',
        }}
      >
        <TableBody>
          {loading && files.length === 0 ? (
            <FileDetailSkeleton selectionMode={selectionMode} />
          ) : (
            files.map((file, index) => {
            const { isSelected: checked, isDisabled, isProcessing, processingType, isPermissionDisabled } = getFileState(file);
            const allowContextMenu = isPermissionDisabled && !isProcessing;
            const canOpenMenu = !isDisabled || allowContextMenu;
            const isDragging = draggedFile?.path === file.path;
            const isDropTarget = dropTarget === file.path;
            const dragHandlers = getDragHandlers(file, isDisabled);
            const dropHandlers = getDropHandlers(file, isDisabled);
            
            return (
              <TableRow
                key={index}
                {...dragHandlers}
                {...dropHandlers}
                {...getLongPressHandlers(file, canOpenMenu)}
                hover={!isDisabled}
                selected={checked}
                sx={{ 
                  cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
                  opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : 1),
                  backgroundColor: isDropTarget ? 'primary.main' : 'transparent',
                  transition: 'all 0.2s',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  color: isDisabled ? 'text.disabled' : (isDropTarget ? 'white' : 'inherit'),
                  position: 'relative',
                  height: '40px',
                  '& > td': {
                    py: 0.5,
                  },
                  ...(isDropTarget && {
                    '& .MuiSvgIcon-root': {
                      color: 'white',
                    },
                    '& .MuiTypography-root': {
                      color: 'white',
                    },
                  }),
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
                  <TableCell padding="checkbox" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Checkbox
                      checked={checked}
                      size="small"
                      sx={{ padding: '4px' }}
                      onChange={(e) => handleCheck(file, e.target.checked, e)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                )}
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '1.25rem' }}>
                    {getFileIcon(file)}
                    <Typography variant="body2" sx={{ fontSize: '0.875rem' }}>{file.basename}</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                    {file.type === 'directory' ? '폴더' : file.mime || '-'}
                  </Typography>
                </TableCell>
                <TableCell align="right" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                    {file.type === 'directory' ? '-' : formatFileSize(file.size)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                    {formatDate(file.lastmod)}
                  </Typography>
                </TableCell>
                {isProcessing && (
                  <Box
                    sx={{
                      position: 'absolute',
                      inset: 0,
                      display: 'flex',
                      justifyContent: 'flex-end',
                      alignItems: 'center',
                      pr: 2,
                      pointerEvents: 'none',
                    }}
                  >
                    <CircularProgress size={16} thickness={5} />
                    <Box sx={{ ml: 0.5 }}>
                      {renderProcessingIcon(processingType)}
                    </Box>
                  </Box>
                )}
              </TableRow>
            );
            })
          )}
          {!loading && files.length === 0 && (
            <TableRow>
              <TableCell colSpan={selectionMode ? 5 : 4} sx={{ border: 'none' }}>
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="text.secondary">파일이 없습니다</Typography>
                </Box>
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </TableContainer>
  );
};

export default FileDetail;
