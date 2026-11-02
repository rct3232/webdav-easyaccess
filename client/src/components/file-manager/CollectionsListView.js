import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Divider,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  Typography,
} from '@mui/material';
import {
  Edit as EditIcon,
  PushPin as PushPinIcon,
  Archive as ArchiveIcon,
  Unarchive as UnarchiveIcon,
  Share as ShareIcon,
  DeleteForever as DeleteForeverIcon,
  ExitToApp as ExitToAppIcon,
  Favorite as FavoriteIcon,
  Inventory2 as InventoryIcon,
} from '@mui/icons-material';
import { getCollectionEntryKey } from '../../utils/fileViewUtils';
import { useThumbnailLazyLoad } from '../../hooks/useThumbnailLazyLoad';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';
import { useResponsive } from '../../hooks/useResponsive';
import ConfirmDialog from '../dialogs/ConfirmDialog';
import CardTile from './CardTile';
import CollectionCardItem from './CollectionCardItem';
import FileList from './FileList';
import FileGrid from './FileGrid';
import FileDetail from './FileDetail';
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

// M-3 (2026-09-30): EVERY card-menu row carries a ListItemIcon (files-menu
// parity; alias idiom matches FileContextMenu/FileManagerControls).
const CARD_MENU_ICONS = {
  rename: EditIcon,
  pin: PushPinIcon,
  unpin: PushPinIcon,
  archive: ArchiveIcon,
  restore: UnarchiveIcon,
  sharing: ShareIcon,
  'delete-permanent': DeleteForeverIcon,
  'revoke-permission': ExitToAppIcon,
};

const isViewerRow = (collection) => collection?.granted_role != null;
const isArchivedRow = (collection) => collection?.status === 'archived';

/**
 * M-8 (2026-09-30 owner ruling): member/liked rows sort CLIENT-SIDE like files,
 * on the FULL fetched set, BEFORE the display slice. Semantics mirror
 * `sortFiles` (directories partition ahead; lowercase name localeCompare), with
 * the date key = `created_at` (membership-added date; node creation on the liked
 * surface). Rows LACKING created_at (revoked masquerade) pin to the END in BOTH
 * date directions. The sort is stable — ties keep the server (activity/node_id)
 * order. No mode ⇒ render as-is (host stays order-agnostic).
 * @see docs/spec/client/components/file-manager/CollectionsListView.md §2.5
 */
const sortMemberItems = (rows, mode) => {
  if (!mode || rows.length === 0) return rows;
  const dir = mode.endsWith('_asc') ? 1 : -1;
  const isName = mode === 'name_asc' || mode === 'name_desc';
  const nameOf = (row) => (row.basename || row.name || '').toLowerCase();
  const dateOf = (row) => (row.created_at != null ? new Date(row.created_at).getTime() : null);
  const sortGroup = (list) => {
    if (isName) return [...list].sort((a, b) => dir * nameOf(a).localeCompare(nameOf(b)));
    const dated = list.filter((row) => dateOf(row) != null);
    const undated = list.filter((row) => dateOf(row) == null);
    return [...dated.sort((a, b) => dir * (dateOf(a) - dateOf(b))), ...undated];
  };
  const dirs = rows.filter((row) => row.type === 'directory');
  const files = rows.filter((row) => row.type !== 'directory');
  return [...sortGroup(dirs), ...sortGroup(files)];
};

/**
 * M-2 pseudo-tile — a navigation cell on the collections grid (Likes FIRST /
 * Archive LAST, never selectable, no menu, no card actions). Same tile shell as
 * the cards so the grid columns and hover language stay file-parity.
 */
