/**
 * StorageDashboard — MyPage `Storage` content (storage client-domain split;
 * docs/spec/client/components/mypage/content/StorageDashboard.md).
 * Blocks (render order = contract): storage-usage summary + sparkline, hygiene
 * cards (pull-overview deep-links, NEVER an action center), cleanup suggestion
 * checklist (accept → undo toast / dismiss). Collection status and the
 * collection journal feed live in CollectionsOverview — this surface performs
 * no collection/actions reads.
 * Zero/absent data hides blocks (absent-not-disabled); every read rides the
 * failure-absorbing explorerGateway storage seams.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Card, CardActionArea, Snackbar, Typography } from '@mui/material';

import { usePageHeader } from '../../../contexts/PageHeaderContext';
import { useMessage } from '../../../hooks/useMessage';
import { useUndoToast } from '../../../hooks/useUndoToast';
import ConfirmDialog from '../../dialogs/ConfirmDialog';
import { UndoToast } from '../../feedback';
import { formatFileSize } from '../../../utils/format';
import explorerGateway from '../../../services/explorerGateway';
import StorageCleanupSuggestions from './StorageCleanupSuggestions';
import StorageUsageSummary from './StorageUsageSummary';

const DAY_MS = 24 * 60 * 60 * 1000;
const TRASH_ROUTE = '/files/__trash__';
const SUGGESTIONS_ANCHOR = 'storage-suggestions';

function normalizeOverview(payload) {
  const hygiene =
    payload?.hygiene && typeof payload.hygiene === 'object' ? payload.hygiene : payload || {};
  return {
    duplicates: hygiene.duplicates,
    nearDuplicates: hygiene.near_duplicates,
    trash: hygiene.trash,
    suggestions: Array.isArray(payload?.suggestions)
      ? payload.suggestions
      : Array.isArray(hygiene.suggestions)
        ? hygiene.suggestions
        : [],
  };
}

function normalizeUsage(payload) {
  if (!payload || typeof payload !== 'object') return { current: null, series: null };
  const current =
    payload.current ??
    payload.usage ??
    (payload.total_bytes != null || payload.total != null ? payload : null);
  const series = Array.isArray(payload.series)
    ? { points: payload.series }
    : (payload.series ?? (Array.isArray(payload.points) ? { points: payload.points } : null));
  return { current, series };
}

const StorageDashboard = ({ user, onNavigate, onMessage, gateway }) => {
  const { t } = useTranslation();
  const resolvedGateway = gateway || explorerGateway;
  const { setTitle } = usePageHeader();
  const message = useMessage();
  const [overview, setOverview] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    setTitle(t('mypage.storage'));
  }, [setTitle, t]);

  const loadAll = useCallback(async () => {
    const [hygienePayload, usagePayload] = await Promise.all([
      resolvedGateway.getStorageHygiene(),
      resolvedGateway.getStorageUsage(),
    ]);
    setOverview(hygienePayload ?? null);
    setUsage(usagePayload ?? null);
  }, [resolvedGateway]);

  useEffect(() => {
    const run = async () => {
      try {
        await loadAll();
      } catch (error) {
        // seams absorb internally; a throw is a bug-surface, never a crash
        // eslint-disable-next-line no-console
        console.error('StorageDashboard load failed:', error);
      }
    };
    run();
    // loadAll re-creates with the gateway identity; run the initial read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const {
    cascadeConfirm,
    busy: undoBusy,
    showUndoToast,
  } = useUndoToast({
    gateway: resolvedGateway,
    message,
    refresh: loadAll,
  });

  const scrollToSuggestions = useCallback(() => {
    const target = document.getElementById(SUGGESTIONS_ANCHOR);
    if (target && typeof target.scrollIntoView === 'function') {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleAccept = useCallback(
    async (nodeIds) => {
      const payload = await resolvedGateway.acceptStorageSuggestions(nodeIds);
      if (payload) {
        const moved = Array.isArray(payload.trashed) ? payload.trashed.length : 0;
        const actionId = payload.undo ? payload.undo.action_id : null;
        if (actionId != null) {
          // Journaled command: report toast WITH an Undo button — the
          // command-unit row restores every trashed node.
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
      const payload = await resolvedGateway.dismissStorageSuggestion(suggestionId);
      // Absorbed failure keeps the row (no toast lies); success refreshes the
      // list silently — dismiss never toasts (StorageCleanupSuggestions §2.3).
      if (payload) loadAll();
      return payload;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [resolvedGateway, loadAll]
  );

  const { duplicates, nearDuplicates, trash, suggestions } = useMemo(
    () => normalizeOverview(overview),
    [overview]
  );
  const { current, series } = useMemo(() => normalizeUsage(usage), [usage]);

  const trashDaysLeft =
    trash && trash.retention_days > 0 && trash.oldest_deleted_at
      ? Math.max(
          0,
          Math.ceil(
            trash.retention_days - (Date.now() - Date.parse(trash.oldest_deleted_at)) / DAY_MS
          )
        )
      : null;

  const showCards =
    Boolean(
      duplicates &&
      (duplicates.group_count > 0 || (nearDuplicates && nearDuplicates.group_count > 0))
    ) ||
    Boolean(trash && trash.item_count > 0) ||
    suggestions.length > 0;

  if (!user) return null;

  return (
    <Box data-testid="storage-dashboard" sx={{ pb: 4 }}>
      <StorageUsageSummary current={current} series={series} />

      {showCards ? (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 3 }}>
          {duplicates &&
          (duplicates.group_count > 0 || (nearDuplicates && nearDuplicates.group_count > 0)) ? (
            <Card sx={{ flex: 1, minWidth: 160 }}>
              <CardActionArea
                aria-label={t('mypage.hygieneDuplicates')}
                data-testid="storage-hygiene-duplicates"
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
                data-testid="storage-hygiene-trash"
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
                data-testid="storage-hygiene-suggestions"
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

      {suggestions.length > 0 ? (
        <Box component="section" id={SUGGESTIONS_ANCHOR} sx={{ mb: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            {t('mypage.suggestionsTitle')}
          </Typography>
          <StorageCleanupSuggestions
            suggestions={suggestions}
            onAccept={handleAccept}
            onDismiss={handleDismiss}
          />
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

export default StorageDashboard;
