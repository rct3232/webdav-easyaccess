import React from 'react';
import { TableRow, TableCell, Box, Typography, Tooltip, CircularProgress } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { MoreVert as MoreVertIcon } from '@mui/icons-material';
import { formatFileSize, formatDate } from '../../utils/format';
import { renderProcessingIcon } from '../../utils/fileViewUtils';
import { getFileIcon } from '../../utils/fileIconUtils';
import { pixelMiddleTruncate } from '../../utils/stringUtils';
import { useLongPress } from '../../hooks/useLongPress';
import { useLongPressSelect } from './hooks/useLongPressSelect';

const FileDetailRow = ({
  file,
  index,
  onFileClick,
  onMoreClick,
  showMoreButton,
  onLongPressSelect,
  onContextMenu,
  isDisabled,
  isProcessing,
  processingType,
  isPermissionDisabled,
  isDragging,
  isDropTarget,
  isSelected,
  selectionMode,
  isMobile,
  dragHandlers,
  dropHandlers,
  maxPixelWidth,
  font,
  t,
}) => {
  const { isLongPressEnabled, onLongPressSelect: onLongPressCallback } = useLongPressSelect({
    isMobile,
    selectionMode,
    onLongPressSelect,
  });

  const {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    wasLongPress,
  } = useLongPress((e) => {
    if (onLongPressCallback) {
      onLongPressCallback(file);
    }
  });

  const allowContextMenu = isPermissionDisabled && !isProcessing;
  const canOpenMenu = !isDisabled || allowContextMenu;

  return (
    <TableRow
      key={`${file.path}-${index}`}
      data-file-path={file.path}
      data-file-node-id={file.nodeId}
      {...dragHandlers}
      {...dropHandlers}
      {...(isLongPressEnabled ? {
        onTouchStart,
        onTouchEnd,
        onTouchMove,
        onMouseDown,
        onMouseUp,
        onMouseLeave,
      } : {})}
      hover={!isDisabled}
      sx={{
        cursor: isDisabled ? 'not-allowed' : (isMobile ? 'pointer' : (selectionMode ? 'pointer' : 'move')),
        opacity: isDragging ? 0.5 : (isDisabled ? 0.4 : (file.isHidden ? 0.5 : 1)),
        backgroundColor: isDropTarget
          ? 'primary.main'
          : (selectionMode && isSelected ? (t_theme) => alpha(t_theme.palette.primary.main, 0.12) : 'transparent'),
        ...(selectionMode && isSelected && !isDropTarget && {
          '&:hover': {
            backgroundColor: (t_theme) => alpha(t_theme.palette.primary.main, 0.2),
          },
        }),
        transition: 'all 0.2s',
        borderBottom: '1px solid',
        borderColor: 'divider',
        color: isDisabled ? 'text.disabled' : (isDropTarget ? 'white' : 'inherit'),
        position: 'relative',
        height: '40px',
        '& > td': {
          py: 0.5,
        },
        ...(isDropTarget && {
          '& .MuiSvgIcon-root': {
            color: 'white',
          },
          '& .MuiTypography-root': {
            color: 'white',
          },
        }),
        ...(isMobile && {
          userSelect: 'none',
          WebkitUserSelect: 'none',
          MozUserSelect: 'none',
          msUserSelect: 'none',
          WebkitTouchCallout: 'none',
          touchAction: 'manipulation',
        }),
      }}
      onClick={(e) => {
        if (wasLongPress()) return;
        if (!isDisabled) {
          onFileClick(file, e);
        }
      }}
      onContextMenu={(e) => {
        if (canOpenMenu) {
          onContextMenu(e, file);
        }
      }}
    >
      <TableCell
        sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '1.25rem' }}>
          {getFileIcon(file)}
          {(() => {
            const originalName = file.basename;
            const truncatedName = pixelMiddleTruncate(originalName, maxPixelWidth, font);
            const isTruncated = truncatedName !== originalName;

            const typography = (
              <Typography variant="body2" sx={{ fontSize: '0.875rem', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                {truncatedName}
              </Typography>
            );

            return isTruncated ? (
              <Tooltip title={originalName} disableInteractive>
                {typography}
              </Tooltip>
            ) : typography;
          })()}
        </Box>
      </TableCell>
      <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
          {file.type === 'directory' ? t('actions.folder') : file.mime || '-'}
        </Typography>
      </TableCell>
      <TableCell align="right" sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
          {file.type === 'directory' ? '-' : formatFileSize(file.size)}
        </Typography>
      </TableCell>
      <TableCell sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="body2" sx={{ fontSize: '0.8125rem' }}>
          {formatDate(file.lastmod)}
        </Typography>
      </TableCell>
      <TableCell align="right" sx={{ borderBottom: '1px solid', borderColor: 'divider', width: 48, px: 0.5 }}>
        {(showMoreButton ?? !selectionMode) && onMoreClick && (
          <Box
            component="button"
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMoreClick(file, e);
            }}
            onTouchStart={(e) => e.stopPropagation()}
            onTouchEnd={(e) => {
              e.stopPropagation();
              if (e.cancelable) e.preventDefault();
              onMoreClick(file, e);
            }}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 0.5,
              minWidth: 44,
              minHeight: 44,
              border: 'none',
              borderRadius: '50%',
              background: 'transparent',
              cursor: 'pointer',
              color: 'inherit',
            }}
            aria-label="More actions"
          >
            <MoreVertIcon fontSize="small" />
          </Box>
        )}
      </TableCell>
      {isProcessing && (
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            pr: 2,
            pointerEvents: 'none',
          }}
        >
          <CircularProgress size={16} thickness={5} />
          <Box sx={{ ml: 0.5 }}>
            {renderProcessingIcon(processingType)}
          </Box>
        </Box>
      )}
    </TableRow>
  );
};

export default React.memo(FileDetailRow);
