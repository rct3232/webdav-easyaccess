import React, { useState } from 'react';
import {
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  Checkbox,
} from '@mui/material';
import {
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
} from '@mui/icons-material';
import { formatFileSize } from '../utils/format';

const FileGrid = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck }) => {
  const [draggedFile, setDraggedFile] = useState(null);
  const [dropTarget, setDropTarget] = useState(null);
  const getThumbnail = (file) => {
    if (file.thumbnailUrl) {
      return file.thumbnailUrl;
    }
    return null;
  };

  const getFileIcon = (file) => {
    if (file.type === 'directory') {
      return <FolderIcon sx={{ fontSize: 64, color: 'primary.main' }} />;
    }
    return <FileIcon sx={{ fontSize: 64, color: 'text.secondary' }} />;
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
    <Grid container spacing={2}>
      {files.map((file, index) => {
        const thumbnail = getThumbnail(file);
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const checked = selectionMode && isSelected(file);
        
        return (
          <Grid item xs={6} sm={4} md={3} lg={2} key={index}>
            <Card
              draggable={!selectionMode}
              sx={{
                cursor: selectionMode ? 'pointer' : 'move',
                '&:hover': {
                  boxShadow: 4,
                },
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                opacity: isDragging ? 0.5 : 1,
                border: isDropTarget ? '2px solid' : checked ? '2px solid' : 'none',
                borderColor: checked ? 'primary.main' : 'primary.main',
                backgroundColor: checked ? 'action.selected' : 'transparent',
                transition: 'all 0.2s',
                position: 'relative',
              }}
              onClick={() => onFileClick(file)}
              onContextMenu={(e) => onContextMenu(e, file)}
              onDragStart={!selectionMode ? (e) => handleDragStart(e, file) : undefined}
              onDragEnd={!selectionMode ? handleDragEnd : undefined}
              onDragOver={!selectionMode ? (e) => handleDragOver(e, file) : undefined}
              onDragLeave={!selectionMode ? handleDragLeave : undefined}
              onDrop={!selectionMode ? (e) => handleDrop(e, file) : undefined}
            >
              {selectionMode && (
                <Checkbox
                  checked={checked}
                  onChange={(e) => {
                    e.stopPropagation();
                    onFileCheck && onFileCheck(file, e.target.checked);
                  }}
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
                  height: 150,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDropTarget ? 'primary.light' : 'grey.100',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                }}
              >
                {thumbnail ? (
                  <CardMedia
                    component="img"
                    height="150"
                    image={thumbnail}
                    alt={file.basename}
                    sx={{ objectFit: 'contain' }}
                  />
                ) : (
                  getFileIcon(file)
                )}
              </Box>
              <CardContent sx={{ flexGrow: 1, p: 1.5 }}>
                <Typography
                  variant="body2"
                  noWrap
                  title={file.basename}
                  sx={{ fontWeight: 'medium' }}
                >
                  {file.basename}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {file.type === 'directory' ? '폴더' : formatFileSize(file.size)}
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        );
      })}
      {files.length === 0 && (
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

