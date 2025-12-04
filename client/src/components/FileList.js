import React from 'react';
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  Checkbox,
  Avatar,
} from '@mui/material';
import { formatFileSize, formatDate } from '../utils/format';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { getFileIcon, getThumbnail } from '../utils/fileIconUtils';

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck }) => {
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
    <List>
      {files.map((file, index) => {
        const checked = selectionMode && isSelected(file);
        const thumbnail = getThumbnail(file);
        
        return (
          <ListItem
            key={index}
            button={!selectionMode}
            draggable={!selectionMode}
            onClick={() => onFileClick(file)}
            onContextMenu={(e) => onContextMenu(e, file)}
            onDragStart={!selectionMode ? (e) => handleDragStart(e, file) : undefined}
            onDragEnd={!selectionMode ? handleDragEnd : undefined}
            onDragOver={!selectionMode ? (e) => handleDragOver(e, file) : undefined}
            onDragLeave={!selectionMode ? handleDragLeave : undefined}
            onDrop={!selectionMode ? (e) => handleDrop(e, file) : undefined}
            sx={{
              '&:hover': {
                backgroundColor: 'action.hover',
              },
              backgroundColor: dropTarget === file.path ? 'primary.light' : 'transparent',
              opacity: draggedFile?.path === file.path ? 0.5 : 1,
              cursor: selectionMode ? 'pointer' : 'move',
              transition: 'background-color 0.2s',
            }}
          >
            {selectionMode && (
              <ListItemIcon sx={{ minWidth: 40 }}>
                <Checkbox
                  checked={checked}
                  onChange={(e) => {
                    e.stopPropagation();
                    onFileCheck && onFileCheck(file, e.target.checked);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              </ListItemIcon>
            )}
            <ListItemIcon sx={{ minWidth: 56, justifyContent: 'center', mr: 2 }}>
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
            </ListItemIcon>
            <ListItemText
              primary={file.basename}
              secondary={
                <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                  <Typography variant="caption" color="text.secondary">
                    {file.type === 'directory' ? '폴더' : formatFileSize(file.size)}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {formatDate(file.lastmod)}
                  </Typography>
                </Box>
              }
            />
          </ListItem>
        );
      })}
      {files.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary">파일이 없습니다</Typography>
        </Box>
      )}
    </List>
  );
};

export default FileList;
