import React, { useState } from 'react';
import {
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Typography,
  Box,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  Image as ImageIcon,
  VideoFile as VideoIcon,
} from '@mui/icons-material';
import { formatFileSize, formatDate } from '../utils/format';

const FileList = ({ files, onFileClick, onContextMenu, onFileDrop }) => {
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

  return (
    <List>
      {files.map((file, index) => (
        <ListItem
          key={index}
          button
          draggable
          onClick={() => onFileClick(file)}
          onContextMenu={(e) => onContextMenu(e, file)}
          onDragStart={(e) => handleDragStart(e, file)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, file)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, file)}
          sx={{
            '&:hover': {
              backgroundColor: 'action.hover',
            },
            backgroundColor: dropTarget === file.path ? 'primary.light' : 'transparent',
            opacity: draggedFile?.path === file.path ? 0.5 : 1,
            cursor: 'move',
            transition: 'background-color 0.2s',
          }}
        >
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
      ))}
      {files.length === 0 && (
        <Box sx={{ textAlign: 'center', py: 4 }}>
          <Typography color="text.secondary">파일이 없습니다</Typography>
        </Box>
      )}
    </List>
  );
};

export default FileList;

