import React from 'react';
import { Box, CardMedia } from '@mui/material';
import { Collections as CollectionsIcon } from '@mui/icons-material';
import { getFileIcon } from '../../utils/fileIconUtils';

/**
 * CollectionPreviewGrid — the shared 2×2 collection-card media preview.
 *
 * The collection grid cards and the merge-detail panel render the SAME
 * newest-added `preview_items` here: icon first, thumbnail swap when the
 * shell-held map gains the node id, and NO member filename labels.
 * @see docs/spec/client/components/file-manager/CollectionsListView.md §2.4
 * @see docs/spec/client/components/file-manager/MergeProposalCard.md §2.5
 */
const PREVIEW_CAP = 4;

const previewGridStyles = {
  width: '100%',
  height: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gridTemplateRows: 'repeat(2, 1fr)',
  gap: 0.5,
  p: 0.5,
};

const previewCellStyles = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  '& .MuiSvgIcon-root': { fontSize: 28, color: 'text.secondary' },
};

const CollectionPreviewGrid = ({
  items = [],
  thumbnailMap = null,
  testIdPrefix = 'collection-preview',
  emptyTestId = 'collection-card-fallback',
}) => {
  const previews = (items ?? []).slice(0, PREVIEW_CAP);

  if (previews.length === 0) {
    return (
      <Box
        data-testid={emptyTestId}
        sx={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <CollectionsIcon fontSize="large" color="action" />
      </Box>
    );
  }

  return (
    <Box sx={previewGridStyles}>
      {previews.map((item) => {
        const thumbnailUrl = thumbnailMap?.get(item.node_id);
        return (
          <Box
            key={item.node_id}
            data-file-node-id={item.node_id}
            data-testid={`${testIdPrefix}-${item.node_id}`}
            sx={previewCellStyles}
          >
            {thumbnailUrl ? (
              <CardMedia
                component="img"
                image={thumbnailUrl}
                alt={item.name ?? ''}
                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : (
              getFileIcon({ type: item.type, mime: item.mime ?? undefined, basename: item.name })
            )}
          </Box>
        );
      })}
    </Box>
  );
};

export default CollectionPreviewGrid;
