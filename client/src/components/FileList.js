import React, { useState } from 'react';
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
  Checkbox,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
} from '@mui/icons-material';
import { formatFileSize, formatDate } from '../utils/format';

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck }) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const getFileIcon = (file) => {
    if (file.type === 'directory') {
      return <FolderIcon color="primary" />;
    }
    if (file.mime?.startsWith('image/')) {
      return <ImageIcon />;
    }
    if (file.mime?.startsWith('video/')) {
      return <VideoIcon />;
    }
    return <FileIcon />;
  };

  const handleDragStart = (e, file) => {
    setDraggedFile(file);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', file.path);
  };

  const handleDragEnd = () => {
    setDraggedFile(null);
    setDropTarget(null);
  };

  const handleDragOver = (e, file) => {
    // Only allow drop on folders and not on the dragged file itself
    if (file.type === 'directory' && draggedFile?.path !== file.path) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTarget(file.path);
    }
  };

  const handleDragLeave = () => {
    setDropTarget(null);
  };

  const handleDrop = (e, targetFolder) => {
    e.preventDefault();
    e.stopPropagation();
    
    if (draggedFile && targetFolder.type === 'directory' && draggedFile.path !== targetFolder.path) {
      onFileDrop && onFileDrop(draggedFile, targetFolder);
    }
    
    setDraggedFile(null);
    setDropTarget(null);
  };

  const isSelected = (file) => selectedFiles && selectedFiles.has(file.path);

  return (
    <List>
      {files.map((file, index) => {
        const checked = selectionMode && isSelected(file);
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
            <ListItemIcon>{getFileIcon(file)}</ListItemIcon>
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

