import React, { forwardRef } from 'react';
import { Box, IconButton } from '@mui/material';
import { ZoomIn as ZoomInIcon, Add as AddIcon, Remove as RemoveIcon } from '@mui/icons-material';

const percentButtonSx = {
  minWidth: 40,
  py: 0.25,
  px: 0.75,
  border: 'none',
  borderRadius: 1,
  background: 'transparent',
  color: 'inherit',
  fontSize: '0.875rem',
  cursor: 'pointer',
  fontFamily: 'inherit',
  '&:hover': { backgroundColor: 'rgba(255, 255, 255, 0.1)' },
};

/**
 * Full zoom controls (zoom out, percentage/reset, zoom in). Used on desktop header and in mobile floating bar.
 */
export const ZoomControlButtons = ({ zoom, onZoomIn, onZoomOut, onReset, t }) => {
  const percent = Math.round(zoom * 100);
  return (
    <>
      <IconButton
        size="small"
        onClick={onZoomOut}
        aria-label={t('preview.zoomOut')}
        sx={{ color: 'inherit' }}
      >
        <RemoveIcon fontSize="small" />
      </IconButton>
      <Box
        component="button"
        type="button"
        onClick={onReset}
        aria-label={t('preview.zoomReset')}
        sx={percentButtonSx}
      >
        {percent}%
      </Box>
      <IconButton
        size="small"
        onClick={onZoomIn}
        aria-label={t('preview.zoomIn')}
        sx={{ color: 'inherit' }}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </>
  );
};

const HeaderZoomControls = forwardRef(function HeaderZoomControls(
  { zoom, onZoomIn, onZoomOut, onReset, t, isMobile = false, onOpenFloating },
  ref
) {
  const percent = Math.round(zoom * 100);

  if (isMobile) {
    return (
      <Box
        ref={ref}
        component="button"
        type="button"
        onClick={onOpenFloating}
        aria-label={t('preview.zoomIn')}
        sx={{
          ...percentButtonSx,
          minWidth: 32,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {zoom === 1 ? <ZoomInIcon fontSize="small" /> : `${percent}%`}
      </Box>
    );
  }

  return (
    <Box display="flex" alignItems="center" gap={0.5}>
      <ZoomControlButtons
        zoom={zoom}
        onZoomIn={onZoomIn}
        onZoomOut={onZoomOut}
        onReset={onReset}
        t={t}
      />
    </Box>
  );
});

export default HeaderZoomControls;
