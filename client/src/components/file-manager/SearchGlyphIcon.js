import React from 'react';
import { Box } from '@mui/material';
import {
  Search as SearchIcon,
  AutoAwesome as AutoAwesomeIcon,
  Add as AddIcon,
  Cloud as CloudIcon,
} from '@mui/icons-material';

const CLOUD_SIZE = 24;
const OVERLAY_SIZE = 13;
const PLATE_SIZE = 18;

// Contrast cut-out plate: a small circular paper-background chip with a
// secondary border, readable on the frosted ghost fill and on the gradient
// hover alike (icon-overlay precedent MemberStateBadges.js — the overlay sits
// OUTSIDE the silhouette, never on top of it).
const plateSx = (offsetSide) => ({
  position: 'absolute',
  [offsetSide]: -3,
  top: -3,
  width: PLATE_SIZE,
  height: PLATE_SIZE,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  backgroundColor: 'background.paper',
  color: 'secondary.main',
  border: '1px solid',
  borderColor: 'secondary.main',
});

/**
 * SearchGlyphIcon — the composite cloud+search / cloud+wand glyph shared by
 * the fab-slot submit button (SearchActionButton) and the Zone B results
 * header (FileManagerView). Single source for the composite geometry:
 * FloatingSearchBar.md §2.6 — the 13px overlay renders OUTSIDE the cloud
 * silhouette on a contrasting plate; the wand keeps its `scaleX(-1)` mirror
 * inside its own plate (the stack is never flipped); `showAdd` plates the
 * Add overlay at left (results mode + empty text).
 */
const SearchGlyphIcon = ({ llmConfigured = false, showAdd = false }) => (
  <Box
    component="span"
    sx={{
      position: 'relative',
      display: 'inline-flex',
      width: CLOUD_SIZE,
      height: CLOUD_SIZE,
      flexShrink: 0,
    }}
  >
    <CloudIcon data-testid="search-action-glyph-cloud" style={{ fontSize: CLOUD_SIZE }} />
    <Box data-testid="search-action-glyph-plate" sx={plateSx('right')}>
      {llmConfigured ? (
        <AutoAwesomeIcon
          data-testid="search-action-glyph-wand"
          style={{ fontSize: OVERLAY_SIZE, transform: 'scaleX(-1)' }}
        />
      ) : (
        <SearchIcon data-testid="search-action-glyph-search" style={{ fontSize: OVERLAY_SIZE }} />
      )}
    </Box>
    {showAdd && (
      <Box data-testid="search-action-glyph-add-plate" sx={plateSx('left')}>
        <AddIcon data-testid="search-action-glyph-add" style={{ fontSize: OVERLAY_SIZE }} />
      </Box>
    )}
  </Box>
);

export default SearchGlyphIcon;
