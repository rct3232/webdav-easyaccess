import React from 'react';
import { Box, Tooltip } from '@mui/material';
import { alpha } from '@mui/material/styles';

/**
 * TileCornerBadge — shared corner badge atom for the `CardTile` `cornerBadges` slot
 * (M-4, 2026-09-30): a 16px icon in a translucent circular container over the tile
 * media. With `onClick` it is a REAL BUTTON (collections autopin → unpin);
 * without it a plain span (received/shared marker). Consumers pass
 * `data-testid`/`aria-label` through; `onClick` never bubbles to the card.
 * @see docs/spec/client/components/file-manager/CardTile.md §2.2
 */
const badgeBaseStyles = {
  width: 28,
  height: 28,
  borderRadius: '50%',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: 'none',
  p: 0,
  bgcolor: (theme) => alpha(theme.palette.common.black, 0.45),
  color: 'common.white',
  '& .MuiSvgIcon-root': { fontSize: 16 },
};

const buttonBadgeStyles = {
  ...badgeBaseStyles,
  cursor: 'pointer',
  '&:hover': {
    bgcolor: (theme) => alpha(theme.palette.common.black, 0.6),
  },
};

const TileCornerBadge = ({ title = null, onClick = null, children, tone = null, ...other }) => {
  const toneSx = tone ? { bgcolor: tone, '&:hover': { bgcolor: tone } } : null;
  const badge = onClick ? (
    <Box
      component="button"
      type="button"
      sx={tone ? { ...buttonBadgeStyles, ...toneSx } : buttonBadgeStyles}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      {...other}
    >
      {children}
    </Box>
  ) : (
    <Box component="span" sx={tone ? { ...badgeBaseStyles, ...toneSx } : badgeBaseStyles} {...other}>
      {children}
    </Box>
  );
  return title ? <Tooltip title={title}>{badge}</Tooltip> : badge;
};

export default TileCornerBadge;
