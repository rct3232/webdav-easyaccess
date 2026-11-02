import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, IconButton, Typography } from '@mui/material';
import {
  BookmarkAdd as BookmarkAddIcon,
  ChevronRight as ChevronRightIcon,
  Close as CloseIcon,
  LibraryAdd as LibraryAddIcon,
  Undo as UndoIcon,
} from '@mui/icons-material';
import { pixelMiddleTruncate } from '../../utils/stringUtils';

/**
 * SearchQueryChipBar — the results-mode chip strip that REPLACES the breadcrumb
 * row while search results are active (docs/spec/client/components/
 * file-manager/SearchQueryChipBar.md): one breadcrumb-styled chip per committed
 * chain term (oldest→newest), hover/tap-revealed `Undo` per non-current chip,
 * `Exit` on the single chip, the save affordance (`Save as collection`, §2.4a —
 * rendered only when the host passes `onSave`, which encodes the §2.6 gate)
 * and a `LibraryAdd` button (desktop strip right edge, mobile expand-toggle
 * slot) targeting the FULL current snapshot. IO-free: renders from props and
 * emits host intents only — revert/exit are snapshot operations decided by
 * `useSearchResults`.
 */

const CHIP_NAME_BUDGET_PX = 140;
const CHIP_NAME_FONT = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
// Minimum revealed width fits the widest reveal label (`돌아가기`) + its icon.
const REVEAL_MIN_WIDTH_PX = 110;

const SearchQueryChipBar = ({
  terms = [],
  isMobile = false,
  inExpandSlot = false,
  onRevertToStep,
  onExit,
  onLibraryAdd,
  onSave,
}) => {
  const { t } = useTranslation();
  const [hoveredIndex, setHoveredIndex] = useState(null);
  const [revealedIndex, setRevealedIndex] = useState(null);

  const count = terms.length;
  if (count === 0) return null;

  const isActionable = (index) => count === 1 || index < count - 1;

  const isRevealed = (index) =>
    isActionable(index) && (isMobile ? revealedIndex === index : hoveredIndex === index);

  const activate = (index) => {
    setRevealedIndex(null);
    setHoveredIndex(null);
    if (count === 1) {
      onExit?.();
      return;
    }
    onRevertToStep?.(index);
  };

  const handleChipClick = (index) => {
    if (!isMobile || !isActionable(index)) return;
    if (revealedIndex === index) {
      activate(index);
    } else {
      setRevealedIndex(index);
    }
  };

  const renderAction = (index) => {
    const single = count === 1;
    const testId = single ? 'search-chip-exit' : 'search-chip-undo';
    return (
      <Box
        data-testid={testId}
        sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: REVEAL_MIN_WIDTH_PX }}
        onClick={(event) => {
          if (!isMobile) {
            event.stopPropagation();
            activate(index);
          }
        }}
      >
        <Box data-testid="search-chip-action" sx={{ display: 'contents' }}>
          {single ? <CloseIcon fontSize="small" /> : <UndoIcon fontSize="small" />}
          <span>{single ? t('fileManager.searchChipExit') : t('fileManager.searchChipUndo')}</span>
        </Box>
      </Box>
    );
  };

  return (
    <Box
      data-testid="search-chip-bar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        py: 1,
        px: 2,
        backgroundColor: 'background.paper',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          overflowX: 'auto',
          flex: 1,
          '&::-webkit-scrollbar': { display: 'none' },
          scrollbarWidth: 'none',
        }}
      >
        {terms.map((term, index) => (
          <React.Fragment key={`${index}:${term}`}>
            {index > 0 && (
              <ChevronRightIcon sx={{ mx: 0.5, color: 'text.secondary', flexShrink: 0 }} />
            )}
            <Chip
              data-testid="search-chip"
              label={
                isRevealed(index) ? (
                  renderAction(index)
                ) : (
                  <Typography
                    variant="body2"
                    component="span"
                    sx={{ fontWeight: index === count - 1 ? 600 : 400 }}
                  >
                    {pixelMiddleTruncate(String(term ?? ''), CHIP_NAME_BUDGET_PX, CHIP_NAME_FONT)}
                  </Typography>
                )
              }
              clickable={isActionable(index)}
              onClick={() => handleChipClick(index)}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              sx={{
                minHeight: 44,
                fontSize: '0.875rem',
                flexShrink: 0,
                ...(isRevealed(index) ? { minWidth: REVEAL_MIN_WIDTH_PX } : {}),
              }}
            />
          </React.Fragment>
        ))}
      </Box>

      {onSave && (
        <IconButton
          data-testid="search-chip-save"
          aria-label={t('fileManager.searchSaveCollection')}
          onClick={() => onSave()}
          sx={{
            mr: 0.5,
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: '16px',
            color: 'primary.main',
            backgroundColor: (theme) => theme.palette.action.hover,
          }}
        >
          <BookmarkAddIcon fontSize="small" />
        </IconButton>
      )}
      <IconButton
        data-testid="search-library-add"
        aria-label={t('fileManager.searchLibraryAdd')}
        onClick={(event) => onLibraryAdd?.(event.currentTarget)}
        sx={{
          ml: 1,
          flexShrink: 0,
          width: 44,
          height: 44,
          borderRadius: '16px',
          color: 'primary.main',
          backgroundColor: (theme) => (inExpandSlot ? 'transparent' : theme.palette.action.hover),
        }}
      >
        <LibraryAddIcon fontSize="small" />
      </IconButton>
    </Box>
  );
};

export default SearchQueryChipBar;
