import { useCallback, useRef, useState } from 'react';
import { emptyTrash, purgeTrashedItem, restoreTrashedItem } from '../../../services/fileService';
import { notifyTrashChanged } from '../../../services/trashNotifier';
import { getServerErrorDisplay } from '../../../utils/errorUtils';

/**
 * Trash-view operation controller (DEF-16 P9).
 *
 * Owns restore / permanent-delete (purge) / empty-trash flows: confirm-dialog
 * state, FileOperationProgress items for multi-item runs, success toasts for
 * single-item runs, and post-operation refresh + trash-icon notification.
 *
 * Gates are enforced by the callers (row write permission for restore/purge,
 * `user.is_admin` for empty trash); server errors surface through
 * `getServerErrorDisplay` with trash-specific fallback keys.
 */
export const useTrashOperations = ({
  t,
  showError,
  refreshNow,
  updateProgress,
  setDropMessage,
} = {}) => {
  const [restoreConfirmState, setRestoreConfirmState] = useState(null);
  const [purgeConfirmState, setPurgeConfirmState] = useState(null);
  const [emptyTrashConfirmOpen, setEmptyTrashConfirmOpen] = useState(false);
  const pendingRestoreNodeIdsRef = useRef([]);
  const pendingPurgeNodeIdsRef = useRef([]);

  const showSuccess = useCallback(
    (message) => {
      if (typeof setDropMessage === 'function') {
        setDropMessage({ show: true, text: message, type: 'success' });
      }
    },
    [setDropMessage]
  );

  const buildProgressBase = useCallback(
    (type, nodeIds) => ({
      id: `trash_${type}_${Date.now()}`,
      type,
      status: 'preparing',
      progress: 0,
      total: nodeIds.length,
      current: t('fileManager.bulkPreparing'),
      name: t('fileManager.bulkItemCount', { count: nodeIds.length, action: t(`actions.${type}`) }),
    }),
    [t]
  );

  const runTrashOperation = useCallback(
    async ({ type, nodeIds, execute }) => {
      const ids = Array.isArray(nodeIds) ? nodeIds.filter((id) => id != null) : [];
      if (ids.length === 0) return;

      const base = buildProgressBase(type, ids);
      const singleItem = ids.length === 1;

      if (!singleItem) {
        updateProgress(base);
      }

      const failedItems = [];
      let done = 0;
      for (const nodeId of ids) {
        try {
          await execute(nodeId);
          done += 1;
        } catch (error) {
          failedItems.push({
            fileName: String(nodeId),
            error:
              getServerErrorDisplay(error?.response?.data, t) ||
              t(`fileManager.trash${type === 'restore' ? 'Restore' : 'Purge'}Fail`),
          });
        }
        if (!singleItem) {
          updateProgress({
            ...base,
            status: 'processing',
            progress: done,
            total: ids.length,
            current: t(`fileManager.bulkActionProgress`, { action: t(`actions.${type}`) }),
          });
        }
      }

      if (singleItem) {
        if (done === ids.length) {
          showSuccess(
            t(type === 'restore' ? 'fileManager.trashRestoreDone' : 'fileManager.trashPurgeDone')
          );
        } else if (typeof showError === 'function') {
          showError(
            failedItems[0]?.error ||
              t(type === 'restore' ? 'fileManager.trashRestoreFail' : 'fileManager.trashPurgeFail')
          );
        }
      } else {
        const failCount = failedItems.length;
        updateProgress({
          ...base,
          status: failCount === 0 ? 'completed' : 'error',
          progress: done,
          total: ids.length,
          current:
            failCount === 0
              ? t('fileManager.bulkActionDone', {
                  done,
                  total: ids.length,
                  action: t(`actions.${type}`),
                })
              : t('fileManager.bulkActionDonePartial', {
                  done,
                  total: ids.length,
                  action: t(`actions.${type}`),
                  failCount,
                }),
          error: failCount > 0 ? t('fileManager.uploadFailCount', { count: failCount }) : undefined,
          failedItems: failCount > 0 ? failedItems : undefined,
          keepOnError: failCount > 0 || undefined,
        });
        if (failCount === 0) {
          const progressId = base.id;
          setTimeout(() => updateProgress({ id: progressId, remove: true }), 3000);
        }
      }

      if (done > 0) {
        notifyTrashChanged();
        if (typeof refreshNow === 'function') refreshNow();
      }
    },
    [buildProgressBase, refreshNow, showError, showSuccess, t, updateProgress]
  );

  const restoreTrashNodeIds = useCallback(
    (nodeIds) =>
      runTrashOperation({ type: 'restore', nodeIds, execute: (id) => restoreTrashedItem(id) }),
    [runTrashOperation]
  );

  const purgeTrashNodeIds = useCallback(
    (nodeIds) =>
      runTrashOperation({ type: 'purge', nodeIds, execute: (id) => purgeTrashedItem(id) }),
    [runTrashOperation]
  );

  // Single-item flows (context menu / action sheet / properties dialog).
  const handleTrashRestore = useCallback(
    (file) => {
      if (!file?.nodeId) return Promise.resolve();
      return restoreTrashNodeIds([file.nodeId]);
    },
    [restoreTrashNodeIds]
  );

  const handleTrashPurge = useCallback(
    (file) => {
      if (!file?.nodeId) return Promise.resolve();
      return purgeTrashNodeIds([file.nodeId]);
    },
    [purgeTrashNodeIds]
  );

  // Confirm-dialog flows.
  const openRestoreConfirm = useCallback((nodeIds) => {
    const ids = Array.isArray(nodeIds) ? nodeIds : Array.from(nodeIds || []);
    if (ids.length === 0) return;
    pendingRestoreNodeIdsRef.current = ids;
    setRestoreConfirmState({ nodeIds: ids });
  }, []);

  const closeRestoreConfirm = useCallback(() => {
    pendingRestoreNodeIdsRef.current = [];
    setRestoreConfirmState(null);
  }, []);

  const confirmRestore = useCallback(async () => {
    const nodeIds = pendingRestoreNodeIdsRef.current;
    closeRestoreConfirm();
    await restoreTrashNodeIds(nodeIds);
  }, [closeRestoreConfirm, restoreTrashNodeIds]);

  const openPurgeConfirm = useCallback((nodeIds) => {
    const ids = Array.isArray(nodeIds) ? nodeIds : Array.from(nodeIds || []);
    if (ids.length === 0) return;
    pendingPurgeNodeIdsRef.current = ids;
    setPurgeConfirmState({ nodeIds: ids });
  }, []);

  const closePurgeConfirm = useCallback(() => {
    pendingPurgeNodeIdsRef.current = [];
    setPurgeConfirmState(null);
  }, []);

  const confirmPurge = useCallback(async () => {
    const nodeIds = pendingPurgeNodeIdsRef.current;
    closePurgeConfirm();
    await purgeTrashNodeIds(nodeIds);
  }, [closePurgeConfirm, purgeTrashNodeIds]);

  const openEmptyTrashConfirm = useCallback(() => {
    setEmptyTrashConfirmOpen(true);
  }, []);

  const closeEmptyTrashConfirm = useCallback(() => {
    setEmptyTrashConfirmOpen(false);
  }, []);

  const confirmEmptyTrash = useCallback(async () => {
    closeEmptyTrashConfirm();
    const base = buildProgressBase('purge', [0]);
    updateProgress({ ...base, total: 1, current: t('fileManager.bulkPreparing') });
    try {
      await emptyTrash();
      updateProgress({
        ...base,
        status: 'completed',
        progress: 1,
        total: 1,
        current: t('fileManager.trashEmptyDone'),
      });
      notifyTrashChanged();
      if (typeof refreshNow === 'function') refreshNow();
      setTimeout(() => updateProgress({ id: base.id, remove: true }), 3000);
    } catch (error) {
      updateProgress({
        ...base,
        status: 'error',
        error: getServerErrorDisplay(error?.response?.data, t) || t('fileManager.trashEmptyFail'),
        keepOnError: true,
      });
      if (typeof showError === 'function') {
        showError(
          getServerErrorDisplay(error?.response?.data, t) || t('fileManager.trashEmptyFail')
        );
      }
    }
  }, [buildProgressBase, closeEmptyTrashConfirm, refreshNow, showError, t, updateProgress]);

  return {
    restoreConfirmState,
    purgeConfirmState,
    emptyTrashConfirmOpen,
    openRestoreConfirm,
    openPurgeConfirm,
    openEmptyTrashConfirm,
    closeRestoreConfirm,
    closePurgeConfirm,
    closeEmptyTrashConfirm,
    confirmRestore,
    confirmPurge,
    confirmEmptyTrash,
    handleTrashRestore,
    handleTrashPurge,
  };
};
