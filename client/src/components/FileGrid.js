import React, { useRef } from 'react';
import {
  Grid,
  Card,
  CardMedia,
  CardContent,
  Typography,
  Box,
  Checkbox,
  CircularProgress,
  useTheme,
} from '@mui/material';
import { useFileViewCommon } from '../hooks/useFileViewCommon';
import { renderProcessingIcon } from '../utils/fileViewUtils';
import { getFileIconForGrid, getThumbnail } from '../utils/fileIconUtils';

const FileGrid = ({ files, onFileClick, onContextMenu, onFileDrop, selectionMode, selectedFiles, onFileCheck, processingMap, hasWritePermission }) => {
  const gridRef = useRef(null);
  const theme = useTheme();
  
  const {
    draggedFile,
    dropTarget,
    getFileState,
    handleFileCheck: handleCheck,
    getDragHandlers,
    getDropHandlers,
  } = useFileViewCommon({
    onFileDrop,
    selectionMode,
    selectedFiles,
    onFileCheck,
    processingMap,
    theme,
  });

  return (
    <Grid 
      container 
      spacing={2}
      ref={gridRef}
      sx={{
        position: 'relative',
        minHeight: files.length === 0 ? '200px' : 'auto',
      }}
    >
      {files.map((file, index) => {
        const thumbnail = getThumbnail(file);
        const { isSelected: checked, isDisabled, isProcessing, processingType } = getFileState(file);
        const isDragging = draggedFile?.path === file.path;
        const isDropTarget = dropTarget === file.path;
        const dragHandlers = getDragHandlers(file, isDisabled);
        const dropHandlers = getDropHandlers(file, isDisabled);
        
        return (
          <Grid item xs={6} sm={4} md={3} lg={2} key={index}>
            <Card
              {...dragHandlers}
              {...dropHandlers}
              sx={{
                cursor: isDisabled ? 'not-allowed' : (selectionMode ? 'pointer' : 'move'),
                '&:hover': {
                  boxShadow: isDisabled ? 2 : 4,
                },
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : 1),
                border: isDropTarget ? '2px solid' : checked ? '2px solid' : 'none',
                borderColor: checked ? 'primary.main' : 'primary.main',
                backgroundColor: checked ? 'action.selected' : 'transparent',
                transition: 'all 0.2s',
                position: 'relative',
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
            >
              {selectionMode && (
                <Checkbox
                  checked={checked}
                  onChange={(e) => handleCheck(file, e.target.checked, e)}
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
                  backgroundColor: isDropTarget ? 'primary.main' : 'grey.100',
                  position: 'relative',
                  transition: 'all 0.2s',
                  overflow: 'hidden',
                  ...(isDropTarget && {
                    '& .MuiSvgIcon-root': {
                      color: 'white',
                    },
                    '& img': {
                      filter: 'brightness(0.7)',
                    },
                  }),
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
              <CardContent sx={{ 
                p: 1, 
                pt: 0.5, 
                pb: 1,
                ...(isDropTarget && {
                  backgroundColor: 'primary.main',
                }),
              }}>
                <Typography
                  variant="body2"
                  noWrap
                  title={file.basename}
                  sx={{ 
                    fontWeight: 'medium',
                    fontSize: '0.875rem',
                    textAlign: 'center',
                    color: isDropTarget ? 'white' : 'inherit',
                  }}
                >
                  {file.basename}
                </Typography>
              </CardContent>
              {isProcessing && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    pointerEvents: 'none',
                  }}
                >
                  <CircularProgress size={18} thickness={5} />
                  {renderProcessingIcon(processingType)}
                </Box>
              )}
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
