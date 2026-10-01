import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Collapse,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  ChevronRight as ChevronRightIcon,
  Collections as CollectionsIcon,
  FolderShared as FolderSharedIcon,
  Inventory2 as ArchiveIcon,
  FavoriteBorder as LikesIcon,
  ExpandMore as ExpandMoreIcon,
} from '@mui/icons-material';
import TreeRow from './TreeRow';

const COLLECTION_ROUTE_PREFIX = '/__collections__/collection/';

/**
 * CollectionsSection — collapsible folder-tree section for the `__collections__`
 * virtual node (docs/spec/client/components/folder-tree/CollectionsSection.md).
 * Pure view: depth-1 flat rows (activity order as given — no re-sort), shared
 * icon chips, per-row `new` dots from props only, and the always-present
 * ArchiveNode row (§2.3 T0.4 zero-render decision). No services/notifier
 * imports — the controller prepares every prop (§2.5).
 */
const CollectionsSection = ({
  collectionsExpanded,
  onCollectionsToggle,
  onCollectionsClick,
  collections,
  currentPath,
  onCollectionClick,
  onArchiveClick,
  onLikesClick,
  newCollectionIds = [],
}) => {
  const { t } = useTranslation();

  const isHeaderSelected = currentPath === '/__collections__';
  const isArchiveSelected = currentPath === '/__collections__/__archive__';
  const isLikesSelected = currentPath === '/__collections__/liked';

  return (
    <>
      <ListItem
        disablePadding
        data-testid="collections-section"
        sx={{ '&:hover': { backgroundColor: 'action.hover' } }}
      >
        <ListItemButton
          onClick={onCollectionsClick}
          selected={isHeaderSelected}
          sx={{
            py: 0.5,
            minHeight: 32,
            pl: 0,
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
          <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>
            <Box
              component="span"
              data-testid="collections-toggle"
              onClick={onCollectionsToggle}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                cursor: 'pointer',
                width: 20,
                height: 20,
                justifyContent: 'center',
              }}
            >
              {collectionsExpanded ? (
                <ExpandMoreIcon fontSize="small" />
              ) : (
                <ChevronRightIcon fontSize="small" />
              )}
            </Box>
          </ListItemIcon>
          <ListItemIcon sx={{ minWidth: 24 }}>
            <CollectionsIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText
            primary={
              <Typography
                variant="body2"
                sx={{
                  fontSize: '0.875rem',
                  fontWeight: isHeaderSelected ? 700 : 400,
                }}
              >
                {t('nav.collections')}
              </Typography>
            }
          />
        </ListItemButton>
      </ListItem>

      <Collapse in={collectionsExpanded} timeout="auto" unmountOnExit>
        <List component="div" disablePadding>
          {/* LikesNode (P-5; MOVED TO TOP by M-2, 2026-09-30 owner ruling) — the
              static child row leads the section body, before the active
              collection rows (ArchiveNode stays the section tail); renders
              unconditionally under the same zero-state rule (empty likes =
              legal empty view). */}
          <TreeRow
            level={1}
            name={t('nav.collectionsLiked')}
            selected={isLikesSelected}
            onClick={onLikesClick}
            icon={<LikesIcon fontSize="small" />}
            buttonProps={{ 'data-testid': 'collections-liked-node' }}
          />

          {(collections ?? []).length === 0 ? (
            <ListItem disablePadding>
              <Box sx={{ pl: 3, py: 1 }}>
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: '0.875rem' }}>
                  {t('nav.collectionsEmpty')}
                </Typography>
              </Box>
            </ListItem>
          ) : (
            (collections ?? []).map((collection) => {
              const collectionId = collection.collection_id;
              const selected = currentPath === `${COLLECTION_ROUTE_PREFIX}${collectionId}`;
              const isNew = (newCollectionIds ?? []).includes(collectionId);
              const isShared = collection.granted_role != null;
              return (
                <TreeRow
                  key={collectionId}
                  level={1}
                  name={collection.name}
                  selected={selected}
                  onClick={() => onCollectionClick(collectionId)}
                  icon={
                    isShared ? (
                      <Tooltip title={t('nav.collectionsSharedChip')}>
                        <Box component="span" aria-label={t('nav.collectionsSharedChip')}>
                          <FolderSharedIcon fontSize="small" />
                        </Box>
                      </Tooltip>
                    ) : (
                      <CollectionsIcon fontSize="small" />
                    )
                  }
                  iconProps={
                    isShared
                      ? { 'data-testid': `collection-shared-chip-${collectionId}` }
                      : undefined
                  }
                  secondary={
                    // M-1 (2026-09-30): the secondary member-count display is REMOVED —
                    // the `new` dot is the only secondary affordance left.
                    isNew ? (
                      <Box
                        component="span"
                        data-testid={`collection-new-dot-${collectionId}`}
                        aria-label={t('nav.collectionsNewDot')}
                        sx={{
                          width: 6,
                          height: 6,
                          borderRadius: '50%',
                          bgcolor: 'primary.main',
                          display: 'inline-block',
                        }}
                      />
                    ) : undefined
                  }
                  buttonProps={{ 'data-testid': `collection-row-${collectionId}` }}
                />
              );
            })
          )}

          {/* ArchiveNode — auto-child at the section end; renders unconditionally
              (§2.3 T0.4 decision); the badge hides at count 0. */}
          <TreeRow
            level={1}
            name={t('nav.collectionsArchive')}
            selected={isArchiveSelected}
            onClick={onArchiveClick}
            icon={<ArchiveIcon fontSize="small" />}
            buttonProps={{ 'data-testid': 'collections-archive-node' }}
          />
        </List>
      </Collapse>
    </>
  );
};

export default CollectionsSection;
