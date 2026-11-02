import React from 'react';
import {
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import { pixelMiddleTruncate } from '../../utils/stringUtils';
import useObservedElementWidth from './hooks/useObservedElementWidth';

/**
 * Shared sidebar row primitive (docs/spec/client/components/folder-tree/TreeRow.md).
 * The single visual core of every folder-tree child row: depth-based padding
 * (pl = level * 2), the BaseFolderTreeItem icon geometry, observed-width middle
 * truncation, selected highlight, and slot seams for consumer behavior.
 * No drag/rename/expand STATE or controller logic lives here.
 */

const ROW_FONT = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';
// ListItemButton padding + icon columns + default right padding (~68px, +4px safety).
const RESERVED_ROW_CHROME_PX = 72;

const buttonBaseSx = {
  py: 0.5,
  minHeight: 32,
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
};

const textBaseSx = { minWidth: 0, overflow: 'hidden' };

const nameBaseSx = {
  fontSize: '0.875rem',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  display: 'block',
};

const TreeRow = ({
  level = 0,
  name,
  onClick,
  selected = false,
  disabled = false,
  leading,
  icon,
  iconProps,
  secondary,
  trailing,
  textSx,
  buttonProps,
  buttonSx,
  listItemProps,
}) => {
  const { setObservedElement, width: rowWidth } = useObservedElementWidth(200);

  const maxPixelWidth = Math.max(40, rowWidth - RESERVED_ROW_CHROME_PX);
  const displayName = pixelMiddleTruncate(name ?? '', maxPixelWidth, ROW_FONT);
  const isTruncated = displayName !== (name ?? '');

  const { sx: iconSx, ...iconRest } = iconProps ?? {};

  const nameCell = (
    <Tooltip title={isTruncated ? name : ''} disableInteractive enterDelay={300}>
      <Typography
        variant="body2"
        component="span"
        sx={{ ...nameBaseSx, fontWeight: selected ? 700 : 400 }}
      >
        {displayName}
      </Typography>
    </Tooltip>
  );

  return (
    <ListItem disablePadding ref={setObservedElement} {...listItemProps}>
      <ListItemButton
        data-tree-row="true"
        onClick={disabled ? undefined : onClick}
        selected={selected}
        disabled={disabled}
        sx={{ ...buttonBaseSx, pl: level * 2, ...buttonSx }}
        {...buttonProps}
      >
        {leading != null && <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>{leading}</ListItemIcon>}
        {icon != null && (
          <ListItemIcon
            {...iconRest}
            sx={{ minWidth: 24, ...(leading == null && { mr: 0.5 }), ...iconSx }}
          >
            {icon}
          </ListItemIcon>
        )}
        <ListItemText sx={{ ...textBaseSx, ...textSx }} primary={nameCell} secondary={secondary} />
        {trailing}
      </ListItemButton>
    </ListItem>
  );
};

// 20px leading-column spacer that BaseFolderTreeItem reserves for non-expandable
// rows; sidebar child rows (recent/collections) render it so icon columns align
// across all tree surfaces (owner ruling A, 2026-10-01).
export const TreeRowSpacer = () => <span style={{ width: 20 }} />;

export default TreeRow;
