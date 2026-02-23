import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, IconButton, Typography } from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import { PageHeaderContext } from '../../contexts/PageHeaderContext';

/**
 * Common wrapper for MyPage content: padding, overflow scroll.
 * Unified header row: [Back slot 40px] [Title] [Action buttons].
 * Back slot: Back button when onBack provided; category icon when not.
 */
const MyPageContentPanel = ({ children, onBack, categoryIcon: CategoryIcon }) => {
  const { t } = useTranslation();
  const [title, setTitleState] = useState('');
  const [actions, setActionsState] = useState(null);

  const setTitle = useCallback((val) => setTitleState(val ?? ''), []);
  const setActions = useCallback((a) => setActionsState(a ?? null), []);

  const headerValue = {
    title,
    actions,
    setTitle,
    setActions,
  };

  return (
    <PageHeaderContext.Provider value={headerValue}>
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          minHeight: 0,
          py: 3,
          px: 0,
        }}
      >
        {/* Fixed header */}
        <Box
          sx={{
            maxWidth: 560,
            width: '100%',
            mx: 'auto',
            flexShrink: 0,
            px: 2,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              minHeight: 40,
              mb: 1,
            }}
          >
            <Box
              sx={{
                width: 40,
                height: 40,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
              }}
            >
              {onBack ? (
                <IconButton
                  onClick={onBack}
                  color="inherit"
                  size="medium"
                  aria-label={t('common.back')}
                >
                  <ArrowBackIcon />
                </IconButton>
              ) : CategoryIcon ? (
                <CategoryIcon sx={{ fontSize: 24, color: 'action.active' }} />
              ) : null}
            </Box>
            <Typography
              variant="h6"
              sx={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {title}
            </Typography>
            <Box sx={{ flexShrink: 0 }}>{actions}</Box>
          </Box>
        </Box>
        {/* Scrollable content only */}
        <Box
          data-testid="mypage-content-scroll"
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            WebkitOverflowScrolling: 'touch',
          }}
        >
          <Box
            sx={{
              maxWidth: 560,
              width: '100%',
              mx: 'auto',
              px: 2,
            }}
          >
            {children}
          </Box>
        </Box>
      </Box>
    </PageHeaderContext.Provider>
  );
};

export default MyPageContentPanel;
