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
import { pixelMiddleTruncate } from '../../utils/stringUtils';
import useObservedElementWidth from './hooks/useObservedElementWidth';

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
  const { setObservedElement, width: containerWidth } = useObservedElementWidth(200);

  // Padding/Margins total matches the RecentFilesSection row idiom (~72px).
  const maxPixelWidth = Math.max(40, containerWidth - 72);
  const font = '14px Inter, Roboto, "Helvetica Neue", Arial, sans-serif';

  const isHeaderSelected = currentPath === '/__collections__';
  const isArchiveSelected = currentPath === '/__collections__/__archive__';
  const isLikesSelected = currentPath === '/__collections__/liked';

  const renderRowName = (name, { weight = 400 } = {}) => {
    const truncatedName = pixelMiddleTruncate(name ?? '', maxPixelWidth, font);
    const isTruncated = truncatedName !== (name ?? '');
    const typography = (
      <Typography
        variant="body2"
        sx={{
          fontSize: '0.875rem',
          fontWeight: weight,
          overflow: 'hidden',
          whiteSpace: 'nowrap',
        }}
      >
        {truncatedName}
      </Typography>
    );
    return isTruncated ? (
      <Tooltip title={name} disableInteractive>
        {typography}
      </Tooltip>
    ) : (
      typography
    );
  };

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
        <List component="div" disablePadding ref={setObservedElement}>
          {/* LikesNode (P-5; MOVED TO TOP by M-2, 2026-09-30 owner ruling) — the
              static child row leads the section body, before the active
              collection rows (ArchiveNode stays the section tail); renders
              unconditionally under the same zero-state rule (empty likes =
              legal empty view). */}
          <ListItem disablePadding>
            <ListItemButton
              data-testid="collections-liked-node"
              onClick={onLikesClick}
              selected={isLikesSelected}
              sx={{
                pl: 3,
                py: 0.5,
                minHeight: 32,
                '&.Mui-selected': {
                  backgroundColor: 'transparent',
                  color: 'primary.main',
                  borderLeft: '3px solid',
                  borderLeftColor: 'primary.main',
                  '&:hover': { backgroundColor: 'action.hover' },
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>
                <LikesIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Typography
                    variant="body2"
                    sx={{ fontSize: '0.875rem', fontWeight: isLikesSelected ? 700 : 400 }}
                  >
                    {t('nav.collectionsLiked')}
                  </Typography>
                }
              />
            </ListItemButton>
          </ListItem>

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
              return (
                <ListItem key={collectionId} disablePadding>
                  <ListItemButton
                    data-testid={`collection-row-${collectionId}`}
                    onClick={() => onCollectionClick(collectionId)}
                    selected={selected}
                    sx={{
                      pl: 3,
                      py: 0.5,
                      minHeight: 32,
                      '&.Mui-selected': {
                        backgroundColor: 'transparent',
                        color: 'primary.main',
                        borderLeft: '3px solid',
                        borderLeftColor: 'primary.main',
                        '&:hover': { backgroundColor: 'action.hover' },
                        '& .MuiListItemIcon-root': { color: 'primary.main' },
                      },
                    }}
                  >
                    <ListItemIcon
                      data-testid={
                        collection.granted_role != null
                          ? `collection-shared-chip-${collectionId}`
                          : undefined
                      }
                      sx={{ minWidth: 24, mr: 0.5 }}
                    >
                      {collection.granted_role != null ? (
                        <Tooltip title={t('nav.collectionsSharedChip')}>
                          <Box component="span" aria-label={t('nav.collectionsSharedChip')}>
                            <FolderSharedIcon fontSize="small" />
                          </Box>
                        </Tooltip>
                      ) : (
                        <CollectionsIcon fontSize="small" />
                      )}
                    </ListItemIcon>
                    <ListItemText
                      sx={{ minWidth: 0, overflow: 'hidden' }}
                      primary={renderRowName(collection.name, {
                        weight: selected ? 700 : 400,
                      })}
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
                    />
                  </ListItemButton>
                </ListItem>
              );
            })
          )}

          {/* ArchiveNode — auto-child at the section end; renders unconditionally
              (§2.3 T0.4 decision); the badge hides at count 0. */}
          <ListItem disablePadding>
            <ListItemButton
              data-testid="collections-archive-node"
              onClick={onArchiveClick}
              selected={isArchiveSelected}
              sx={{
                pl: 3,
                py: 0.5,
                minHeight: 32,
                '&.Mui-selected': {
                  backgroundColor: 'transparent',
                  color: 'primary.main',
                  borderLeft: '3px solid',
                  borderLeftColor: 'primary.main',
                  '&:hover': { backgroundColor: 'action.hover' },
                  '& .MuiListItemIcon-root': { color: 'primary.main' },
                },
              }}
            >
              <ListItemIcon sx={{ minWidth: 24, mr: 0.5 }}>
                <ArchiveIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box
                    component="span"
                    sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}
                  >
                    <Typography
                      variant="body2"
                      sx={{ fontSize: '0.875rem', fontWeight: isArchiveSelected ? 700 : 400 }}
                    >
                      {t('nav.collectionsArchive')}
                    </Typography>
                  </Box>
                }
              />
            </ListItemButton>
          </ListItem>
        </List>
      </Collapse>
    </>
  );
};

export default CollectionsSection;
