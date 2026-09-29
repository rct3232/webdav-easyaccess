import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Typography,
} from '@mui/material';
import {
  Checkroom as SharedChipIcon,
  MoreVert as MoreVertIcon,
  PushPin as PushPinIcon,
} from '@mui/icons-material';
import { getFileIcon } from '../../utils/fileIconUtils';
import { formatFileSize, formatDate } from '../../utils/format';
import ConfirmDialog from '../dialogs/ConfirmDialog';

const CARD_MENU_LABEL_KEYS = {
  open: 'fileManager.cardMenuOpen',
  rename: 'fileManager.cardMenuRename',
  pin: 'fileManager.cardMenuPin',
  unpin: 'fileManager.cardMenuUnpin',
  archive: 'fileManager.cardMenuArchive',
  restore: 'fileManager.cardMenuRestore',
  sharing: 'fileManager.cardMenuSharing',
  'delete-permanent': 'fileManager.cardMenuDelete',
  'revoke-permission': 'fileManager.cardMenuRevokePermission',
};

const isViewerRow = (collection) => collection?.granted_role != null;
const isArchivedRow = (collection) => collection?.status === 'archived';

/**
 * Exact card-menu set (CollectionsListView §2.4 + T0.4 as-built decisions,
 * P-1 amended): own rows get Open / Rename / pin·unpin / Restore-in-place-of-
 * Archive when archived / Sharing, and Delete ONLY on archived rows;
 * viewer-received rows get Open + Revoke-permission (instant self-grant
 * revocation, Path 1 — no confirm) and NO other mutations.
 */
const cardMenuActions = (collection) => {
  if (isViewerRow(collection)) return ['open', 'revoke-permission'];
  const lifecycle = isArchivedRow(collection) ? 'restore' : 'archive';
  const pin = collection?.pinned ? 'unpin' : 'pin';
  const tail = isArchivedRow(collection) ? ['delete-permanent'] : [];
  return ['open', 'rename', pin, lifecycle, 'sharing', ...tail];
};

/**
 * CollectionsListView — the `__collections__` surface (list mode: cards +
 * merge slot — the sort control lives in the toolbar, P-2; members mode:
 * explorer rows with digest and publish-pending banners). Pure view — every
 * mutation is dispatched through onCardAction/onMemberAction/onPublishBatch;
 * the archive/permanent-delete confirms are hosted here (one confirm for
 * archive, second-step confirm for delete) and the mutation dispatch happens
 * only after the final confirm.
 * @see docs/spec/client/components/file-manager/CollectionsListView.md
 */
