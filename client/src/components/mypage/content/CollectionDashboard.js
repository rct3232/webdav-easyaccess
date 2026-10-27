/**
 * CollectionDashboard — MyPage `Storage` content (T0.10 v1, docs/spec/client/
 * components/mypage/content/CollectionDashboard.md; AI_FEATURE_PLAN §4.16).
 * Blocks (render order = contract): hygiene cards (pull-overview deep-links,
 * NEVER an action center), system-changes journal feed (30d rows, undo +
 * cascade), my-collections status (counts + grants with inline revoke + the
 * merge/archive feed subset), SuggestionsChecklist, capacity sparkline (the
 * series seam is absent ⇒ the block is omitted entirely). Zero/absent data
 * hides blocks (absent-not-disabled); every read rides the failure-absorbing
 * gateway seams.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Card,
  CardActionArea,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Snackbar,
  Typography,
} from '@mui/material';
import { Close as CloseIcon } from '@mui/icons-material';

import { usePageHeader } from '../../../contexts/PageHeaderContext';
import { useMessage } from '../../../hooks/useMessage';
import { useUndoToast } from '../../../hooks/useUndoToast';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { UndoToast } from '../../feedback';
import { formatDate, formatFileSize } from '../../../utils/format';
import explorerGateway from '../../../services/explorerGateway';
import SuggestionsChecklist from './SuggestionsChecklist';

const JOURNAL_CAP = 200; // routes/actions.md §2.4 feed cap (personal scale)
const DAY_MS = 24 * 60 * 60 * 1000;
// §4.16 collections-status subset ("recent merge/archive facts w/ undo").
const COLLECTION_FACT_ACTIONS = ['merge', 'archive', 'restore'];
// Report-only rows (permanent delete / empty-trash parity contract — never
// undoable, badge instead of an Undo button). No journaled writer exists for
// these actions in v1; the mapping is the defensive surface.
const REPORT_ONLY_ACTIONS = ['delete-permanent', 'empty-trash'];

const TRASH_ROUTE = '/files/__trash__';

const actionLabelKey = (action) => `mypage.journalAction.${action}`;

const JournalRow = ({ row, onUndo }) => {
  const { t } = useTranslation();
  const reportOnly = REPORT_ONLY_ACTIONS.includes(row.action);
  const undone = row.status === 'undone';
  const expired = row.status === 'expired';
  const showUndo = Boolean(row.undo_available) && !undone && !expired && !reportOnly;

  return (
    <ListItem data-testid="journal-row" data-status={row.status} disablePadding sx={{ py: 0.25 }}>
      <ListItemText
        disableTypography
        primary={
          <Typography variant="body2" sx={{ textDecoration: undone ? 'line-through' : undefined }}>
            {String(row.subject_label ?? '')}{' '}
            <Box component="em" sx={{ color: 'text.secondary' }}>
              {t(actionLabelKey(row.action), { defaultValue: row.action })}
            </Box>
          </Typography>
        }
        secondary={
          <>
            {formatDate(row.created_at)}
            {row.actor === 'system' ? ` · ${t('mypage.journalAuto')}` : ''}
            {expired || reportOnly ? ` · ${t('mypage.journalNotRecoverable')}` : ''}
          </>
        }
      />
      {showUndo ? (
        <Button size="small" data-testid="journal-undo" onClick={() => onUndo(row)}>
          {t('actions.undo')}
        </Button>
      ) : null}
    </ListItem>
  );
};

const CollectionDashboard = ({ user, onNavigate, onUndo, onMessage, gateway }) => {
  const { t } = useTranslation();
  const resolvedGateway = gateway || explorerGateway;
  const { setTitle } = usePageHeader();
  const message = useMessage();
  const [dashboard, setDashboard] = useState(null);
  const [actions, setActions] = useState([]);
  const [collections, setCollections] = useState([]);
  const [grants, setGrants] = useState({});
  const [capacitySeries, setCapacitySeries] = useState(null);

  useEffect(() => {
    setTitle(t('mypage.storage'));
  }, [setTitle, t]);

  const loadAll = useCallback(async () => {
    const [summary, feed, collectionList] = await Promise.all([
      resolvedGateway.getFileSuggestions(),
      resolvedGateway.getActions({ domain: 'collection' }),
      resolvedGateway.loadCollections({ include: 'mine,shared,archived' }),
    ]);
    setDashboard(summary ?? null);
    setActions(Array.isArray(feed?.actions) ? feed.actions : []);
    const rows = Array.isArray(collectionList?.collections) ? collectionList.collections : [];
    setCollections(rows);

    // grants-granted read: one absorbed owner-side read per own collection
    // (personal scale — the collections list is unpaginated by decision).
    const owned = rows.filter((row) => row.granted_role == null);
    const grantPairs = await Promise.all(
      owned.map(async (row) => {
        const result = await resolvedGateway.getGrants(row.collection_id);
        return [row.collection_id, Array.isArray(result?.grants) ? result.grants : []];
      })
    );
    setGrants(Object.fromEntries(grantPairs));

    if (typeof resolvedGateway.loadCapacitySeries === 'function') {
      setCapacitySeries(await resolvedGateway.loadCapacitySeries());
    } else {
      setCapacitySeries(null);
    }
  }, [resolvedGateway]);

  useEffect(() => {
    const run = async () => {
      try {
        await loadAll();
      } catch (error) {
        // seams absorb internally; a throw is a bug-surface, never a crash
        // eslint-disable-next-line no-console
        console.error('CollectionDashboard load failed:', error);
      }
    };
    run();
    // loadAll re-creates with the gateway identity; run the initial read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    cascadeConfirm,
    busy: undoBusy,
    undoNow,
    showUndoToast,
  } = useUndoToast({
    gateway: resolvedGateway,
    message,
    refresh: loadAll,
  });

  const handleRowUndo = useCallback(
    (row) => {
      if (typeof onUndo === 'function') {
        onUndo(row.action_id, {});
        return;
      }
      undoNow(row.action_id);
    },
    [onUndo, undoNow]
  );

  const scrollToSuggestions = useCallback(() => {
    const target = document.getElementById('dashboard-suggestions');
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleAccept = useCallback(
    async (nodeIds) => {
      const payload = await resolvedGateway.acceptFileSuggestions(nodeIds);
      if (payload) {
        const moved = Array.isArray(payload.trashed) ? payload.trashed.length : 0;
        const actionId = payload.undo ? payload.undo.action_id : null;
        if (actionId != null) {
          // Journaled command (routes/dashboard.md §2.4): report toast WITH an
          // Undo button — the command-unit row restores every trashed node.
          showUndoToast({
            actionId,
            text: 'mypage.suggestionsTrashed',
            params: { count: moved },
          });
        } else {
          // No undo pointer (nothing journaled): plain report toast.
          message.showSuccess(t('mypage.suggestionsTrashed', { count: moved }));
          if (onMessage) onMessage('success', t('mypage.suggestionsTrashed', { count: moved }));
        }
        loadAll();
      }
      return payload;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedGateway, loadAll, onMessage, showUndoToast]
  );

  const handleDismiss = useCallback(
    async (suggestionId) => {
      const payload = await resolvedGateway.dismissFileSuggestion(suggestionId);
      // Absorbed failure keeps the row (no toast lies); success refreshes the
      // list silently — dismiss never toasts (SuggestionsChecklist.md §2.2).
      if (payload) loadAll();
      return payload;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedGateway, loadAll]
  );

  const handleRevoke = useCallback(
    async (collectionId, granteeId) => {
      const result = await resolvedGateway.revokeGrant(collectionId, granteeId);
      if (result) {
        setGrants((prev) => ({
          ...prev,
          [collectionId]: (prev[collectionId] || []).filter(
            (grant) => grant.grantee_id !== granteeId
          ),
        }));
      }
    },
    [resolvedGateway]
  );

  const duplicates = dashboard?.duplicates;
  const nearDuplicates = dashboard?.near_duplicates;
  const trash = dashboard?.trash;
  const suggestions = useMemo(
    () => (Array.isArray(dashboard?.suggestions) ? dashboard.suggestions : []),
    [dashboard]
  );

  const trashDaysLeft =
    trash && trash.retention_days > 0 && trash.oldest_deleted_at
      ? Math.max(
          0,
          Math.ceil(
            trash.retention_days - (Date.now() - Date.parse(trash.oldest_deleted_at)) / DAY_MS
          )
        )
      : null;

  const feedRows = (rows) =>
    rows.map((row) => <JournalRow key={row.action_id} row={row} onUndo={handleRowUndo} />);

  const collectionFacts = actions.filter((row) => COLLECTION_FACT_ACTIONS.includes(row.action));
  const activeCount = collections.filter((row) => row.status === 'active').length;
  const archivedCount = collections.filter((row) => row.status === 'archived').length;
  const grantsReceived = collections.filter((row) => row.granted_role != null);
  const grantedEntries = Object.entries(grants).filter(([, rows]) => rows.length > 0);
  const showCards =
    duplicates &&
    (duplicates.group_count > 0 ||
      (nearDuplicates && nearDuplicates.group_count > 0) ||
      (trash && trash.item_count > 0) ||
      suggestions.length > 0);

  if (!user) return null;

  return (
    <Box data-testid="collection-dashboard" sx={{ pb: 4 }}>
      {showCards ? (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
          {duplicates &&
          (duplicates.group_count > 0 || (nearDuplicates && nearDuplicates.group_count > 0)) ? (
            <Card sx={{ flex: 1, minWidth: 160 }}>
              <CardActionArea
                aria-label={t('mypage.hygieneDuplicates')}
                onClick={scrollToSuggestions}
              >
                <Box sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2">{t('mypage.hygieneDuplicates')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('mypage.hygieneDuplicatesMeta', {
                      groups: duplicates.group_count,
                      files: duplicates.duplicate_count,
                      size: formatFileSize(duplicates.reclaimable_bytes),
                    })}
                  </Typography>
                  {nearDuplicates && nearDuplicates.group_count > 0 ? (
                    <Typography variant="caption" color="text.secondary">
                      {t('mypage.hygieneNearDuplicatesMeta', {
                        groups: nearDuplicates.group_count,
                        files: nearDuplicates.duplicate_count,
                      })}
                    </Typography>
                  ) : null}
                </Box>
              </CardActionArea>
            </Card>
          ) : null}
          {trash && trash.item_count > 0 ? (
            <Card sx={{ flex: 1, minWidth: 160 }}>
              <CardActionArea
                aria-label={t('mypage.hygieneTrash')}
                onClick={() => onNavigate?.(TRASH_ROUTE)}
              >
                <Box sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2">{t('mypage.hygieneTrash')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('mypage.hygieneTrashMeta', {
                      count: trash.item_count,
                      size: formatFileSize(trash.total_bytes),
                    })}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {trash.retention_days === 0
                      ? t('mypage.trashRetentionOff')
                      : t('mypage.trashRetention', { days: trashDaysLeft ?? 0 })}
                  </Typography>
                </Box>
              </CardActionArea>
            </Card>
          ) : null}
          {suggestions.length > 0 ? (
            <Card sx={{ flex: 1, minWidth: 160 }}>
              <CardActionArea
                aria-label={t('mypage.hygieneSuggestions')}
                onClick={scrollToSuggestions}
              >
                <Box sx={{ p: 1.5 }}>
                  <Typography variant="subtitle2">{t('mypage.hygieneSuggestions')}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {t('mypage.hygieneSuggestionsMeta', { count: suggestions.length })}
                  </Typography>
                </Box>
              </CardActionArea>
            </Card>
          ) : null}
        </Box>
      ) : null}

      {actions.length > 0 ? (
        <Box component="section" sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('mypage.journalTitle')}
          </Typography>
          <List dense disablePadding>
            {feedRows(actions)}
          </List>
          {actions.length >= JOURNAL_CAP ? (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
              {t('mypage.journalMore')}
            </Typography>
          ) : null}
        </Box>
      ) : null}

      {collections.length > 0 ? (
        <Box component="section" sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('mypage.collectionsStatusTitle')}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {t('mypage.collectionsActiveMeta', { count: activeCount })} ·{' '}
            {t('mypage.collectionsArchivedMeta', { count: archivedCount })}
          </Typography>
          {grantsReceived.length > 0 ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2">{t('mypage.grantsReceived')}</Typography>
              <List dense disablePadding>
                {grantsReceived.map((row) => (
                  <ListItem key={`received-${row.collection_id}`}>
                    <ListItemText
                      primary={row.name}
                      secondary={
                        <Chip
                          size="small"
                          label={
                            row.granted_role === 'editor'
                              ? t('permissions.editor')
                              : t('permissions.viewer')
                          }
                          data-testid="grants-received-role"
                        />
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : null}
          {grantedEntries.length > 0 ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2">{t('mypage.grantsGranted')}</Typography>
              <List dense disablePadding>
                {grantedEntries.flatMap(([collectionId, rows]) =>
                  rows.map((grant) => (
                    <ListItem
                      key={`granted-${collectionId}-${grant.grantee_id}`}
                      secondaryAction={
                        <IconButton
                          edge="end"
                          size="small"
                          data-testid="grants-revoke"
                          aria-label={t('mypage.grantsRevoke')}
                          onClick={() => handleRevoke(Number(collectionId), grant.grantee_id)}
                        >
                          <CloseIcon fontSize="small" />
                        </IconButton>
                      }
                    >
                      <ListItemText
                        primary={grant.username || `user-${grant.grantee_id}`}
                        secondary={String(collectionId)}
                      />
                    </ListItem>
                  ))
                )}
              </List>
            </Box>
          ) : null}
          {collectionFacts.length > 0 ? (
            <Box sx={{ mt: 1 }}>
              <Typography variant="subtitle2">{t('mypage.collectionsFactsTitle')}</Typography>
              <List dense disablePadding>
                {feedRows(collectionFacts)}
              </List>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {suggestions.length > 0 ? (
        <Box component="section" id="dashboard-suggestions" sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('mypage.suggestionsTitle')}
          </Typography>
          <SuggestionsChecklist
            suggestions={suggestions}
            onAccept={handleAccept}
            onDismiss={handleDismiss}
          />
        </Box>
      ) : null}

      {capacitySeries &&
      Array.isArray(capacitySeries.points) &&
      capacitySeries.points.length > 0 ? (
        <Box component="section">
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('mypage.capacityTitle')}
          </Typography>
          <Box
            component="svg"
            viewBox="0 0 100 24"
            preserveAspectRatio="none"
            sx={{ width: '100%', height: 48 }}
            data-testid="capacity-sparkline"
          >
            <polyline
              fill="none"
              stroke="currentColor"
              points={(() => {
                const max = Math.max(...capacitySeries.points.map((p) => Number(p.bytes) || 0), 1);
                return capacitySeries.points
                  .map((point, index) => {
                    const x =
                      capacitySeries.points.length > 1
                        ? (index / (capacitySeries.points.length - 1)) * 100
                        : 0;
                    return `${x},${24 - ((Number(point.bytes) || 0) / max) * 24}`;
                  })
                  .join(' ');
              })()}
            />
          </Box>
        </Box>
      ) : null}

      {message.message.action ? (
        /* useMessage action slot (undo toasts — FileManagerView precedent): the
           accept command's report toast carries Undo through UndoToast. */
        <UndoToast
          show={message.message.show}
          text={message.message.text}
          type={message.message.type}
          action={{
            onAction: message.message.action.onClick,
            disabled: message.message.action.disabled,
          }}
          onClose={message.clearMessage}
        />
      ) : (
        <Snackbar
          open={message.message.show}
          autoHideDuration={4000}
          onClose={message.clearMessage}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          message={message.message.text}
        />
      )}
      <ConfirmDialog
        open={Boolean(cascadeConfirm?.open)}
        onClose={cascadeConfirm?.cancel}
        onConfirm={cascadeConfirm?.confirm}
        title={t('common.confirm')}
        message={t('mypage.journalCascadeConfirm', { count: cascadeConfirm?.laterChanges ?? 0 })}
        confirmText={t('actions.undo')}
        cancelText={t('common.cancel')}
        loading={undoBusy}
        confirmColor="error"
      />
    </Box>
  );
};

export default CollectionDashboard;
