import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, TextField, InputAdornment, IconButton } from '@mui/material';
import { Search as SearchIcon, Close as CloseIcon } from '@mui/icons-material';
import SearchActionButton from './SearchActionButton';

const FAB_SIZE = 56;
const FAB_GAP = 12;
const MOBILE_OFFSET = 16;
const DESKTOP_OFFSET = 48;
const START_ICON_WIDTH = 32;
// Keep in sync with SearchActionButton fabSlotOut duration (exit animation must
// finish before the button leaves the DOM).
const BUTTON_EXIT_ANIMATION_MS = 220;

// matte frosted interior with solid border (FAB palette - avoids abrupt gradient at pill ends)
const getFrostedStyle = (expanded) => ({
  position: 'absolute',
  inset: 0,
  borderRadius: 9999,
  border: '2px solid #52c597',
  display: 'flex',
  backgroundColor: expanded ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.5)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  transition: 'background-color 0.2s ease',
});

/**
 * FloatingSearchBar — the pill stays in place; on expand (focus, results mode or
 * filter text) its start icon fades into the input area and the FAB's exact spot
 * morphs into the 56px ghost submit button (SearchActionButton). There is NO
 * submit control inside the pill; Enter and the button both emit `onSubmitQuery`.
 * ✕ clears the text AND blurs: in browse mode that collapses the visuals, in
 * results mode the cleared text is the host's exit signal (the bar stays IO-free).
 * `onExpandedChange` reports the morph truth so the host can drive the FAB's
 * controlled-mount swap; it is false whenever there is no submit surface.
 * @see docs/spec/client/components/file-manager/FloatingSearchBar.md
 */
const FloatingSearchBar = ({
  searchQuery,
  setSearchQuery,
  isMobile,
  placeholder,
  fabVisible = true,
  onSubmitQuery,
  resultsModeActive = false,
  isPending = false,
  llmConfigured = false,
  onExpandedChange,
}) => {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef(null);
  const offset = isMobile ? MOBILE_OFFSET : DESKTOP_OFFSET;
  const rightEdge = fabVisible ? offset + FAB_SIZE + FAB_GAP : offset;

  // §2.5: collapse is gated on empty text AND browse mode.
  const expanded = focused || resultsModeActive || Boolean(searchQuery);
  const submitSurface = typeof onSubmitQuery === 'function';
  const morphActive = submitSurface && expanded;

  const [buttonMounted, setButtonMounted] = useState(morphActive);
  useEffect(() => {
    if (morphActive) {
      setButtonMounted(true);
      return undefined;
    }
    const timer = setTimeout(() => setButtonMounted(false), BUTTON_EXIT_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [morphActive]);

  const lastMorphRef = useRef(undefined);
  useEffect(() => {
    if (lastMorphRef.current === morphActive) return;
    lastMorphRef.current = morphActive;
    if (onExpandedChange) onExpandedChange(morphActive);
  });

  const handleClear = () => {
    setSearchQuery('');
    if (inputRef.current) inputRef.current.blur();
  };

  return (
    <Box
      data-testid="floating-search-bar"
      sx={{
        position: 'fixed',
        bottom: offset,
        left: isMobile ? offset : 'auto',
        right: rightEdge,
        width: isMobile ? undefined : 300,
        zIndex: 1045,
        paddingBottom: 'env(safe-area-inset-bottom)',
        transition: 'right 0.25s ease-out',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          height: FAB_SIZE,
          width: '100%',
          boxShadow: (theme) => theme.shadows[4],
          borderRadius: 9999,
        }}
      >
        <Box sx={getFrostedStyle(expanded)}>
          <TextField
            size="small"
            fullWidth
            type="search"
            placeholder={placeholder ?? t('nav.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(e) => {
              // §2.7: Enter submits through onSubmitQuery; every keystroke still
              // routes through setSearchQuery only.
              if (e.key === 'Enter' && submitSurface) {
                onSubmitQuery(searchQuery);
              }
            }}
            inputProps={{ ref: inputRef }}
            InputProps={{
              sx: {
                height: '100%',
                minHeight: 0,
                borderRadius: 9999,
                backgroundColor: 'transparent',
                color: 'text.primary',
                '& fieldset': {
                  border: 'none',
                },
                '& input': {
                  backgroundColor: 'transparent',
                  '&::placeholder': {
                    opacity: 0.8,
                  },
                },
              },
              startAdornment: (
                <InputAdornment position="start" sx={{ mr: 0, ml: 0 }}>
                  <Box
                    data-testid="search-start-icon"
                    sx={{
                      boxSizing: 'border-box',
                      width: expanded ? 0 : START_ICON_WIDTH,
                      pr: 1,
                      opacity: expanded ? 0 : 1,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      flexShrink: 0,
                      transition: 'width 0.25s ease-out, opacity 0.2s ease',
                    }}
                  >
                    <SearchIcon sx={{ color: 'text.secondary' }} />
                  </Box>
                </InputAdornment>
              ),
              endAdornment:
                searchQuery.length > 0 ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={handleClear}
                      onMouseDown={(e) => e.preventDefault()}
                      aria-label={t('nav.searchClose')}
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : null,
            }}
          />
        </Box>
      </Box>
      {buttonMounted && (
        <SearchActionButton
          visible={expanded}
          isMobile={isMobile}
          searchQuery={searchQuery}
          onSubmitQuery={onSubmitQuery}
          resultsModeActive={resultsModeActive}
          isPending={isPending}
          llmConfigured={llmConfigured}
        />
      )}
    </Box>
  );
};

export default FloatingSearchBar;
