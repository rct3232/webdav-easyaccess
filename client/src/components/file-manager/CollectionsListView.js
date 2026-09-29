import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Chip,
  Divider,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import { MoreVert as MoreVertIcon, PushPin as PushPinIcon } from '@mui/icons-material';
import { getFileIcon } from '../../utils/fileIconUtils';
import { getCollectionEntryKey } from '../../utils/fileViewUtils';
import { formatFileSize, formatDate } from '../../utils/format';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import { useResponsive } from '../../hooks/useResponsive';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CollectionCardItem from './CollectionCardItem';
import ResponsiveCardGrid, { CardGridSpan } from './ResponsiveCardGrid';

/**
 * Desktop double-open window — same 350ms same-entry contract as
 * `useExplorerInteraction.js` (handleFileClick double-click branch).
 */
const DOUBLE_CLICK_MS = 350;

const CARD_MENU_LABEL_KEYS = {
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
 * P-1 amended, P-3 clicks): the `open` entry is REMOVED — opening is double-click
 * (desktop) / tap (mobile) file-parity, not a menu action. Own rows get
 * Rename / pin·unpin / Restore-in-place-of-Archive when archived / Sharing, and
 * Delete ONLY on archived rows; viewer-received rows get Revoke-permission
 * (instant self-grant revocation, Path 1 — no confirm) and NO other mutations.
 */
const cardMenuActions = (collection) => {
  if (isViewerRow(collection)) return ['revoke-permission'];
  const lifecycle = isArchivedRow(collection) ? 'restore' : 'archive';
  const pin = collection?.pinned ? 'unpin' : 'pin';
  const tail = isArchivedRow(collection) ? ['delete-permanent'] : [];
  return ['rename', pin, lifecycle, 'sharing', ...tail];
};

