/**
 * CollectionsOverview — MyPage `Collections` content (storage client-domain
 * split; docs/spec/client/components/mypage/content/CollectionsOverview.md).
 * Blocks: my-collections status (counts + grants received/granted with inline
 * revoke + recent merge/archive facts) and the collection-domain
 * system-changes journal feed (30d rows, undo + cascade).
 * No storage hygiene/usage/suggestion reads — those live in StorageDashboard.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
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
import { formatDate } from '../../../utils/format';
import explorerGateway from '../../../services/explorerGateway';

const JOURNAL_CAP = 200; // routes/actions.md §2.4 feed cap (personal scale)
// §4.16 collections-status subset ("recent merge/archive facts w/ undo").
const COLLECTION_FACT_ACTIONS = ['merge', 'archive', 'restore'];
// Report-only rows (permanent delete / empty-trash parity contract — never
// undoable, badge instead of an Undo button). No journaled writer exists for
// these actions in v1; the mapping is the defensive surface.
const REPORT_ONLY_ACTIONS = ['delete-permanent', 'empty-trash'];

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

const CollectionsOverview = ({ user, onUndo, gateway }) => {
  const { t } = useTranslation();
  const resolvedGateway = gateway || explorerGateway;
  const { setTitle } = usePageHeader();
  const message = useMessage();
  const [actions, setActions] = useState([]);
  const [collections, setCollections] = useState([]);
  const [grants, setGrants] = useState({});

  useEffect(() => {
    setTitle(t('mypage.collectionsOverview'));
  }, [setTitle, t]);

  const loadAll = useCallback(async () => {
    const [feed, collectionList] = await Promise.all([
      resolvedGateway.getActions({ domain: 'collection' }),
      resolvedGateway.loadCollections({ include: 'mine,shared,archived' }),
    ]);
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
  }, [resolvedGateway]);

  useEffect(() => {
    const run = async () => {
      try {
        await loadAll();
      } catch (error) {
        // seams absorb internally; a throw is a bug-surface, never a crash
        // eslint-disable-next-line no-console
        console.error('CollectionsOverview load failed:', error);
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

  const feedRows = (rows) =>
    rows.map((row) => <JournalRow key={row.action_id} row={row} onUndo={handleRowUndo} />);

  const collectionFacts = actions.filter((row) => COLLECTION_FACT_ACTIONS.includes(row.action));
  const activeCount = collections.filter((row) => row.status === 'active').length;
  const archivedCount = collections.filter((row) => row.status === 'archived').length;
  const grantsReceived = collections.filter((row) => row.granted_role != null);
  const grantedEntries = Object.entries(grants).filter(([, rows]) => rows.length > 0);

  if (!user) return null;

  return (
    <Box data-testid="collections-overview" sx={{ pb: 4 }}>
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

      {message.message.action ? (
        /* useMessage action slot (undo toasts — FileManagerView precedent). */
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

export default CollectionsOverview;
