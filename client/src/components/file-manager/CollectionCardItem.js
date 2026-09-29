import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, CardMedia, Chip, IconButton, Typography } from '@mui/material';
import {
  Checkroom as SharedChipIcon,
  MoreVert as MoreVertIcon,
  PushPin as PushPinIcon,
} from '@mui/icons-material';
import { getFileIcon, getFileIconForGrid } from '../../utils/fileIconUtils';
import { getCollectionEntryKey } from '../../utils/fileViewUtils';
import { useLongPress } from '../../hooks/useLongPress';
import { useLongPressSelect } from './hooks/useLongPressSelect';
import CardTile from './CardTile';

/**
 * CollectionCardItem — grid-parity collection card (P-3): the shared CardTile
 * shell whose media area is the 2×2 preview of the newest-added members
 * (`preview_items`: icon immediately, swapped to a batched thumbnail once the
 * shell's preview map gains the node id — NO filename labels), footer = name +
 * count/status/pin chips. Click semantics are dispatched, never decided here
 * (single=select / double=open / tap=open / long-press=select is shell-owned).
 * @see docs/spec/client/components/file-manager/CollectionsListView.md §2.4
 */
const PREVIEW_CAP = 4;

const previewGridStyles = {
  width: '100%',
  height: '100%',
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gridTemplateRows: 'repeat(2, 1fr)',
  gap: 0.5,
  p: 0.5,
};

const previewCellStyles = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
  '& .MuiSvgIcon-root': { fontSize: 28, color: 'text.secondary' },
};

const moreButtonStyles = {
  position: 'absolute',
  top: 4,
  right: 4,
  zIndex: 1,
  width: 44,
  height: 44,
};

const CollectionCardItem = ({
  collection,
  isSelected = false,
  selectionMode = false,
  isMobile = false,
  previewThumbnails = null,
  onCardClick,
  onCardLongPressSelect,
  onMoreClick,
  onCardAction,
}) => {
  const { t } = useTranslation();

  const { isLongPressEnabled, onLongPressSelect } = useLongPressSelect({
    isMobile,
    selectionMode,
    onLongPressSelect: onCardLongPressSelect,
  });

  const {
    onTouchStart,
    onTouchEnd,
    onTouchMove,
    onMouseDown,
    onMouseUp,
    onMouseLeave,
    wasLongPress,
  } = useLongPress(() => {
    if (onLongPressSelect) {
      onLongPressSelect(collection);
    }
  });

  const isViewer = collection.granted_role != null;
  const isArchived = collection.status === 'archived';
  const previews = (collection.preview_items ?? []).slice(0, PREVIEW_CAP);

  const media =
    previews.length > 0 ? (
      <Box sx={previewGridStyles}>
        {previews.map((item) => {
          const thumbnailUrl = previewThumbnails?.get(item.node_id);
          return (
            <Box
              key={item.node_id}
              data-file-node-id={item.node_id}
              data-testid={`collection-preview-${item.node_id}`}
              sx={previewCellStyles}
            >
              {thumbnailUrl ? (
                <CardMedia
                  component="img"
                  image={thumbnailUrl}
                  alt={item.name ?? ''}
                  sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
              ) : (
                getFileIcon({ type: item.type, mime: item.mime ?? undefined, basename: item.name })
              )}
            </Box>
          );
        })}
      </Box>
    ) : (
      getFileIconForGrid({ type: 'directory' })
    );

  const moreAction = !selectionMode ? (
    <IconButton
      size="small"
      data-testid={`card-menu-button-${collection.collection_id}`}
      aria-label={t('fileManager.fileActions')}
      sx={moreButtonStyles}
      onClick={(e) => {
        e.stopPropagation();
        onMoreClick?.(collection, e.currentTarget);
      }}
      onTouchStart={(e) => e.stopPropagation()}
    >
      <MoreVertIcon fontSize="small" />
    </IconButton>
  ) : null;

  const footer = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 0.5,
        width: '100%',
        minWidth: 0,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 'medium', minWidth: 0 }} noWrap>
          {collection.name}
        </Typography>
        {isViewer && (
          <Box component="span" data-testid={`card-shared-chip-${collection.collection_id}`}>
            <SharedChipIcon fontSize="small" color="action" />
          </Box>
        )}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Typography variant="caption" color="text.secondary">
          {t('fileManager.collectionsItemCount', { count: collection.item_count })}
        </Typography>
        {isArchived && (
          <Chip
            size="small"
            label={t('fileManager.collectionsStatusArchived')}
            data-testid={`card-status-chip-${collection.collection_id}`}
          />
        )}
        {collection.pinned_by === 'auto' && (
          <Chip
            size="small"
            variant="outlined"
            data-testid={`card-autopin-chip-${collection.collection_id}`}
            label={t('fileManager.collectionsAutoPin')}
            onDelete={() => onCardAction?.('unpin', collection)}
            deleteIcon={
              <Box
                component="span"
                role="button"
                data-testid={`card-autopin-unpin-${collection.collection_id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onCardAction?.('unpin', collection);
                }}
                aria-label={t('fileManager.collectionsAutoPinUnpin')}
                sx={{ display: 'inline-flex', cursor: 'pointer' }}
              >
                <PushPinIcon fontSize="inherit" />
              </Box>
            }
          />
        )}
      </Box>
    </Box>
  );

  return (
    <Box
      data-testid={`collection-card-${collection.collection_id}`}
      data-file-path={getCollectionEntryKey(collection.collection_id)}
      {...(isLongPressEnabled
        ? { onTouchStart, onTouchEnd, onTouchMove, onMouseDown, onMouseUp, onMouseLeave }
        : {})}
      onClick={(e) => {
        if (wasLongPress()) return;
        onCardClick?.(collection, e);
      }}
      sx={{ height: '100%', minWidth: 0 }}
    >
      <CardTile
        media={media}
        moreAction={moreAction}
        footer={footer}
        isSelected={isSelected}
        selectionMode={selectionMode}
        isMobile={isMobile}
        cursor="pointer"
      />
    </Box>
  );
};

export default CollectionCardItem;
