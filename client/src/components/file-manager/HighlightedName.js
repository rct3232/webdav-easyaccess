import React from 'react';
import { Box } from '@mui/material';
import { applyHighlightRanges, computeHighlightRanges } from '../../utils/searchHighlight';

/**
 * HighlightedName — the shared two-color highlight segment renderer (the
 * `HighlightedName` idiom of the retired P0 results overlay, moved to a shared
 * place for the row name slots). Renders `applyHighlightRanges` segments as
 * inline marks inside the CALLER'S existing name Typography: `kind:'committed'`
 * segments in the secondary.light color (`data-testid="search-highlight-range"`)
 * and `kind:'live'` segments in the theme `highlight` yellow token
 * (`data-testid="filter-highlight-range"`); plain segments stay bare text, so a
 * row without highlights renders byte-identical (zero DOM delta).
 *
 * Ranges arrive computed against the FULL name; the row renders the
 * `pixelMiddleTruncate` output, so each range's matched text is re-searched
 * inside the rendered string here (highlights are cosmetic-only — fragments
 * swallowed by the middle ellipsis simply render unhighlighted).
 *
 * @see docs/spec/client/utils/searchHighlight.md §2.3
 */

const KIND_COMMITTED = 'committed';
const KIND_LIVE = 'live';

const RANGE_RENDER = {
  [KIND_COMMITTED]: {
    testId: 'search-highlight-range',
    backgroundColor: 'secondary.light',
  },
  [KIND_LIVE]: {
    testId: 'filter-highlight-range',
    backgroundColor: 'highlight.main',
  },
};

/**
 * Re-locate full-name ranges onto the rendered (possibly truncated) string by
 * re-matching each range's matched text within it.
 */
function relocateRanges(fullName, renderedName, ranges) {
  if (!Array.isArray(ranges) || ranges.length === 0) return [];
  if (renderedName === fullName) return ranges;

  const termsByKind = { [KIND_COMMITTED]: [], [KIND_LIVE]: [] };
  for (const range of ranges) {
    const kind = range?.kind === KIND_LIVE ? KIND_LIVE : KIND_COMMITTED;
    const term = String(fullName ?? '').slice(range?.start, range?.end);
    if (term) termsByKind[kind].push(term);
  }
  return [
    ...computeHighlightRanges(renderedName, termsByKind[KIND_COMMITTED], KIND_COMMITTED),
    ...computeHighlightRanges(renderedName, termsByKind[KIND_LIVE], KIND_LIVE),
  ];
}

const HighlightedName = ({ name, display, highlights }) => {
  const fullName = typeof name === 'string' ? name : '';
  const renderedName = typeof display === 'string' ? display : fullName;
  const segments = applyHighlightRanges(
    renderedName,
    relocateRanges(fullName, renderedName, highlights)
  );

  return (
    <>
      {segments.map((segment, index) =>
        segment.kind ? (
          <Box
            key={index}
            component="mark"
            data-testid={RANGE_RENDER[segment.kind].testId}
            sx={{
              backgroundColor: RANGE_RENDER[segment.kind].backgroundColor,
              color: 'inherit',
              borderRadius: 0.5,
              px: 0.25,
            }}
          >
            {segment.text}
          </Box>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        )
      )}
    </>
  );
};

export default HighlightedName;
