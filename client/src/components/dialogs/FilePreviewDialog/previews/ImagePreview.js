import React from 'react';
import { Box, IconButton } from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';

const mediaWrapperSx = {
  position: 'relative',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 1,
  minHeight: 0,
  width: '100%',
};

const chevronSx = {
  color: 'white',
  backgroundColor: 'rgba(0,0,0,0.5)',
  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
};

const ImagePreview = ({
  previewUrl,
  targetFile,
  isGalleryMode,
  isMobile,
  headerVisible,
  controlsVisible,
  currentMediaIndex,
  mediaFilesLength,
  goPrev,
  goNext,
  handleTouchStart,
  handleTouchEnd,
  mediaTouchRef,
}) => {
  const showChevrons = isGalleryMode && (isMobile ? headerVisible : controlsVisible);

  return (
    <Box
      ref={mediaTouchRef}
      sx={mediaWrapperSx}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {showChevrons && (
        <IconButton
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          disabled={currentMediaIndex <= 0}
          sx={{ position: 'absolute', left: 8, zIndex: 5, ...chevronSx }}
        >
          <ChevronLeftIcon />
        </IconButton>
      )}
      <Box
        component="img"
        src={previewUrl}
        alt={targetFile.name}
        sx={{
          maxWidth: '100%',
          maxHeight: isMobile ? '100%' : '70vh',
          height: isMobile ? '100%' : 'auto',
          objectFit: 'contain',
          margin: 'auto',
          display: 'block',
        }}
      />
      {showChevrons && (
        <IconButton
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          disabled={currentMediaIndex >= mediaFilesLength - 1}
          sx={{ position: 'absolute', right: 8, zIndex: 5, ...chevronSx }}
        >
          <ChevronRightIcon />
        </IconButton>
      )}
    </Box>
  );
};

export default ImagePreview;
