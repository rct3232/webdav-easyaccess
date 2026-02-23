import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  TextField,
  InputAdornment,
  IconButton,
} from '@mui/material';
import {
  Search as SearchIcon,
  Close as CloseIcon,
} from '@mui/icons-material';

const FAB_SIZE = 56;
const FAB_GAP = 12;
const MOBILE_OFFSET = 16;
const DESKTOP_OFFSET = 48;

// matte frosted interior with solid border (FAB palette - avoids abrupt gradient at pill ends)
const getFrostedStyle = (focused) => ({
  position: 'absolute',
  inset: 0,
  borderRadius: 9999,
  border: '2px solid #52c597',
  display: 'flex',
  backgroundColor: focused ? 'rgba(255, 255, 255, 0.85)' : 'rgba(255, 255, 255, 0.5)',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  transition: 'background-color 0.2s ease',
});

const FloatingSearchBar = ({
  searchQuery,
  setSearchQuery,
  isMobile,
  placeholder,
  fabVisible = true,
}) => {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const offset = isMobile ? MOBILE_OFFSET : DESKTOP_OFFSET;
  const rightEdge = fabVisible ? offset + FAB_SIZE + FAB_GAP : offset;

  return (
    <Box
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
        <Box sx={getFrostedStyle(focused)}>
          <TextField
            size="small"
            fullWidth
            placeholder={placeholder ?? t('nav.searchPlaceholder')}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
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
            <InputAdornment position="start">
              <SearchIcon sx={{ color: 'text.secondary' }} />
            </InputAdornment>
          ),
          endAdornment: searchQuery ? (
            <InputAdornment position="end">
              <IconButton
                size="small"
                onClick={() => setSearchQuery('')}
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
    </Box>
  );
};

export default FloatingSearchBar;
