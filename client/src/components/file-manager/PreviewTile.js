import React from 'react';
import { Box, CardMedia } from '@mui/material';
import { getFileIcon } from '../../utils/fileIconUtils';

/**
 * PreviewTile — one transparent preview cell (thumbnail or file-type icon).
 *
 * Shared by the collection card 2×2 preview and the merge detail's shared-file
 * strip. The grey.100 surface/border belongs to the CONTAINER (the collection
 * card media area or the merge detail's side frame), never to the cell.
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
