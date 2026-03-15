import React from 'react';
import { Box, IconButton } from '@mui/material';
import { Add as ZoomInIcon, Remove as ZoomOutIcon } from '@mui/icons-material';

const PreviewZoomBar = ({ zoom, onZoomIn, onZoomOut, onReset, visible, t, bottom = 16 }) => {
  const percent = Math.round(zoom * 100);

  return (
    <Box
      onClick={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      sx={{
        position: 'absolute',
        bottom,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 10,
        visibility: visible ? 'visible' : 'hidden',
        display: visible ? 'flex' : 'none',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.5,
        borderRadius: 3,
        backgroundColor: 'rgba(0,0,0,0.6)',
      }}
    >
      <IconButton
        size="small"
        onClick={onZoomOut}
        aria-label={t('preview.zoomOut')}
        sx={{ color: 'rgba(255,255,255,0.9)' }}
      >
        <ZoomOutIcon fontSize="small" />
      </IconButton>
      <Box
        component="button"
        type="button"
        onClick={onReset}
        aria-label={t('preview.zoomReset')}
        sx={{
          minWidth: 48,
          py: 0.5,
          px: 1,
          border: 'none',
          borderRadius: 1,
          background: 'transparent',
          color: 'rgba(255,255,255,0.9)',
          fontSize: '0.875rem',
          cursor: 'pointer',
          fontFamily: 'inherit',
          '&:hover': { backgroundColor: 'rgba(255,255,255,0.1)' },
        }}
      >
        {percent}%
      </Box>
      <IconButton
        size="small"
        onClick={onZoomIn}
        aria-label={t('preview.zoomIn')}
        sx={{ color: 'rgba(255,255,255,0.9)' }}
      >
        <ZoomInIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default PreviewZoomBar;