const CollectionsListView = ({
  mode,
  collections = [],
  sort = 'activity',
  mergeSlot = null,
  include,
  items = [],
  nextCursor = null,
  onLoadMore,
  digest,
  publishPendingCount,
  onCardAction,
  onMemberAction,
  onPublishBatch,
}) => {
  const { t } = useTranslation();
  const [cardMenu, setCardMenu] = useState(null); // { anchorEl, collection }
  const [confirmState, setConfirmState] = useState(null); // { step, collection }
  const [digestExpanded, setDigestExpanded] = useState(false);

  const dispatchCard = (action, collection) => {
    if (onCardAction) onCardAction(action, collection);
  };

  const handleCardMenuSelect = (action, collection) => {
    setCardMenu(null);
    if (action === 'archive') {
      setConfirmState({ step: 'archive', collection });
      return;
    }
    if (action === 'delete-permanent') {
      setConfirmState({ step: 'delete-1', collection });
      return;
    }
    dispatchCard(action, collection);
  };

  const handleConfirm = () => {
    if (!confirmState) return;
    const { step, collection } = confirmState;
    if (step === 'archive') {
      setConfirmState(null);
      dispatchCard('archive', collection);
      return;
    }
    if (step === 'delete-1') {
      setConfirmState({ step: 'delete-2', collection });
      return;
    }
    setConfirmState(null);
    dispatchCard('delete-permanent', collection);
  };

  const renderListMode = () => {
    // P-1: rows render straight from fetch state — the former view-local
    // `hiddenIds` recipient-hide is removed (revoked rows vanish on refetch).
    const visible = collections;
    return (
      <Box data-testid="collections-list-region">
        {mergeSlot}

        {visible.length === 0 ? (
          <Typography variant="body1" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            {t(
              include === 'mine,archived'
                ? 'fileManager.archiveEmpty'
                : 'fileManager.collectionsEmpty'
            )}
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'repeat(auto-fill, minmax(220px, 1fr))' },
              gap: 2,
            }}
          >
            {visible.map((collection, index) => {
              const showClusterHeader =
                sort === 'similar' &&
                (index === 0 || collection.cluster_index !== visible[index - 1].cluster_index);
              return (
                <React.Fragment key={collection.collection_id}>
                  {showClusterHeader && (
                    <Box
                      data-testid={`cluster-header-${collection.cluster_index}`}
                      sx={{ gridColumn: '1 / -1', py: 1 }}
                    >
                      <Divider />
                    </Box>
                  )}
                  <Box
                    data-testid={`collection-card-${collection.collection_id}`}
                    sx={{
                      border: 1,
                      borderColor: 'divider',
                      borderRadius: 2,
                      p: 2,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                    }}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                      <Typography variant="subtitle1" noWrap sx={{ flex: 1, minWidth: 0 }}>
                        {collection.name}
                      </Typography>
                      {isViewerRow(collection) && (
                        <Box
                          component="span"
                          data-testid={`card-shared-chip-${collection.collection_id}`}
                        >
                          <SharedChipIcon fontSize="small" color="action" />
                        </Box>
                      )}
                      <IconButton
                        size="small"
                        data-testid={`card-menu-button-${collection.collection_id}`}
                        onClick={(e) => setCardMenu({ anchorEl: e.currentTarget, collection })}
                        aria-label={t('fileManager.fileActions')}
                      >
                        <MoreVertIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
                      <Typography variant="body2" color="text.secondary">
                        {t('fileManager.collectionsItemCount', { count: collection.item_count })}
                      </Typography>
                      {isArchivedRow(collection) && (
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
                          onDelete={() => dispatchCard('unpin', collection)}
                          deleteIcon={
                            <Box
                              component="span"
                              role="button"
                              data-testid={`card-autopin-unpin-${collection.collection_id}`}
                              onClick={(e) => {
                                e.stopPropagation();
                                dispatchCard('unpin', collection);
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
                </React.Fragment>
              );
            })}
          </Box>
        )}

        <Menu
          anchorEl={cardMenu?.anchorEl ?? null}
          open={Boolean(cardMenu)}
          onClose={() => setCardMenu(null)}
        >
          {cardMenu &&
            cardMenuActions(cardMenu.collection).map((action) => (
              <MenuItem
                key={action}
                data-testid={`card-menu-option-${action}`}
                onClick={() => handleCardMenuSelect(action, cardMenu.collection)}
              >
                <ListItemIcon>
                  {action === 'pin' || action === 'unpin' ? <PushPinIcon fontSize="small" /> : null}
                </ListItemIcon>
                <ListItemText>{t(CARD_MENU_LABEL_KEYS[action])}</ListItemText>
              </MenuItem>
            ))}
        </Menu>

        <ConfirmDialog
          open={confirmState != null}
          onClose={() => setConfirmState(null)}
          onConfirm={handleConfirm}
          title={t('common.confirm')}
          message={
            confirmState?.step === 'archive'
              ? t('fileManager.archiveConfirmMessage')
              : confirmState?.step === 'delete-1'
                ? t('fileManager.permanentDeleteConfirm1')
                : t('fileManager.permanentDeleteConfirm2')
          }
          confirmText={
            confirmState?.step === 'delete-1' || confirmState?.step === 'delete-2'
              ? t('common.delete')
              : t('common.confirm')
          }
          cancelText={t('common.cancel')}
          confirmColor={confirmState?.step?.startsWith('delete') ? 'error' : 'primary'}
        />
      </Box>
    );
  };

  const renderMembersMode = () => (
    <Box data-testid="members-list">
      {digest && (
        <Box data-testid="digest-banner" sx={{ mb: 1 }}>
          <Typography variant="body2" component="span">
            {t('fileManager.digestLine', {
              added: digest.added_since ?? 0,
              removed: digest.removed_since ?? 0,
            })}
          </Typography>
          <Button
            size="small"
            data-testid="digest-expand"
            onClick={() => setDigestExpanded((prev) => !prev)}
          >
            {t(digestExpanded ? 'fileManager.digestCollapse' : 'fileManager.digestExpand')}
          </Button>
          {digestExpanded && (
            <Box data-testid="digest-details" sx={{ pl: 2 }}>
              <Typography variant="body2" color="text.secondary">
                {t('fileManager.digestAdded')}: {digest.added_since ?? 0} ·{' '}
                {t('fileManager.digestRemoved')}: {digest.removed_since ?? 0}
              </Typography>
              {(digest.entries ?? []).map((entry) => (
                <Typography key={`${entry.kind}-${entry.node_id}`} variant="body2">
                  {entry.name ?? entry.node_id} — {t('fileManager.whyHere')}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      )}

      {typeof publishPendingCount === 'number' && publishPendingCount > 0 && (
        <Box
          data-testid="publish-pending-banner"
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1,
            px: 1.5,
            py: 1,
            borderRadius: 1,
            bgcolor: 'action.hover',
          }}
        >
          <Typography variant="body2" sx={{ flex: 1 }}>
            {t('fileManager.publishPending', { count: publishPendingCount })}
          </Typography>
          <Button size="small" data-testid="publish-batch" onClick={() => onPublishBatch?.()}>
            {t('fileManager.publishBatch')}
          </Button>
        </Box>
      )}

      {items.map((row) => {
        const revoked = row.state === 'revoked';
        return (
          <Box
            key={row.nodeId}
            data-testid={`member-row-${row.nodeId}`}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              py: 0.75,
              px: 1,
              borderBottom: 1,
              borderColor: 'divider',
              ...(revoked && { color: 'text.disabled' }),
            }}
          >
            <Box
              sx={{ display: 'flex', alignItems: 'center', width: 32, justifyContent: 'center' }}
            >
              {revoked ? null : getFileIcon({ type: row.type, basename: row.basename ?? row.name })}
            </Box>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
              {revoked ? t('fileManager.collectionsUnavailable') : (row.basename ?? row.name)}
            </Typography>
            {row.shared_excluded === true && (
              <Chip
                size="small"
                data-testid={`member-excluded-chip-${row.nodeId}`}
                label={t('fileManager.sharedExcludedChip')}
              />
            )}
            {!revoked && row.size != null && (
              <Typography variant="caption" color="text.secondary">
                {formatFileSize(row.size)}
              </Typography>
            )}
            {!revoked && (
              <Typography variant="caption" color="text.secondary">
                {formatDate(row.lastmod)}
              </Typography>
            )}
            <IconButton
              size="small"
              data-testid="member-menu-button"
              onClick={(e) => onMemberAction?.('menu', row, e.currentTarget)}
              disabled={revoked}
            >
              <MoreVertIcon fontSize="small" />
            </IconButton>
          </Box>
        );
      })}

      {nextCursor && (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
          <Button size="small" data-testid="member-load-more" onClick={() => onLoadMore?.()}>
            {t('fileManager.memberLoadMore')}
          </Button>
        </Box>
      )}
    </Box>
  );

  return (
    <Box data-testid="collections-list-view">
      {mode === 'members' ? renderMembersMode() : renderListMode()}
    </Box>
  );
};

export default CollectionsListView;
