import React from 'react';
import { Box } from '@mui/material';

/**
 * Shared responsive card-grid container (P-3 extraction from FileGrid §2.6).
 * File cards and collection cards render on the SAME columns/gap surface so the
 * `__collections__` list reaches grid parity with files.
 * @see docs/spec/client/components/file-manager/ResponsiveCardGrid.md
 */
const ResponsiveCardGrid = React.forwardRef(function ResponsiveCardGrid({ children, sx }, ref) {
  return (
    <Box
      ref={ref}
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: 'repeat(2, 1fr)',
          sm: 'repeat(3, 1fr)',
          md: 'repeat(4, 1fr)',
          lg: 'repeat(6, 1fr)',
          xl: 'repeat(auto-fill, minmax(150px, 1fr))',
        },
        gap: { xs: 1.5, md: 2 },
        position: 'relative',
        minHeight: 'auto',
        ...(sx || {}),
      }}
    >
      {children}
    </Box>
  );
});

/**
 * Full-width grid child slot (cluster headers, merge slot, load-more sentinel).
 */
const CardGridSpan = React.forwardRef(function CardGridSpan({ children, sx, ...rest }, ref) {
  return (
    <Box ref={ref} sx={{ gridColumn: '1 / -1', ...(sx || {}) }} {...rest}>
      {children}
    </Box>
  );
});

export { CardGridSpan };
export default ResponsiveCardGrid;
