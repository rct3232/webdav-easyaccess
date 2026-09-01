import React from 'react';
import { Box, IconButton, Typography } from '@mui/material';
import {
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
} from '@mui/icons-material';

const chevronSx = {
  color: 'white',
  backgroundColor: 'rgba(0,0,0,0.5)',
  '&:hover': { backgroundColor: 'rgba(0,0,0,0.7)' },
  '&.Mui-disabled': { color: 'rgba(255,255,255,0.3)' },
};

const VideoPreview = ({
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
  videoContainerRef,
  videoNotPlayable,
  t,
}) => {
  const showChevrons = isGalleryMode && (isMobile ? headerVisible : controlsVisible);

  return (
    <Box
      ref={mediaTouchRef}
      sx={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 0,
        width: '100%',
        '& .plyr': {
          width: '100%',
          height: '100%',
          '--plyr-color-main': '#ffffff',
          '--plyr-video-control-color': '#ffffff',
          '--plyr-video-control-color-hover': '#ffffff',
          '--plyr-video-control-background-hover': '#ffffff',
          '--plyr-video-progress-buffered-background': 'rgba(255,255,255,0.2)',
          '--plyr-video-range-track-background': 'rgba(255,255,255,0.2)',
          '--plyr-range-fill-background': '#ffffff',
          '--plyr-range-thumb-background': '#ffffff',
          '--plyr-menu-background': 'rgba(0,0,0,0.9)',
          '--plyr-menu-color': '#ffffff',
          '--plyr-tooltip-background': 'rgba(0,0,0,0.9)',
          '--plyr-tooltip-color': '#ffffff',
        },
        '& .plyr__control--overlaid': {
          background: '#ffffff',
          color: 'rgba(0,0,0,0.5)',
          '&:hover, &:focus, &:focus-visible': {
            background: '#ffffff',
            color: 'rgba(0,0,0,0.5)',
          },
        },
        '& .plyr__video-wrapper': { width: '100%', height: '100%' },
        '& .plyr__video-wrapper video': {
          width: '100%',
          height: '100%',
          objectFit: 'contain',
        },
      }}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {showChevrons && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            goPrev();
          }}
          disabled={currentMediaIndex <= 0}
          sx={{ position: 'absolute', left: 8, zIndex: 5, ...chevronSx }}
        >
          <ChevronLeftIcon />
        </IconButton>
      )}
      {videoNotPlayable && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            zIndex: 4,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.45)',
            pointerEvents: 'none',
            px: 3,
            textAlign: 'center',
          }}
        >
          <Typography sx={{ color: 'rgba(255,255,255,0.92)', fontWeight: 600 }}>
            {t('preview.videoNotPlayable')}
          </Typography>
        </Box>
      )}
      <div
        ref={videoContainerRef}
        style={{
          width: '100%',
          height: '100%',
          minHeight: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      />
      {showChevrons && (
        <IconButton
          onClick={(e) => {
            e.stopPropagation();
            goNext();
          }}
          disabled={currentMediaIndex >= mediaFilesLength - 1}
          sx={{ position: 'absolute', right: 8, zIndex: 5, ...chevronSx }}
        >
          <ChevronRightIcon />
        </IconButton>
      )}
    </Box>
  );
};

export default VideoPreview;
