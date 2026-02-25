import React, { useRef, useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
  Box,
  CircularProgress,
  useTheme,
  Tooltip,
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { formatFileSize, formatDate } from '../../utils/format';
import { useFileViewCommon } from '../../hooks/useFileViewCommon';
import { renderProcessingIcon } from '../../utils/fileViewUtils';
import { getFileIcon } from '../../utils/fileIconUtils';
import { useResponsive } from '../../hooks/useResponsive';
import { FileDetailSkeleton } from './FileSkeletons';
import { pixelMiddleTruncate } from '../../utils/stringUtils';

const FileDetail = ({ files, onFileClick, onMoreClick, showMoreButton, onLongPressSelect, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, hasWritePermission, currentPath, onPathClick, loading = false }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const tableRef = useRef(null);
  const theme = useTheme();
  const longPressTimersRef = useRef(new Map());
  const touchMovedRef = useRef(new Map());
  const [nameColWidth, setNameColWidth] = React.useState(200);
  const nameColRef = React.useRef(null);

  React.useEffect(() => {
    if (!nameColRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setNameColWidth(entry.contentRect.width);
        }
      }
    });

    observer.observe(nameColRef.current);
    return () => observer.disconnect();
  }, [files.length]); // Refresh if files change

  // Padding/Icon in TableCell: Icon(20px) + gap(6px) + padding(~4px)
  const maxPixelWidth = Math.max(40, nameColWidth - 32);
  const font = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

  useEffect(() => {
    const timers = longPressTimersRef.current;
    const touchMoved = touchMovedRef.current;
    return () => {
      timers.forEach(timer => clearTimeout(timer));
      timers.clear();
      touchMoved.clear();
    };
  }, []);

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
              const isDragging = draggedFile?.path === file.path;
              const isDropTarget = dropTarget === file.path;
              const dragHandlers = getDragHandlers(file, isDisabled);
              const dropHandlers = getDropHandlers(file, isDisabled);

              return (
                <TableRow
                  key={`${file.path}-${index}`}
                  data-file-path={file.path}
                  {...dragHandlers}
                  {...dropHandlers}
                  {...getLongPressHandlers(file)}
                  hover={!isDisabled}
                  sx={{
                    cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
                    opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : (file.isHidden ? 0.5 : 1)),
                    backgroundColor: isDropTarget
                      ? 'primary.main'
                      : (selectionMode && checked ? (t) => alpha(t.palette.primary.main, 0.12) : 'transparent'),
                    ...(selectionMode && checked && !isDropTarget && {
                      '&:hover': {
                        backgroundColor: (t) => alpha(t.palette.primary.main, 0.2),
                      },
                    }),
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
                  onClick={(e) => {
                    if (!isDisabled) {
                      onFileClick(file, e);
                    }
                  }}
                  onContextMenu={(e) => {
                    if (!isDisabled || allowContextMenu) {
                      onContextMenu(e, file);
                    }
                  }}
                >
                  <TableCell
                    sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
                    ref={index === 0 ? nameColRef : null}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '1.25rem' }}>
                      {getFileIcon(file)}
                      {(() => {
                        const originalName = file.basename;
                        const truncatedName = pixelMiddleTruncate(originalName, maxPixelWidth, font);
                        const isTruncated = truncatedName !== originalName;

                        const typography = (
                          <Typography variant="body2" sx={{ fontSize: '0.875rem', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                            {truncatedName}
                          </Typography>
                        );

                        return isTruncated ? (
                          <Tooltip title={originalName} disableInteractive>
                            {typography}
                          </Tooltip>
                        ) : typography;
                      })()}
                    </Box>
                  </TableCell>
                  <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
                      {file.type === 'directory' ? t('actions.folder') : file.mime || '-'}
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
                  <TableCell align="right" sx={{ borderBottom: '1px solid', borderColor: 'divider', width: 48, px: 0.5 }}>
                    {(showMoreButton ?? !selectionMode) && onMoreClick && (
                      <Box
                        component="button"
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onMoreClick(file, e);
                        }}
                        onTouchStart={(e) => e.stopPropagation()}
                        onTouchEnd={(e) => {
                          e.stopPropagation();
                          if (e.cancelable) e.preventDefault();
                          onMoreClick(file, e);
                        }}
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: 0.5,
                          minWidth: 44,
                          minHeight: 44,
                          border: 'none',
                          borderRadius: '50%',
                          background: 'transparent',
                          cursor: 'pointer',
                          color: 'inherit',
                        }}
                        aria-label="More actions"
                      >
                        <MoreVertIcon fontSize="small" />
                      </Box>
                    )}
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
              <TableCell colSpan={5} sx={{ border: 'none' }}>
                <Box sx={{ textAlign: 'center', py: 4 }}>
                  <Typography color="text.secondary">{t('fileManager.noFiles')}</Typography>
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
