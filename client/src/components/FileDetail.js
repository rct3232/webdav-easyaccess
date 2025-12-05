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
} from '@mui/material';
import { formatFileSize, formatDate } from '../utils/format';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { getFileIcon } from '../utils/fileIconUtils';

const FileDetail = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck }) => {
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
            const isDisabled = file.type === 'directory' && file.hasReadPermission === false;
            
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
