import React, { useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableRow,
  Typography,
  Box,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from './hooks/useFileViewCommon';
import { useResponsive } from '../../hooks/useResponsive';
import { getEntryKey } from '../../utils/fileViewUtils';
import { FileDetailSkeleton } from './FileSkeletons';
import FileDetailRow from './FileDetailRow';

const FileDetail = ({ files, onFileClick, onMoreClick, showMoreButton, onLongPressSelect, onContextMenu, onFileDrop, onDropPermissionDenied, onDragStart, onDragEnd, internalDraggedNodeId, selectionMode, selectedFiles, onFileCheck, processingMap, loading = false }) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const tableRef = useRef(null);
  const theme = useTheme();
  const [nameColWidth, setNameColWidth] = React.useState(200);
  const nameColRef = React.useRef(null);

  useEffect(() => {
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
              const { isSelected, isDisabled, isProcessing, processingType, isPermissionDisabled } = getFileState(file);
              const isDragging = draggedFile?.nodeId != null && getEntryKey(draggedFile) === getEntryKey(file);
              const isDropTarget = dropTarget != null && String(dropTarget) === String(getEntryKey(file));
              const dragHandlers = getDragHandlers(file, isDisabled);
              const dropHandlers = getDropHandlers(file, isDisabled);

              return (
                <FileDetailRow
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
                  maxPixelWidth={maxPixelWidth}
                  font={font}
                  t={t}
                />
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
