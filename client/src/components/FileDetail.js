import React from 'react';
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
} from '@mui/material';
import { DriveFileMove as MoveIcon, ContentCopy as CopyIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { formatFileSize, formatDate } from '../utils/format';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { getFileIcon } from '../utils/fileIconUtils';

const FileDetail = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap }) => {
  const {
    draggedFile,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragAndDrop(onFileDrop, selectionMode);

  const isSelected = (file) => selectedFiles && selectedFiles.has(file.path);

  return (
    <TableContainer component={Box}>
      <Table sx={{ borderCollapse: 'separate', borderSpacing: 0 }}>
        <TableBody>
          {files.map((file, index) => {
            const isDragging = draggedFile?.path === file.path;
            const isDropTarget = dropTarget === file.path;
            const checked = selectionMode && isSelected(file);
            // 디렉토리인 경우 권한 체크 (파일은 항상 접근 가능)
            const isPermissionDisabled = file.type === 'directory' && file.hasReadPermission === false;
            const processingType = processingMap?.get(file.path);
            const isProcessing = Boolean(processingType);
            const isDisabled = isPermissionDisabled || isProcessing;

            const renderProcessingIcon = () => {
              if (processingType === 'move') return <MoveIcon fontSize="small" color="primary" />;
              if (processingType === 'copy') return <CopyIcon fontSize="small" color="primary" />;
              if (processingType === 'delete') return <DeleteIcon fontSize="small" color="primary" />;
              return null;
            };
            
            return (
              <TableRow
                key={index}
                draggable={!selectionMode && !isDisabled}
                hover={!isDisabled}
                selected={checked}
                sx={{ 
                  cursor: isDisabled ? 'not-allowed' : (selectionMode ? 'pointer' : 'move'),
                  opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : 1),
                  backgroundColor: isDropTarget ? 'primary.light' : 'transparent',
                  transition: 'all 0.2s',
                  borderBottom: '1px solid',
                  borderColor: 'divider',
                  color: isDisabled ? 'text.disabled' : 'inherit',
                  position: 'relative',
                }}
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
                onDragStart={!selectionMode && !isDisabled ? (e) => handleDragStart(e, file) : undefined}
                onDragEnd={!selectionMode ? handleDragEnd : undefined}
                onDragOver={!selectionMode && !isDisabled ? (e) => handleDragOver(e, file) : undefined}
                onDragLeave={!selectionMode ? handleDragLeave : undefined}
                onDrop={!selectionMode && !isDisabled ? (e) => handleDrop(e, file) : undefined}
              >
                {selectionMode && (
                  <TableCell padding="checkbox" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                    <Checkbox
                      checked={checked}
                      onChange={(e) => {
                        e.stopPropagation();
                        onFileCheck && onFileCheck(file, e.target.checked);
                      }}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </TableCell>
                )}
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {getFileIcon(file)}
                    <Typography variant="body2">{file.basename}</Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  {file.type === 'directory' ? '폴더' : file.mime || '-'}
                </TableCell>
                <TableCell align="right" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  {file.type === 'directory' ? '-' : formatFileSize(file.size)}
                </TableCell>
                <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
                  {formatDate(file.lastmod)}
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
                    <CircularProgress size={18} thickness={5} />
                    <Box sx={{ ml: 0.5 }}>
                      {renderProcessingIcon()}
                    </Box>
                  </Box>
                )}
              </TableRow>
            );
          })}
          {files.length === 0 && (
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
