import React from 'react';
import { Box, CardMedia } from '@mui/material';
import { getFileIcon } from '../../utils/fileIconUtils';

/**
 * PreviewTile — one grid-view-styled preview cell.
 *
 * Shared by the collection card 2×2 preview and the merge detail's shared-file
 * strip so both use the grid view's `grey.100` media background, divider
 * border, and theme radius.
 */
const baseSx = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
  minHeight: 0,
  width: '100%',
  height: '100%',
  overflow: 'hidden',
  bgcolor: 'grey.100',
  border: '1px solid',
  borderColor: 'divider',
  borderRadius: 1,
};

const PreviewTile = ({ item, thumbnailMap = null, testId, iconFontSize = 28, sx, ...boxProps }) => {
  const thumbnailUrl = item?.node_id != null ? thumbnailMap?.get(item.node_id) : null;
  const tileSx = {
    ...baseSx,
    '& .MuiSvgIcon-root': { fontSize: iconFontSize, color: 'text.secondary' },
  };

  return (
    <Box
      data-file-node-id={item?.node_id}
      data-testid={testId}
      sx={sx ? [tileSx, sx] : tileSx}
      {...boxProps}
    >
      {thumbnailUrl ? (
        <CardMedia
          component="img"
          image={thumbnailUrl}
          alt={item.name ?? ''}
          sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />
      ) : (
        getFileIcon({ type: item?.type, mime: item?.mime ?? undefined, basename: item?.name })
      )}
    </Box>
  );
};

export default PreviewTile;
