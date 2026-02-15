import React from 'react';
import { Box, Button } from '@mui/material';

/**
 * Presentational desktop path/back bar: single button with label and optional click.
 * Used by FileManager for share-link root and normal (home, shared, recent, parent) navigation.
 */
const DesktopPathBar = ({ label, startIcon, disabled, onClick }) => {
  return (
    <Box sx={{ px: 2, py: 0, display: 'flex', alignItems: 'center' }}>
      <Button
        startIcon={startIcon}
        disabled={disabled}
        onClick={onClick}
        sx={{
          textTransform: 'none',
          color: 'text.primary',
          '&:hover': { backgroundColor: 'action.hover' },
          '&.Mui-disabled': { color: 'text.primary' },
        }}
      >
        {label}
      </Button>
    </Box>
  );
};

export default DesktopPathBar;
