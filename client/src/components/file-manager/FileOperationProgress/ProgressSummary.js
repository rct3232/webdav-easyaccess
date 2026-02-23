import React from 'react';
import { Box, Paper, Typography, IconButton } from '@mui/material';
import { ChevronRight as ChevronRightIcon } from '@mui/icons-material';
import { useResponsive } from '../../../hooks/useResponsive';

/**
 * Progress summary chip. Renders either:
 * - variant="appbar": compact chip for AppBar (icon, primary, secondary)
 * - default: legacy floating Paper (minimized view)
 */
const ProgressSummary = ({
  variant,
  onExpand,
  onOpenDrawer,
  renderStatusIcon,
  primaryLabel,
  secondaryLabel,
}) => {
  const { isMobile } = useResponsive();
  const handleClick = onOpenDrawer ?? onExpand;

  if (variant === 'appbar') {
    return (
      <Box
        component="button"
        onClick={handleClick}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          padding: '4px 8px',
          border: 'none',
          borderRadius: 1,
          cursor: 'pointer',
          backgroundColor: 'rgba(255, 255, 255, 0.15)',
          color: 'inherit',
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.25)',
          },
        }}
      >
        {renderStatusIcon?.()}
        <Box sx={{ textAlign: 'left', minWidth: 0 }}>
          <Typography variant="caption" sx={{ fontWeight: 'medium', display: 'block', lineHeight: 1.2 }}>
            {primaryLabel}
          </Typography>
          <Typography variant="caption" sx={{ display: 'block', lineHeight: 1.2, opacity: 0.9 }}>
            {secondaryLabel}
          </Typography>
        </Box>
        <ChevronRightIcon sx={{ fontSize: 18, flexShrink: 0 }} />
      </Box>
    );
  }

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'fixed',
        bottom: 16,
        ...(isMobile ? { left: 16 } : { right: 16 }),
        minWidth: 200,
        maxWidth: 300,
        borderRadius: '20px',
        padding: '8px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        cursor: 'pointer',
        zIndex: 1300,
        backgroundColor: 'background.paper',
      }}
      onClick={handleClick}
    >
      {renderStatusIcon?.()}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 'medium', display: 'block' }}>
          {primaryLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {secondaryLabel}
        </Typography>
      </Box>
      <ChevronRightIcon sx={{ fontSize: 18 }} />
    </Paper>
  );
};

export default ProgressSummary;
