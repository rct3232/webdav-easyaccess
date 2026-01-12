import React from 'react';
import {
  Typography,
  Box,
  Checkbox,
  Avatar,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { DriveFileMove as MoveIcon, ContentCopy as CopyIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { formatFileSize, formatDate } from '../utils/format';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { getFileIcon, getThumbnail } from '../utils/fileIconUtils';

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap }) => {
  const theme = useTheme();
  const {
    draggedFile,
    dropTarget,
    handleDragStart,
    handleDragEnd,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useDragAndDrop(onFileDrop, selectionMode, theme);

  const isSelected = (file) => selectedFiles && selectedFiles.has(file.path);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
        gap: 2,
      }}
    >
      {files.map((file, index) => {
        const checked = selectionMode && isSelected(file);
        const thumbnail = getThumbnail(file);
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
          <Box
            key={index}
            draggable={!selectionMode && !isDisabled}
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
              cursor: isDisabled ? 'not-allowed' : (selectionMode ? 'pointer' : 'move'),
              transition: 'all 0.2s',
              color: isDisabled ? 'text.disabled' : (dropTarget === file.path ? 'white' : 'inherit'),
              position: 'relative',
              ...(dropTarget === file.path && {
                '& .MuiAvatar-root': {
                  filter: 'brightness(0) invert(1)',
                },
                '& .MuiSvgIcon-root': {
                  color: 'white',
                },
                '& .MuiTypography-root': {
                  color: 'white',
                },
              }),
            }}
          >
            {selectionMode && (
              <Box sx={{ minWidth: 40, display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  checked={checked}
                  onChange={(e) => {
                    e.stopPropagation();
                    onFileCheck && onFileCheck(file, e.target.checked);
                  }}
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
                {renderProcessingIcon()}
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
