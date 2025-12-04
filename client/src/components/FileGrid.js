import React from 'react';
import {
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  Checkbox,
} from '@mui/material';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { getFileIconForGrid, getThumbnail } from '../utils/fileIconUtils';

const FileGrid = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck }) => {
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
                  width: '100%',
                  aspectRatio: '1 / 1',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: isDropTarget ? 'primary.light' : 'grey.100',
                  position: 'relative',
                  transition: 'background-color 0.2s',
                  overflow: 'hidden',
                }}
              >
                {thumbnail ? (
                  <CardMedia
                    component="img"
                    image={thumbnail}
                    alt={file.basename}
                    sx={{ 
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover' 
                    }}
                  />
                ) : (
                  getFileIconForGrid(file)
                )}
              </Box>
              <CardContent sx={{ p: 1, pt: 0.5, pb: 1 }}>
                <Typography
                  variant="body2"
                  noWrap
                  title={file.basename}
                  sx={{ 
                    fontWeight: 'medium',
                    fontSize: '0.875rem',
                    textAlign: 'center',
                  }}
                >
                  {file.basename}
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
