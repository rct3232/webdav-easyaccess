import React from 'react';
import { Box, Paper, Typography, IconButton } from '@mui/material';
import { ExpandLess as ExpandLessIcon } from '@mui/icons-material';
import { useResponsive } from '../../../hooks/useResponsive';

/**
 * Minimized progress summary (collapsed view) - shows overall status and expand button.
 */
const ProgressSummary = ({
  onExpand,
  renderStatusIcon,
  primaryLabel,
  secondaryLabel,
}) => {
  const { isMobile } = useResponsive();

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
      onClick={onExpand}
    >
      {renderStatusIcon()}
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography variant="caption" sx={{ fontWeight: 'medium', display: 'block' }}>
          {primaryLabel}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
          {secondaryLabel}
        </Typography>
      </Box>
      <IconButton
        size="small"
        onClick={(e) => {
          e.stopPropagation();
          onExpand();
        }}
        sx={{ padding: 0.5 }}
      >
        <ExpandLessIcon fontSize="small" />
      </IconButton>
    </Paper>
  );
};

export default ProgressSummary;