const PseudoTile = ({ testId, label, icon, onClick }) => (
  <Box data-testid={testId} sx={{ height: '100%', minWidth: 0 }} onClick={onClick}>
    <CardTile
      media={icon}
      footer={
        <Typography variant="body2" sx={{ fontWeight: 'medium' }} noWrap>
          {label}
        </Typography>
      }
      cursor="pointer"
    />
  </Box>
);

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
  onPseudoTileNavigate,
  items = [],
  memberViewMode = 'grid',
  memberSortMode,
  memberLoading = false,
  onMemberRowClick,
  onMemberRowCheck,
  onMemberRowLongPressSelect,
  onMemberThumbnailsLoaded,
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

  // Decision B (2026-09-29 owner ruling): member/liked rows arrive as the FULL
  // set in ONE response — this host owns display paging through the SHARED
  // useInfiniteScroll hook (same idiom + counts as file browse: 50+50). M-8
  // (2026-09-30): the FULL set is first sorted CLIENT-SIDE by the per-surface
  // `memberSortMode` (file parity; ties keep server order — stable sort).
  const sortedItems = useMemo(
    () => sortMemberItems(items, memberSortMode),
    [items, memberSortMode]
  );
  const {
    displayedFiles: displayedMembers,
    loadMoreRef: memberLoadMoreRef,
    hasMore: membersHasMore,
  } = useInfiniteScroll(sortedItems, { initialCount: 50, incrementCount: 50 });

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

  // -- P-4 member row delegation (CollectionsListView.md §2.5) ---------------
  // Revoked member rows offer NO menu (§3.2 — the renderer trigger is not
  // state-gated, so the dispatch itself guards); the row click/check/long-press
  // ride the SHARED selection machinery through the host callbacks (the shell's
  // handleFileClick/handleFileCheck/handleLongPressSelect — member rows carry
  // real numeric nodeIds). FileContextMenu/FileActionSheet never render here.
  const memberRowDisabled = (row) => row?.isCollectionMember === true && row?.state === 'revoked';

  const handleMemberMore = (row, event) => {
    if (memberRowDisabled(row)) return;
    onMemberAction?.('menu', row, event?.currentTarget ?? null);
  };

  const handleMemberContextMenu = (event, row) => {
    if (memberRowDisabled(row)) return;
    onMemberAction?.('menu', row, event?.currentTarget ?? null);
  };

  const renderMemberRows = () => {
    const delegateProps = {
      files: displayedMembers,
      selectionMode,
      selectedFiles,
      loading: memberLoading,
      onFileClick: onMemberRowClick,
      onFileCheck: onMemberRowCheck,
      onLongPressSelect: onMemberRowLongPressSelect,
      onMoreClick: handleMemberMore,
      onContextMenu: handleMemberContextMenu,
      showMoreButton: !selectionMode,
    };
    if (memberViewMode === 'detail') {
      return <FileDetail {...delegateProps} />;
    }
    if (memberViewMode === 'list') {
      return <FileList {...delegateProps} onThumbnailsLoaded={onMemberThumbnailsLoaded} />;
    }
    return <FileGrid {...delegateProps} onThumbnailsLoaded={onMemberThumbnailsLoaded} />;
  };

  const renderListMode = () => {
    // P-1: rows render straight from fetch state — the former view-local
    // `hiddenIds` recipient-hide is removed (revoked rows vanish on refetch).
    const visible = collections;
    // M-2 pseudo-tiles (F3, 2026-10-01 owner ruling — "archive에 likes 아이템이 있으면
    // 안돼" — supersedes the M-2 "archive shows ONLY Likes" default): the ACTIVE view
    // renders Likes FIRST and Archive LAST; the ARCHIVE surface is terminal — ZERO
    // pseudo-tiles there (both destinations are one click away in the sidebar).
    // Never selectable, no menu, never gated by the empty state on the active view.
    const isArchiveSurface = include === 'mine,archived';
    const likedTile = isArchiveSurface ? null : (
      <PseudoTile
        testId="collection-tile-liked"
        label={t('nav.collectionsLiked')}
        icon={<FavoriteIcon color="like" fontSize="large" />}
        onClick={() => onPseudoTileNavigate?.('/__collections__/liked')}
      />
    );
    const archiveTile = isArchiveSurface ? null : (
      <PseudoTile
        testId="collection-tile-archive"
        label={t('nav.collectionsArchive')}
        icon={<InventoryIcon fontSize="large" color="action" />}
        onClick={() => onPseudoTileNavigate?.('/__collections__/__archive__')}
      />
    );
    // Merge region (CollectionsListView.md §2.4): the card stays BETWEEN the
    // toolbar and the list, pinned to the top of the scroll container. It is a
    // sticky wrapper in normal flow — never a grid child — so accordion
    // expansion pushes the collection cards down while scrolling content
    // passes underneath its opaque background.
    const mergeRegion = mergeSlot ? (
      <Box
        data-testid="merge-proposal-slot"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          bgcolor: 'background.paper',
          pb: 1.5,
        }}
      >
        {mergeSlot}
      </Box>
    ) : null;
    return (
      <Box data-testid="collections-list-region">
        {mergeRegion}
        {visible.length === 0 ? (
          <>
            <ResponsiveCardGrid>
              {likedTile}
              {archiveTile}
            </ResponsiveCardGrid>
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
            {likedTile}
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
            {archiveTile}
          </ResponsiveCardGrid>
        )}

        <Menu
          anchorEl={cardMenu?.anchorEl ?? null}
          open={Boolean(cardMenu)}
          onClose={() => setCardMenu(null)}
        >
          {cardMenu &&
            cardMenuActions(cardMenu.collection).map((action) => {
              const MenuIcon = CARD_MENU_ICONS[action];
              return (
                <MenuItem
                  key={action}
                  data-testid={`card-menu-option-${action}`}
                  onClick={() => handleCardMenuSelect(action, cardMenu.collection)}
                >
                  <ListItemIcon>
                    <MenuIcon fontSize="small" />
                  </ListItemIcon>
                  <ListItemText>{t(CARD_MENU_LABEL_KEYS[action])}</ListItemText>
                </MenuItem>
              );
            })}
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
      {/* M-7 (2026-09-30): a since-requested all-zero digest is noise — the
          banner renders only when at least one delta is non-zero. */}
      {digest && ((digest.added_since ?? 0) > 0 || (digest.removed_since ?? 0) > 0) && (
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

      {/* P-4 (§2.5): member rows render through the SAME shared
          FileList/FileGrid/FileDetail renderers chosen by memberViewMode. The
          adapter-shaped rows carry the optional member slots (rowTestId /
          moreButtonTestId → the preserved `member-row-*` /
          `member-menu-button` testids); this view stays the chrome host. */}
      {renderMemberRows()}

      {/* Decision B (2026-09-29): the load-more button is retired — the rows
          arrive complete in ONE response and this host slices them 50+50 via
          the shared useInfiniteScroll hook. The sentinel (same idiom as the
          file grid/list) reveals the next slice on scroll — no fetch fires. */}
      {membersHasMore && (
        <Box
          ref={memberLoadMoreRef}
          data-testid="member-scroll-sentinel"
          sx={{ height: 24, display: 'flex', justifyContent: 'center' }}
        />
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
