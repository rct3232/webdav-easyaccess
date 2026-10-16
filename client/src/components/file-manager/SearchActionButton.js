import React from 'react';
import { useTranslation } from 'react-i18next';
import { Fab, Box } from '@mui/material';
import {
  Search as SearchIcon,
  AutoAwesome as AutoAwesomeIcon,
  Add as AddIcon,
  Cloud as CloudIcon,
} from '@mui/icons-material';
import { FAB_GRADIENT_BACKGROUND_HOVER } from './fabGradient';

const MOBILE_OFFSET = 16;
const DESKTOP_OFFSET = 48;
const BUTTON_SIZE = 56;
const GLYPH_SIZE = 24;
const OVERLAY_SIZE = 13;
const ORBIT_RADIUS = 7;

/**
 * SearchActionButton — the 56px ghost submit button that occupies the FAB's exact
 * spot while the search bar is expanded (focus / results mode / text present).
 * It IS the submit action (Enter mirrors it); the pill itself has no submit adornment.
 * Ghost look: 2px #52c597 border + frosted translucent fill like the pill interior;
 * hover = the original FAB gradient. Icon composites and the pending orbit follow
 * docs/spec/client/components/file-manager/FloatingSearchBar.md §2.6 — the 24px glyph
 * orbits a 7px-radius circle (counter-rotating keyframes keep it upright) while pending.
 * Mount/unmount lifecycle is the host bar's (it stays mounted for the exit animation);
 * `visible` only drives the animation direction and hit-testing.
 */
const SearchActionButton = ({
  visible,
  isMobile = false,
  searchQuery = '',
  onSubmitQuery,
  resultsModeActive = false,
  isPending = false,
  llmConfigured = false,
}) => {
  const { t } = useTranslation();
  const offset = isMobile ? MOBILE_OFFSET : DESKTOP_OFFSET;
  const resultsEmpty = resultsModeActive && !searchQuery;

  const handleClick = () => {
    if (typeof onSubmitQuery !== 'function') return;
    // §2.6: results mode with empty text is the owner-ruled no-op; every other
    // click submits the current value and the host decides what to do with it.
    if (resultsEmpty) return;
    onSubmitQuery(searchQuery);
  };

  const glyph = isPending ? (
    <Box
      data-testid="search-action-glyph-orbit"
      sx={{
        display: 'inline-flex',
        animation: 'searchGlyphOrbit 1.6s linear infinite',
        '@keyframes searchGlyphOrbit': {
          '0%': { transform: `rotate(0deg) translateX(${ORBIT_RADIUS}px) rotate(0deg)` },
          '100%': { transform: `rotate(360deg) translateX(${ORBIT_RADIUS}px) rotate(-360deg)` },
        },
      }}
    >
      {llmConfigured ? (
        <AutoAwesomeIcon
          data-testid="search-action-glyph-wand"
          style={{ fontSize: GLYPH_SIZE, transform: 'scaleX(-1)' }}
        />
      ) : (
        <SearchIcon data-testid="search-action-glyph-search" style={{ fontSize: GLYPH_SIZE }} />
      )}
    </Box>
  ) : (
    <Box
      component="span"
      sx={{ position: 'relative', display: 'inline-flex', width: GLYPH_SIZE, height: GLYPH_SIZE }}
    >
      <CloudIcon data-testid="search-action-glyph-cloud" style={{ fontSize: GLYPH_SIZE }} />
      {llmConfigured ? (
        <AutoAwesomeIcon
          data-testid="search-action-glyph-wand"
          style={{
            fontSize: OVERLAY_SIZE,
            position: 'absolute',
            left: 6,
            top: 8,
            transform: 'scaleX(-1)',
          }}
        />
      ) : (
        <SearchIcon
          data-testid="search-action-glyph-search"
          style={{ fontSize: OVERLAY_SIZE, position: 'absolute', left: 6, top: 8 }}
        />
      )}
      {resultsEmpty && (
        <AddIcon
          data-testid="search-action-glyph-add"
          style={{ fontSize: OVERLAY_SIZE, position: 'absolute', left: -4, top: 7 }}
        />
      )}
    </Box>
  );

  return (
    <Fab
      color="inherit"
      data-testid="search-action-button"
      aria-label={t('nav.searchSubmit')}
      onClick={handleClick}
      sx={{
        position: 'fixed',
        bottom: offset,
        right: offset,
        zIndex: 1050,
        paddingBottom: 'env(safe-area-inset-bottom)',
        width: BUTTON_SIZE,
        height: BUTTON_SIZE,
        border: '2px solid #52c597',
        backgroundColor: 'rgba(255, 255, 255, 0.5)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        color: 'secondary.main',
        animation: visible ? 'fabSlotIn 0.2s ease-out 0.14s both' : 'fabSlotOut 0.16s ease-in both',
        '@keyframes fabSlotIn': {
          from: { opacity: 0, transform: 'scale(0.6)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        '@keyframes fabSlotOut': {
          from: { opacity: 1, transform: 'scale(1)' },
          to: { opacity: 0, transform: 'scale(0.6)' },
        },
        pointerEvents: visible ? 'auto' : 'none',
        '&:hover': {
          background: FAB_GRADIENT_BACKGROUND_HOVER,
          color: 'common.white',
          backdropFilter: 'none',
          WebkitBackdropFilter: 'none',
        },
      }}
    >
      {glyph}
    </Fab>
  );
};

export default SearchActionButton;
