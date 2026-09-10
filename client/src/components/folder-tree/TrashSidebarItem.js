import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { subscribeToTrashChanged } from '../../services/trashNotifier';

/**
 * Two-path trash SVG icon (lid + can body) so the lid can rotate independently
 * of the body. One-shot animation (lid open -> close, color flash default ->
 * error.main -> default, ~1.2s) is declared with MUI sx keyframes only (no
 * styled-components) and restarts per pulse via the pulse-key remount.
 */
const TrashSidebarIcon = ({ pulse }) => {
  const theme = useTheme();
  const animating = pulse > 0;
  return (
    <Box
      component="svg"
      viewBox="0 0 24 24"
      data-testid="sidebar-trash-icon"
      aria-hidden="true"
      key={animating ? `trash-pulse-${pulse}` : 'trash-static'}
      sx={{
        width: 22,
        height: 22,
        display: 'block',
        ...(animating && {
          animation: 'trash-flash 1.2s ease 1',
          '& .trash-lid': {
            transformBox: 'view-box',
            transformOrigin: '12px 6px',
            animation: 'trash-lid 1.2s ease 1',
          },
          '@keyframes trash-flash': {
            '0%,100%': { color: 'inherit' },
            '35%': { color: theme.palette.error.main },
          },
          '@keyframes trash-lid': {
            '0%': { transform: 'rotate(0deg)' },
            '20%': { transform: 'rotate(-38deg)' },
            '55%': { transform: 'rotate(-38deg)' },
            '100%': { transform: 'rotate(0deg)' },
          },
        }),
      }}
    >
      {/* Lid: hinge bar + handle (two subpaths, independently rotatable) */}
      <path className="trash-lid" fill="currentColor" d="M4 5h16v1.8H4zM9.5 3h5v1.4h-5z" />
      {/* Can body */}
      <path
        fill="currentColor"
        d="M6.6 8.2h10.8l-.85 11.05a2 2 0 0 1-1.99 1.85H9.44a2 2 0 0 1-1.99-1.85L6.6 8.2z"
      />
    </Box>
  );
};

/**
 * Bottom-pinned sidebar trash entry (DEF-16 P9). Not a tree section: no
 * expansion, no DnD, no children. Selected styling mirrors BaseFolderTreeItem.
 */
const TrashSidebarItem = ({ currentPath = '', onTrashClick }) => {
  const { t } = useTranslation();
  const [pulse, setPulse] = useState(0);

  useEffect(
    () =>
      subscribeToTrashChanged(() => {
        setPulse((prev) => prev + 1);
      }),
    []
  );

  const isSelected = currentPath === '/__trash__';

  return (
    <ListItem
      data-testid="sidebar-trash"
      disablePadding
      sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
    >
      <ListItemButton
        onClick={onTrashClick}
        selected={isSelected}
        sx={{
          py: 0.5,
          minHeight: 44,
          transition: 'all 0.2s',
          '&.Mui-selected': {
            backgroundColor: 'transparent',
            color: 'primary.main',
            borderLeft: '3px solid',
            borderLeftColor: 'primary.main',
            '&:hover': {
              backgroundColor: 'action.hover',
            },
            '& .MuiListItemIcon-root': {
              color: 'primary.main',
            },
          },
        }}
      >
        <ListItemIcon sx={{ minWidth: 32 }}>
          <TrashSidebarIcon pulse={pulse} />
        </ListItemIcon>
        <ListItemText
          primary={
            <Typography
              variant="body2"
              component="span"
              sx={{
                fontSize: '0.875rem',
                fontWeight: isSelected ? 700 : 400,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'block',
              }}
            >
              {t('nav.trash')}
            </Typography>
          }
          sx={{ minWidth: 0, overflow: 'hidden' }}
        />
      </ListItemButton>
    </ListItem>
  );
};

export default TrashSidebarItem;
