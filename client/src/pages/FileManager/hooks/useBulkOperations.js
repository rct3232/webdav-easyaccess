import { useState, useCallback, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import {
  downloadMultipleFiles,
  batchDeleteFiles,
  batchMoveFiles,
  batchCopyFiles,
  checkConflicts,
  getBulkOperationStatus,
  cancelBulkOperation,
} from '../../../services/fileService';
import { useFileOperationProgress } from './useFileOperationProgress';
import { notifyRecentFilesChange } from '../../../services/recentFilesNotifier';

const POLL_INTERVAL_MS = 400;

export const useBulkOperations = (
  selectedNodeIds,
  files,
  onOperationComplete,
  setTreeUpdateTrigger,
  setDropMessage,
  setSelectedFiles,
  setSelectionMode,
  getCurrentNodeId,
  options = {}
) => {
  const { t } = useTranslation();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerAction, setFolderPickerAction] = useState(null);
  const [bulkConflictData, setBulkConflictData] = useState(null);
  const { progressItems, updateProgress } = useFileOperationProgress();

  const {
    markProcessing: markProcessingImpl,
    clearProcessing: clearProcessingImpl,
    shareToken,
  } = options;

  const activeIntervalsRef = useRef(new Set());

  useEffect(() => {
    const intervals = activeIntervalsRef.current;
    return () => {
      intervals.forEach((intervalId) => clearInterval(intervalId));
      intervals.clear();
    };
  }, []);

  const markProcessing = useCallback(
    (nodeIds, opType) => {
      if (typeof markProcessingImpl === 'function') {
        markProcessingImpl(nodeIds, opType);
      }
    },
    [markProcessingImpl]
  );

  const clearProcessing = useCallback(
    (nodeIds) => {
      if (typeof clearProcessingImpl === 'function') {
        clearProcessingImpl(nodeIds);
      }
    },
    [clearProcessingImpl]
  );

  // 기존 실패 항목들을 자동으로 dismiss
  const dismissFailedItems = useCallback(() => {
    progressItems.forEach((item) => {
      if (item.status === 'error' && item.keepOnError) {
        updateProgress({ id: item.id, remove: true });
      }
    });
  }, [progressItems, updateProgress]);

  // 공통 progress 업데이트 함수
  const updateProgressWithRetry = useCallback(
    (progressId, updates, retryData) => {
      updateProgress({
        id: progressId,
        ...updates,
        retryData: retryData || updates.retryData,
      });
    },
    [updateProgress]
  );

  const getActionName = useCallback(
    (action) => {
      return action === 'move' ? t('actions.move') : t('actions.copy');
    },
    [t]
  );

  const handleBulkMove = useCallback(() => {
    dismissFailedItems();
    setFolderPickerAction('move');
    setFolderPickerOpen(true);
  }, [dismissFailedItems]);

  const handleBulkCopy = useCallback(() => {
    dismissFailedItems();
    setFolderPickerAction('copy');
    setFolderPickerOpen(true);
  }, [dismissFailedItems]);

  const handleBulkDelete = useCallback(
    async (retryData = null, onConfirm = null) => {
      const nodeIds = retryData?.nodeIds || Array.from(selectedNodeIds);
      if (nodeIds.length === 0) return;
      const startedNodeId =
        retryData?.startedNodeId ||
        (typeof getCurrentNodeId === 'function' ? getCurrentNodeId() : undefined);

      if (!retryData) {
        dismissFailedItems();
        if (onConfirm) {
          onConfirm(nodeIds);
          return;
        }
        setSelectedFiles(new Set());
        setSelectionMode(false);
      }

      markProcessing(nodeIds, 'delete');
      const progressId = retryData?.progressId || `delete_${Date.now()}`;
      const retryDataObj = { type: 'delete', nodeIds, startedNodeId };

      updateProgressWithRetry(
        progressId,
        {
          type: 'delete',
          status: 'preparing',
          progress: 0,
          total: nodeIds.length,
          current: t('fileManager.bulkPreparing'),
          name: t('fileManager.bulkItemCount', {
            count: nodeIds.length,
            action: t('actions.delete'),
          }),
        },
        retryDataObj
      );

      let jobId;
      try {
        const data = await batchDeleteFiles(nodeIds);
        jobId = data?.jobId;
      } catch (err) {
        console.error('Bulk delete start failed:', err);
        updateProgressWithRetry(
          progressId,
          {
            type: 'delete',
            status: 'error',
            error: err.message || t('fileManager.bulkDeleteStartFail'),
            keepOnError: true,
          },
          retryDataObj
        );
        clearProcessing(nodeIds);
        return;
      }

      updateProgressWithRetry(
        progressId,
        { jobId, status: 'processing', current: t('fileManager.bulkDeleting') },
        retryDataObj
      );

      const poll = async () => {
        try {
          const job = await getBulkOperationStatus(jobId);
          const {
            status: jobStatus,
            progress: jobProgress,
            total: jobTotal,
            results: jobResults = [],
          } = job;
          const succeededNodeIds = jobResults
            .filter((r) => r.status === 'succeeded')
            .map((r) => r.nodeId);
          const failed = jobResults.filter((r) => r.status === 'failed');
          const skippedNodeIds = jobResults
            .filter((r) => r.status === 'skipped')
            .map((r) => r.nodeId);
          const skippedSet = new Set(skippedNodeIds);
          const failCount = failed.length;
          const successCount = succeededNodeIds.length;
          const failedItems = failed.map((f) => ({
            fileName: f.basename || String(f.nodeId) || t('common.unknown'),
            error: f.error || t('common.unknownError'),
          }));

          updateProgressWithRetry(
            progressId,
            {
              progress: jobProgress,
              total: jobTotal,
              current: jobStatus === 'running' ? t('fileManager.bulkDeleting') : undefined,
            },
            retryDataObj
          );

          if (jobStatus !== 'pending' && jobStatus !== 'running') {
            activeIntervalsRef.current.delete(intervalId);
            clearInterval(intervalId);
            const deletedFolders = [];
            const deletedNodeIds = [];
            succeededNodeIds.forEach((nid) => {
              const file = files.find((f) => f.nodeId === nid);
              if (file?.type === 'directory') {
                deletedNodeIds.push(nid);
                deletedFolders.push(file.display_path || nid);
              }
            });
            const finalStatus =
              jobStatus === 'cancelled'
                ? 'warning'
                : failCount > 0
                  ? 'error'
                  : skippedSet.size > 0
                    ? 'warning'
                    : 'completed';
            const currentMsg =
              jobStatus === 'cancelled'
                ? t('fileManager.bulkCancelledDone', { done: successCount, total: nodeIds.length })
                : failCount > 0
                  ? t('fileManager.bulkDeleteDonePartial', {
                      done: successCount,
                      total: nodeIds.length,
                      failCount,
                    })
                  : t('fileManager.bulkDeleteDone', { done: successCount, total: nodeIds.length });
            updateProgressWithRetry(
              progressId,
              {
                type: 'delete',
                status: finalStatus,
                progress: successCount,
                total: nodeIds.length,
                current: currentMsg,
                name: t('fileManager.bulkItemCount', {
                  count: nodeIds.length,
                  action: t('actions.delete'),
                }),
                error:
                  jobStatus === 'cancelled'
                    ? t('common.cancelledByUser')
                    : failCount > 0
                      ? t('fileManager.uploadFailCount', { count: failCount })
                      : skippedSet.size > 0
                        ? t('fileManager.bulkExcludedByPermission', { count: skippedSet.size })
                        : undefined,
                failedItems: failedItems.length > 0 ? failedItems : undefined,
                keepOnError: failCount > 0 || skippedSet.size > 0 || jobStatus === 'cancelled',
                skippedNodeIds: skippedSet.size > 0 ? Array.from(skippedSet) : undefined,
                skippedCount: skippedSet.size > 0 ? skippedSet.size : undefined,
              },
              retryDataObj
            );

            if (successCount > 0) {
              try {
                notifyRecentFilesChange();
              } catch (err) {
                console.error('Failed to refresh recent files after bulk delete:', err);
              }
              deletedNodeIds.forEach((nodeId) => {
                setTreeUpdateTrigger({ type: 'deleted', nodeId, timestamp: Date.now() });
              });
              if (deletedNodeIds.length > 0) {
                setTimeout(
                  () => setTreeUpdateTrigger({ type: 'refresh', timestamp: Date.now() }),
                  500
                );
              }
            }
            clearProcessing(nodeIds);
            if (onOperationComplete) {
              onOperationComplete({
                opType: 'delete',
                startedNodeId,
                deletedNodeIds,
                deletedFolderPaths: deletedFolders,
              });
            }
            if (failCount === 0 && skippedSet.size === 0 && jobStatus !== 'cancelled') {
              setTimeout(() => updateProgress({ id: progressId, remove: true }), 3000);
            }
          }
        } catch (err) {
          console.error('Poll bulk delete status failed:', err);
        }
      };

      const intervalId = setInterval(poll, POLL_INTERVAL_MS);
      activeIntervalsRef.current.add(intervalId);
      poll();
    },
    [
      selectedNodeIds,
      files,
      onOperationComplete,
      setTreeUpdateTrigger,
      setSelectedFiles,
      setSelectionMode,
      getCurrentNodeId,
      dismissFailedItems,
      markProcessing,
      clearProcessing,
      updateProgressWithRetry,
      updateProgress,
      t,
    ]
  );

  const handleBulkDownload = useCallback(async () => {
    if (selectedNodeIds.size === 0) return;
    dismissFailedItems();
    setSelectionMode(false);

    const nodeIds = Array.from(selectedNodeIds);
    const progressId = `download_${Date.now()}`;

    updateProgress({
      id: progressId,
      type: 'download',
      status: 'preparing',
      progress: 0,
      total: nodeIds.length,
      current: '',
      zipName: '',
    });

    try {
      const result = await downloadMultipleFiles(
        nodeIds,
        (progress) => {
          updateProgress({ ...progress, id: progressId });
        },
        shareToken ? { shareToken } : undefined
      );

      const skippedCount = result?.skippedCount || 0;
      const skippedNodeIdsResult = result?.skippedInfo?.nodeIds || [];
      const skippedTruncated = Boolean(result?.skippedInfo?.truncated);
      if (skippedCount > 0 || skippedNodeIdsResult.length > 0) {
        updateProgress({
          id: progressId,
          type: 'download',
          status: 'warning',
          error: t('fileManager.bulkExcludedByPermission', {
            count: skippedCount || skippedNodeIdsResult.length,
          }),
          keepOnError: true,
          skippedNodeIds: skippedNodeIdsResult,
          skippedCount: skippedCount || skippedNodeIdsResult.length,
          skippedTruncated,
        });
      }

      setSelectedFiles(new Set());
      setSelectionMode(false);

      if (!(skippedCount > 0 || skippedNodeIdsResult.length > 0)) {
        setTimeout(() => {
          updateProgress({ id: progressId, remove: true });
        }, 3000);
      }
    } catch (error) {
      console.error('Bulk download error:', error);
      updateProgress({
        id: progressId,
        status: 'error',
        error: error.message,
      });
    }
  }, [
    selectedNodeIds,
    dismissFailedItems,
    setSelectionMode,
    updateProgress,
    shareToken,
    t,
    setSelectedFiles,
  ]);

  /**
   * Execute bulk operation after pre-checks (Job + polling)
   */
  const executeBulkOperation = useCallback(
    async (destinationParentNodeId, retryData = null, onConflict = 'error') => {
      const action = retryData?.type || folderPickerAction;
      const nodeIds = retryData?.nodeIds || Array.from(selectedNodeIds);
      if (!action || nodeIds.length === 0) return;
      const startedNodeId =
        retryData?.startedNodeId ||
        (typeof getCurrentNodeId === 'function' ? getCurrentNodeId() : undefined);

      setSelectionMode(false);
      setSelectedFiles(new Set());
      if (!retryData) dismissFailedItems();

      markProcessing(nodeIds, action);
      const progressId = retryData?.progressId || `${action}_${Date.now()}`;
      const actionName = getActionName(action);
      const retryDataObj = { type: action, nodeIds, destinationParentNodeId, startedNodeId };

      const operations = nodeIds.map((sourceNodeId) => ({
        sourceNodeId,
        destinationParentNodeId,
      }));

      updateProgressWithRetry(
        progressId,
        {
          type: action,
          status: 'preparing',
          progress: 0,
          total: nodeIds.length,
          current: t('fileManager.bulkPreparing'),
          name: t('fileManager.bulkItemCount', { count: nodeIds.length, action: actionName }),
        },
        retryDataObj
      );

      let jobId;
      try {
        const data =
          action === 'move'
            ? await batchMoveFiles(operations, onConflict)
            : await batchCopyFiles(operations, onConflict);
        jobId = data?.jobId;
      } catch (err) {
        console.error('Bulk move/copy start failed:', err);
        updateProgressWithRetry(
          progressId,
          {
            type: action,
            status: 'error',
            error: err.message || t('fileManager.bulkStartFail'),
            keepOnError: true,
          },
          retryDataObj
        );
        clearProcessing(nodeIds);
        setFolderPickerOpen(false);
        setFolderPickerAction(null);
        return;
      }

      updateProgressWithRetry(
        progressId,
        {
          jobId,
          status: 'processing',
          current: t('fileManager.bulkActionProgress', { action: actionName }),
        },
        retryDataObj
      );

      const poll = async () => {
        try {
          const job = await getBulkOperationStatus(jobId);
          const {
            status: jobStatus,
            progress: jobProgress,
            total: jobTotal,
            results: jobResults = [],
          } = job;
          const succeeded = jobResults
            .filter((r) => r.status === 'succeeded')
            .map((r) => ({
              sourceNodeId: r.sourceNodeId,
              destinationParentNodeId: r.destinationParentNodeId,
            }));
          const failed = jobResults.filter((r) => r.status === 'failed');
          const skippedByConflict = jobResults
            .filter((r) => r.status === 'skippedByConflict')
            .map((r) => r.sourceNodeId || r.nodeId);
          const skippedByPermission = jobResults
            .filter((r) => r.status === 'skippedByPermission')
            .map((r) => r.sourceNodeId || r.nodeId);
          const failCount = failed.length;
          const successCount = succeeded.length;
          const hasSkippedByConflict = skippedByConflict.length > 0;
          const hasSkippedByPermission = skippedByPermission.length > 0;
          const hasAnySkipped = hasSkippedByConflict || hasSkippedByPermission;
          const failedItems = failed.map((f) => ({
            fileName: f.basename || String(f.sourceNodeId || f.nodeId) || t('common.unknown'),
            error: f.error || t('common.unknownError'),
          }));

          updateProgressWithRetry(
            progressId,
            {
              progress: jobProgress,
              total: jobTotal,
              current:
                jobStatus === 'running'
                  ? t('fileManager.bulkActionProgress', { action: actionName })
                  : undefined,
            },
            retryDataObj
          );

          if (jobStatus !== 'pending' && jobStatus !== 'running') {
            activeIntervalsRef.current.delete(intervalId);
            clearInterval(intervalId);
            let skippedErrorMsg;
            if (hasAnySkipped) {
              const parts = [];
              if (hasSkippedByConflict)
                parts.push(t('fileManager.bulkSkippedCount', { count: skippedByConflict.length }));
              if (hasSkippedByPermission)
                parts.push(
                  t('fileManager.bulkExcludedByPermission', { count: skippedByPermission.length })
                );
              skippedErrorMsg = parts.join(', ');
            }
            const finalStatus =
              jobStatus === 'cancelled'
                ? 'warning'
                : failCount > 0
                  ? 'error'
                  : hasAnySkipped
                    ? 'warning'
                    : 'completed';
            const currentMsg =
              jobStatus === 'cancelled'
                ? t('fileManager.bulkCancelledDone', { done: successCount, total: nodeIds.length })
                : failCount > 0
                  ? t('fileManager.bulkActionDonePartial', {
                      done: successCount,
                      total: nodeIds.length,
                      action: actionName,
                      failCount,
                    })
                  : t('fileManager.bulkActionDone', {
                      done: successCount,
                      total: nodeIds.length,
                      action: actionName,
                    });
            updateProgressWithRetry(
              progressId,
              {
                type: action,
                status: finalStatus,
                progress: successCount,
                total: nodeIds.length,
                current: currentMsg,
                name: t('fileManager.bulkItemCount', { count: nodeIds.length, action: actionName }),
                error:
                  jobStatus === 'cancelled'
                    ? t('common.cancelledByUser')
                    : failCount > 0
                      ? t('fileManager.uploadFailCount', { count: failCount })
                      : skippedErrorMsg,
                failedItems: failedItems.length > 0 ? failedItems : undefined,
                keepOnError: failCount > 0 || hasAnySkipped || jobStatus === 'cancelled',
                skippedNodeIdsByConflict: hasSkippedByConflict ? skippedByConflict : undefined,
                skippedCountByConflict: hasSkippedByConflict ? skippedByConflict.length : undefined,
                skippedNodeIdsByPermission: hasSkippedByPermission
                  ? skippedByPermission
                  : undefined,
                skippedCountByPermission: hasSkippedByPermission
                  ? skippedByPermission.length
                  : undefined,
              },
              retryDataObj
            );

            if (successCount > 0) {
              if (action === 'move') {
                try {
                  notifyRecentFilesChange();
                } catch (err) {
                  console.error('Failed to refresh recent files after bulk move:', err);
                }
              }
            }
            clearProcessing(nodeIds);
            if (onOperationComplete) {
              onOperationComplete({
                opType: action,
                startedNodeId,
                targetParentNodeId: destinationParentNodeId,
              });
            }
            if (failCount === 0 && !hasAnySkipped && jobStatus !== 'cancelled') {
              setTimeout(() => updateProgress({ id: progressId, remove: true }), 3000);
            }
            if (!retryData) {
              setFolderPickerOpen(false);
              setFolderPickerAction(null);
            }
          }
        } catch (err) {
          console.error('Poll bulk move/copy status failed:', err);
        }
      };

      const intervalId = setInterval(poll, POLL_INTERVAL_MS);
      activeIntervalsRef.current.add(intervalId);
      poll();
    },
    [
      selectedNodeIds,
      folderPickerAction,
      onOperationComplete,
      setSelectedFiles,
      setSelectionMode,
      getCurrentNodeId,
      dismissFailedItems,
      markProcessing,
      clearProcessing,
      updateProgressWithRetry,
      getActionName,
      updateProgress,
      t,
    ]
  );

  /**
   * Handle folder picker selection with conflict check
   */
  const handleFolderPickerSelect = useCallback(
    async (destinationParentNodeId, retryData = null) => {
      const action = retryData?.type || folderPickerAction;
      const nodeIds = retryData?.nodeIds || Array.from(selectedNodeIds);

      if (!action || nodeIds.length === 0) return;

      // Prepare moves/copies array for conflict check
      const operations = nodeIds.map((sourceNodeId) => ({
        sourceNodeId,
        destinationParentNodeId,
        type: action,
      }));

      const progressId = retryData?.progressId || `${action}_${Date.now()}`;
      const startedNodeId =
        retryData?.startedNodeId ??
        (typeof getCurrentNodeId === 'function' ? getCurrentNodeId() : undefined);
      const actionName = getActionName(action);
      const retryDataForModal = {
        type: action,
        nodeIds,
        destinationParentNodeId,
        startedNodeId,
        progressId,
      };

      updateProgressWithRetry(
        progressId,
        {
          type: action,
          status: 'preparing',
          progress: 0,
          total: nodeIds.length,
          current: t('fileManager.statusConflictCheck'),
          name: t('fileManager.bulkItemCount', { count: nodeIds.length, action: actionName }),
        },
        retryDataForModal
      );

      markProcessing(nodeIds, action);

      try {
        const conflicts = await checkConflicts(operations);

        if (conflicts && conflicts.length > 0) {
          updateProgress({ id: progressId, remove: true });
          clearProcessing(nodeIds);
          setBulkConflictData({
            destinationParentNodeId,
            retryData: retryData ?? { type: action, nodeIds },
            conflicts,
            action,
          });
          return;
        }

        await executeBulkOperation(destinationParentNodeId, {
          type: action,
          nodeIds,
          destinationParentNodeId,
          startedNodeId,
          progressId,
        });
        setFolderPickerOpen(false);
        setFolderPickerAction(null);
      } catch (error) {
        console.error('Bulk conflict check failed:', error);
        clearProcessing(nodeIds);
        await executeBulkOperation(destinationParentNodeId, {
          type: action,
          nodeIds,
          destinationParentNodeId,
          startedNodeId,
          progressId,
        });
        setFolderPickerOpen(false);
        setFolderPickerAction(null);
      }
    },
    [
      selectedNodeIds,
      folderPickerAction,
      getCurrentNodeId,
      getActionName,
      updateProgressWithRetry,
      updateProgress,
      executeBulkOperation,
      markProcessing,
      clearProcessing,
      t,
    ]
  );

  /**
   * Resolve bulk conflicts
   */
  const resolveBulkConflict = useCallback(
    async (resolution) => {
      if (!bulkConflictData) return;

      const { destinationParentNodeId, retryData, conflicts } = bulkConflictData;
      setBulkConflictData(null);

      // When user chooses skip: exclude conflicting source nodeIds from the operation payload
      // so the server receives only non-conflicting files and skips redundant getConflicts.
      let effectiveRetryData = retryData;
      if (resolution === 'skip' && conflicts && Array.isArray(conflicts) && conflicts.length > 0) {
        const conflictSourceNodeIds = new Set(conflicts.map((c) => c.sourceNodeId).filter(Boolean));
        const filteredNodeIds = (retryData.nodeIds || []).filter(
          (n) => !conflictSourceNodeIds.has(n)
        );
        effectiveRetryData = { ...retryData, nodeIds: filteredNodeIds };
      }

      await executeBulkOperation(destinationParentNodeId, effectiveRetryData, resolution);
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
    },
    [bulkConflictData, executeBulkOperation]
  );

  const handleRetry = useCallback(
    async (progressId) => {
      const progressItem = progressItems.find((item) => item.id === progressId);
      if (!progressItem || !progressItem.retryData) {
        console.error('Retry data not found for progress item:', progressId);
        return;
      }
      const { type, nodeIds, destinationParentNodeId, startedNodeId } = progressItem.retryData;
      if (type === 'delete') {
        await handleBulkDelete({ nodeIds, progressId, startedNodeId });
      } else if (type === 'move' || type === 'copy') {
        await handleFolderPickerSelect(destinationParentNodeId, {
          type,
          nodeIds,
          progressId,
          startedNodeId,
        });
      }
    },
    [progressItems, handleBulkDelete, handleFolderPickerSelect]
  );

  const handleCancelBulkOperation = useCallback(
    async (progressId) => {
      const progressItem = progressItems.find((item) => item.id === progressId);
      const jobId = progressItem?.jobId;
      if (!jobId) return;
      try {
        await cancelBulkOperation(jobId);
      } catch (err) {
        console.error('Cancel bulk operation failed:', err);
      }
    },
    [progressItems]
  );

  return {
    folderPickerOpen,
    folderPickerAction,
    progressItems,
    updateProgress,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDelete,
    handleBulkDownload,
    handleFolderPickerSelect,
    handleRetry,
    handleCancelBulkOperation,
    dismissFailedItems,
    setFolderPickerOpen,
    setFolderPickerAction,
    bulkConflictData,
    resolveBulkConflict,
    setBulkConflictData,
  };
};
