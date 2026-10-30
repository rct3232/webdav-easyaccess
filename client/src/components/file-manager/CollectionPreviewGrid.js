import React from 'react';
import { Box } from '@mui/material';
import { Collections as CollectionsIcon } from '@mui/icons-material';
import PreviewTile from './PreviewTile';

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
          bgcolor: 'grey.100',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1,
        }}
      >
        <CollectionsIcon fontSize="large" color="action" />
      </Box>
    );
  }

  return (
    <Box sx={previewGridStyles}>
      {previews.map((item) => (
        <PreviewTile
          key={item.node_id}
          item={item}
          thumbnailMap={thumbnailMap}
          testId={`${testIdPrefix}-${item.node_id}`}
        />
      ))}
    </Box>
  );
};

export default CollectionPreviewGrid;