/**
 * CollectionsListView — the `__collections__` surface (list mode: grid-parity
 * cards with 2×2 previews + merge slot — the sort control lives in the toolbar,
 * P-2; members mode: explorer rows with digest and publish-pending banners).
 * Pure view — mutations dispatch through onCardAction/onMemberAction/
 * onPublishBatch and clicks through onCardClick/onCardLongPressSelect (the
 * shell resolves selection/open semantics); the archive/permanent-delete
 * confirms are hosted here (single-card one/second-step confirms AND the
 * toolbar-bulk `bulkConfirm` state), and the batched 2×2 preview thumbnails
 * run the SHARED `useThumbnailLazyLoad` mechanism as a second instance whose
 * files array holds only preview rows (the DOM scan is instance-safe).
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
  selectionMode = false,
  selectedFiles = new Set(),
  onCardClick,
  onCardLongPressSelect,
  previewThumbnails = null,
  onPreviewThumbnailsLoaded,
  bulkConfirm = null,
  onBulkConfirm,
  onBulkConfirmDismiss,
}) => {
  const { t } = useTranslation();
  const { isMobile } = useResponsive();
  const [cardMenu, setCardMenu] = useState(null); // { anchorEl, collection }
  const [confirmState, setConfirmState] = useState(null); // { step, collection }
  const [digestExpanded, setDigestExpanded] = useState(false);
  const lastCardClickRef = React.useRef({ id: null, time: 0 });

  // 2×2 preview batch rows (flattened preview_items) for the shared lazy-load
  // mechanism — memoized so the hook's request tracking is not reset per render.
  const previewFiles = useMemo(
    () =>
      mode === 'list'
        ? collections.flatMap((collection) =>
            (collection.preview_items ?? []).map((item) => ({
              nodeId: item.node_id,
              name: item.name,
              mime: item.mime,
              type: item.type,
            }))
          )
        : [],
    [mode, collections]
  );
  useThumbnailLazyLoad(previewFiles, onPreviewThumbnailsLoaded, {});

  const dispatchCard = (action, collection) => {
    if (onCardAction) onCardAction(action, collection);
  };

  // File-parity click resolution (CollectionsListView §2.4): desktop first
  // click → onCardClick (shell enters selection); a second click on the SAME
  // card within the 350ms window → open. Mobile: tap opens (selection mode
  // tap toggles through onCardClick), long-press starts selection (item-local).
  const handleCardClick = (collection, event) => {
    if (isMobile) {
      if (selectionMode) onCardClick?.(collection, event);
      else dispatchCard('open', collection);
      return;
    }
    const now = Date.now();
    const last = lastCardClickRef.current;
    if (last.id === collection.collection_id && now - last.time < DOUBLE_CLICK_MS) {
      lastCardClickRef.current = { id: null, time: 0 };
      dispatchCard('open', collection);
      return;
    }
    lastCardClickRef.current = { id: collection.collection_id, time: now };
    onCardClick?.(collection, event);
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

  const bulkMessageKey = (step) =>
    step === 'archive'
      ? 'fileManager.archiveConfirmMessage'
      : step === 'delete-1'
        ? 'fileManager.permanentDeleteConfirm1'
        : 'fileManager.permanentDeleteConfirm2';

  const renderListMode = () => {
    // P-1: rows render straight from fetch state — the former view-local
    // `hiddenIds` recipient-hide is removed (revoked rows vanish on refetch).
    const visible = collections;
    return (
      <Box data-testid="collections-list-region">
        {visible.length === 0 ? (
          <>
            {mergeSlot}
            <Typography variant="body1" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
              {t(
                include === 'mine,archived'
                  ? 'fileManager.archiveEmpty'
                  : 'fileManager.collectionsEmpty'
              )}
            </Typography>
          </>
        ) : (
          <ResponsiveCardGrid>
            {mergeSlot && <CardGridSpan>{mergeSlot}</CardGridSpan>}
            {visible.map((collection, index) => {
              const showClusterHeader =
                sort === 'similar' &&
                (index === 0 || collection.cluster_index !== visible[index - 1].cluster_index);
              return (
                <React.Fragment key={collection.collection_id}>
                  {showClusterHeader && (
                    <CardGridSpan
                      data-testid={`cluster-header-${collection.cluster_index}`}
                      sx={{ py: 1 }}
                    >
                      <Divider />
                    </CardGridSpan>
                  )}
                  <CollectionCardItem
                    collection={collection}
                    isSelected={selectedFiles.has(getCollectionEntryKey(collection.collection_id))}
                    selectionMode={selectionMode}
                    isMobile={isMobile}
                    previewThumbnails={previewThumbnails}
                    onCardClick={handleCardClick}
                    onCardLongPressSelect={onCardLongPressSelect}
                    onMoreClick={(target, anchorEl) =>
                      setCardMenu({ anchorEl, collection: target })
                    }
                    onCardAction={dispatchCard}
                  />
                </React.Fragment>
              );
            })}
          </ResponsiveCardGrid>
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

        {/* Toolbar bulk confirms (P-3): ONE confirm for archive; the trash-parity
            two-step for permanent delete, ONE dialog covering the whole batch and
            listing the affected collection names. Execution is the shell's. */}
        <ConfirmDialog
          open={bulkConfirm != null}
          onClose={() => onBulkConfirmDismiss?.()}
          onConfirm={() => onBulkConfirm?.()}
          title={t('common.confirm')}
          message={
            bulkConfirm
              ? `${t(bulkMessageKey(bulkConfirm.step))}${
                  (bulkConfirm.names ?? []).length > 0 ? ` (${bulkConfirm.names.join(', ')})` : ''
                }`
              : ''
          }
          confirmText={
            bulkConfirm?.step === 'delete-1' || bulkConfirm?.step === 'delete-2'
              ? t('common.delete')
              : t('common.confirm')
          }
          cancelText={t('common.cancel')}
          confirmColor={bulkConfirm?.step?.startsWith('delete') ? 'error' : 'primary'}
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
