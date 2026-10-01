import React from 'react';
import { useTranslation } from 'react-i18next';
import { Box, CardMedia, IconButton, Typography } from '@mui/material';
import {
  FolderShared as FolderSharedIcon,
  MoreVert as MoreVertIcon,
  PushPin as PushPinIcon,
} from '@mui/icons-material';
import { getFileIcon, getFileIconForGrid } from '../../utils/fileIconUtils';
import { getCollectionEntryKey } from '../../utils/fileViewUtils';
import { useLongPress } from '../../hooks/useLongPress';
import { useLongPressSelect } from './hooks/useLongPressSelect';
import CardTile from './CardTile';
import TileCornerBadge from './TileCornerBadge';

/**
 * CollectionCardItem — grid-parity collection card (P-3): the shared CardTile
 * shell whose media area is the 2×2 preview of the newest-added members
 * (`preview_items`: icon immediately, swapped to a batched thumbnail once the
 * shell's preview map gains the node id — NO filename labels). Footer = name
 * only (M-1: member count removed, 2026-09-30); received/auto-pin markers are
 * TOP-LEFT MEDIA BADGES (M-4 — the footer chips and the `archived` status Chip
 * are retired; the autopin badge is a REAL unpin button). Click semantics are
 * dispatched, never decided here (single=select / double=open / tap=open /
 * long-press=select is shell-owned).
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
  const isAutoPinned = collection.pinned_by === 'auto';
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

  // M-4: received/shared and auto-pin markers are TOP-LEFT MEDIA BADGES (the
  // footer chips are retired). The autopin badge is a real button dispatching
  // the existing `unpin` card action; the preserved testids ride the badges.
  const cornerBadges =
    isViewer || isAutoPinned ? (
      <>
        {isViewer && (
          <TileCornerBadge
            title={t('nav.collectionsSharedChip')}
            aria-label={t('nav.collectionsSharedChip')}
            data-testid={`card-shared-chip-${collection.collection_id}`}
          >
            <FolderSharedIcon />
          </TileCornerBadge>
        )}
        {isAutoPinned && (
          <TileCornerBadge
            title={t('fileManager.collectionsAutoPin')}
            aria-label={t('fileManager.collectionsAutoPin')}
            data-testid={`card-autopin-chip-${collection.collection_id}`}
            onClick={() => onCardAction?.('unpin', collection)}
          >
            <Box
              component="span"
              data-testid={`card-autopin-unpin-${collection.collection_id}`}
              sx={{ display: 'inline-flex' }}
            >
              <PushPinIcon />
            </Box>
          </TileCornerBadge>
        )}
      </>
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
      <Typography variant="body2" sx={{ fontWeight: 'medium', minWidth: 0 }} noWrap>
        {collection.name}
      </Typography>
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
        cornerBadges={cornerBadges}
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
