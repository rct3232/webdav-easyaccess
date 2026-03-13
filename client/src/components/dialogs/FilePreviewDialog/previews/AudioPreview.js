import React from 'react';
import { Box } from '@mui/material';

const AudioPreview = ({ audioContainerRef }) => (
  <Box
    sx={{
      flex: 1,
      minHeight: 0,
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      '& .plyr': {
        '--plyr-audio-controls-background': 'transparent',
        '--plyr-audio-control-color': '#ffffff',
        '--plyr-audio-control-color-hover': '#ffffff',
        '--plyr-color-main': '#ffffff',
        '--plyr-audio-progress-buffered-background': 'rgba(255,255,255,0.2)',
        '--plyr-audio-range-track-background': 'rgba(255,255,255,0.2)',
        '--plyr-range-thumb-background': '#ffffff',
        '--plyr-menu-background': 'rgba(0,0,0,0.9)',
        '--plyr-menu-color': '#ffffff',
        '--plyr-tooltip-background': 'rgba(0,0,0,0.9)',
        '--plyr-tooltip-color': '#ffffff',
        width: '100%',
        maxWidth: 500,
      },
    }}
  >
    <div ref={audioContainerRef} style={{ width: '100%', maxWidth: 500 }} />
  </Box>
);

export default AudioPreview;
