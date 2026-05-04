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
import {
  applyRecentFilesAfterBulkDelete,
  applyRecentFilesAfterBulkMove,
} from '../../../services/recentFilesRepository';

const POLL_INTERVAL_MS = 400;

export const useBulkOperations = (
  selectedFiles,
  files,
  onOperationComplete,
  setTreeUpdateTrigger,
  setDropMessage,
  setSelectedFiles,
  setSelectionMode,
  getCurrentPath,
  options = {}
) => {
  const { t } = useTranslation();
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerAction, setFolderPickerAction] = useState(null);
  const [bulkConflictData, setBulkConflictData] = useState(null);
  const { progressItems, updateProgress } = useFileOperationProgress();

  const { markProcessing: markProcessingImpl, clearProcessing: clearProcessingImpl, shareToken } = options;

  const activeIntervalsRef = useRef(new Set());

  useEffect(() => {
    return () => {
      activeIntervalsRef.current.forEach(intervalId => clearInterval(intervalId));
      activeIntervalsRef.current.clear();
    };
  }, []);

  const markProcessing = useCallback((filePaths, opType) => {
    if (typeof markProcessingImpl === 'function') {
      markProcessingImpl(filePaths, opType);
    }
  }, [markProcessingImpl]);

  const clearProcessing = useCallback((filePaths) => {
    if (typeof clearProcessingImpl === 'function') {
      clearProcessingImpl(filePaths);
    }
  }, [clearProcessingImpl]);

  // 기존 실패 항목들을 자동으로 dismiss
  const dismissFailedItems = useCallback(() => {
    progressItems.forEach(item => {
      if (item.status === 'error' && item.keepOnError) {
        updateProgress({ id: item.id, remove: true });
      }
    });
  }, [progressItems, updateProgress]);

  // 공통 progress 업데이트 함수
  const updateProgressWithRetry = useCallback((progressId, updates, retryData) => {
    updateProgress({
      id: progressId,
      ...updates,
      retryData: retryData || updates.retryData,
    });
  }, [updateProgress]);

  const getActionName = useCallback((action) => {
    return action === 'move' ? t('actions.move') : t('actions.copy');
  }, [t]);

  const handleBulkMove = () => {
    dismissFailedItems();
    setFolderPickerAction('move');
    setFolderPickerOpen(true);
  };

  const handleBulkCopy = () => {
    dismissFailedItems();
    setFolderPickerAction('copy');
    setFolderPickerOpen(true);
  };

  const handleBulkDelete = useCallback(async (retryData = null, onConfirm = null) => {
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    if (filePaths.length === 0) return;
    const startedPath = retryData?.startedPath || (typeof getCurrentPath === 'function' ? getCurrentPath() : undefined);

    if (!retryData) {
      dismissFailedItems();
      if (onConfirm) {
        onConfirm(filePaths);
        return;
      }
      setSelectedFiles(new Set());
      setSelectionMode(false);
    }

    markProcessing(filePaths, 'delete');
    const progressId = retryData?.progressId || `delete_${Date.now()}`;
    const retryDataObj = { type: 'delete', filePaths, startedPath };

    updateProgressWithRetry(progressId, {
      type: 'delete',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: t('fileManager.bulkPreparing'),
      name: t('fileManager.bulkItemCount', { count: filePaths.length, action: t('actions.delete') }),
    }, retryDataObj);

    let jobId;
    try {
      const data = await batchDeleteFiles(filePaths);
      jobId = data?.jobId;
    } catch (err) {
      console.error('Bulk delete start failed:', err);
      updateProgressWithRetry(progressId, {
        type: 'delete',
        status: 'error',
        error: err.message || t('fileManager.bulkDeleteStartFail'),
        keepOnError: true,
      }, retryDataObj);
      clearProcessing(filePaths);
      return;
    }

    updateProgressWithRetry(progressId, { jobId, status: 'processing', current: t('fileManager.bulkDeleting') }, retryDataObj);

    const poll = async () => {
      try {
        const job = await getBulkOperationStatus(jobId);
        const { status: jobStatus, progress: jobProgress, total: jobTotal, results: jobResults = [] } = job;
        const succeeded = jobResults.filter(r => r.status === 'succeeded').map(r => r.path);
        const failed = jobResults.filter(r => r.status === 'failed');
        const skipped = jobResults.filter(r => r.status === 'skipped').map(r => r.path);
        const skippedSet = new Set(skipped);
        const failCount = failed.length;
        const successCount = succeeded.length;
        const failedItems = failed.map(f => ({
          fileName: (f.path || '').split('/').pop() || t('common.unknown'),
          error: f.error || t('common.unknownError'),
        }));

        updateProgressWithRetry(progressId, {
          progress: jobProgress,
          total: jobTotal,
          current: jobStatus === 'running' ? t('fileManager.bulkDeleting') : undefined,
        }, retryDataObj);

        if (jobStatus !== 'pending' && jobStatus !== 'running') {
          activeIntervalsRef.current.delete(intervalId);
          clearInterval(intervalId);
          const deletedFolders = [];
          succeeded.forEach(filePath => {
            const file = files.find(f => f.path === filePath);
            if (file?.type === 'directory') deletedFolders.push(filePath);
          });
          const finalStatus = jobStatus === 'cancelled' ? 'warning' : (failCount > 0 ? 'error' : (skippedSet.size > 0 ? 'warning' : 'completed'));
          const currentMsg = jobStatus === 'cancelled'
            ? t('fileManager.bulkCancelledDone', { done: successCount, total: filePaths.length })
            : failCount > 0
              ? t('fileManager.bulkDeleteDonePartial', { done: successCount, total: filePaths.length, failCount })
              : t('fileManager.bulkDeleteDone', { done: successCount, total: filePaths.length });
          updateProgressWithRetry(progressId, {
            type: 'delete',
            status: finalStatus,
            progress: successCount,
            total: filePaths.length,
            current: currentMsg,
            name: t('fileManager.bulkItemCount', { count: filePaths.length, action: t('actions.delete') }),
            error: jobStatus === 'cancelled' ? t('common.cancelledByUser') : (failCount > 0 ? t('fileManager.uploadFailCount', { count: failCount }) : (skippedSet.size > 0 ? t('fileManager.bulkExcludedByPermission', { count: skippedSet.size }) : undefined)),
            failedItems: failedItems.length > 0 ? failedItems : undefined,
            keepOnError: failCount > 0 || skippedSet.size > 0 || jobStatus === 'cancelled',
            skippedPaths: skippedSet.size > 0 ? Array.from(skippedSet) : undefined,
            skippedCount: skippedSet.size > 0 ? skippedSet.size : undefined,
          }, retryDataObj);

          if (successCount > 0) {
            try {
              await applyRecentFilesAfterBulkDelete({
                filePaths: succeeded,
                folderPaths: deletedFolders,
              });
            } catch (err) {
              console.error('Failed to clean up recent files after bulk delete:', err);
            }
            deletedFolders.forEach(folderPath => {
              setTreeUpdateTrigger({ type: 'deleted', folderPath, timestamp: Date.now() });
            });
            if (deletedFolders.length > 0) {
              setTimeout(() => setTreeUpdateTrigger({ type: 'refresh', timestamp: Date.now() }), 500);
            }
          }
          clearProcessing(filePaths);
          if (onOperationComplete) {
            onOperationComplete({ opType: 'delete', startedPath, deletedFolderPaths: deletedFolders });
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
  }, [selectedFiles, files, onOperationComplete, setTreeUpdateTrigger, setSelectedFiles, setSelectionMode, getCurrentPath, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, updateProgress, t]);

  const handleBulkDownload = async () => {
    if (selectedFiles.size === 0) return;
    dismissFailedItems();
    setSelectionMode(false);

    const filePaths = Array.from(selectedFiles);
    const progressId = `download_${Date.now()}`;
    
    updateProgress({
      id: progressId,
      type: 'download',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      zipName: '',
    });

    try {
      const result = await downloadMultipleFiles(
        filePaths,
        (progress) => {
          updateProgress({ ...progress, id: progressId });
        },
        shareToken ? { shareToken } : undefined
      );

      const skippedCount = result?.skippedCount || 0;
      const skippedPaths = result?.skippedInfo?.paths || [];
      const skippedTruncated = Boolean(result?.skippedInfo?.truncated);
      if (skippedCount > 0 || skippedPaths.length > 0) {
        updateProgress({
          id: progressId,
          type: 'download',
          status: 'warning',
          error: t('fileManager.bulkExcludedByPermission', { count: skippedCount || skippedPaths.length }),
          keepOnError: true,
          skippedPaths,
          skippedCount: skippedCount || skippedPaths.length,
          skippedTruncated,
        });
      }
      
      setSelectedFiles(new Set());
      setSelectionMode(false);
      
      if (!(skippedCount > 0 || skippedPaths.length > 0)) {
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
  };

  /**
   * Execute bulk operation after pre-checks (Job + polling)
   */
  const executeBulkOperation = useCallback(async (destinationPath, retryData = null, onConflict = 'error') => {
    const action = retryData?.type || folderPickerAction;
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    if (!action || filePaths.length === 0) return;
    const startedPath = retryData?.startedPath || (typeof getCurrentPath === 'function' ? getCurrentPath() : undefined);

    setSelectionMode(false);
    setSelectedFiles(new Set());
    if (!retryData) dismissFailedItems();

    markProcessing(filePaths, action);
    const progressId = retryData?.progressId || `${action}_${Date.now()}`;
    const actionName = getActionName(action);
    const retryDataObj = { type: action, filePaths, destinationPath, startedPath };

    const operations = filePaths.map(sourcePath => {
      const fileName = sourcePath.split('/').pop();
      const destinationFilePath = destinationPath === '/' ? `/${fileName}` : `${destinationPath}/${fileName}`;
      return { sourcePath, destinationPath: destinationFilePath };
    });

    updateProgressWithRetry(progressId, {
      type: action,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: t('fileManager.bulkPreparing'),
      name: t('fileManager.bulkItemCount', { count: filePaths.length, action: actionName }),
    }, retryDataObj);

    let jobId;
    try {
      const data = action === 'move'
        ? await batchMoveFiles(operations, onConflict)
        : await batchCopyFiles(operations, onConflict);
      jobId = data?.jobId;
    } catch (err) {
      console.error('Bulk move/copy start failed:', err);
      updateProgressWithRetry(progressId, {
        type: action,
        status: 'error',
        error: err.message || t('fileManager.bulkStartFail'),
        keepOnError: true,
      }, retryDataObj);
      clearProcessing(filePaths);
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
      return;
    }

    updateProgressWithRetry(progressId, { jobId, status: 'processing', current: t('fileManager.bulkActionProgress', { action: actionName }) }, retryDataObj);

    const poll = async () => {
      try {
        const job = await getBulkOperationStatus(jobId);
        const { status: jobStatus, progress: jobProgress, total: jobTotal, results: jobResults = [] } = job;
        const succeeded = jobResults.filter(r => r.status === 'succeeded').map(r => ({ sourcePath: r.sourcePath, destinationPath: r.destinationPath }));
        const failed = jobResults.filter(r => r.status === 'failed');
        const skippedByConflict = jobResults.filter(r => r.status === 'skippedByConflict').map(r => r.sourcePath || r.path);
        const skippedByPermission = jobResults.filter(r => r.status === 'skippedByPermission').map(r => r.sourcePath || r.path);
        const failCount = failed.length;
        const successCount = succeeded.length;
        const hasSkippedByConflict = skippedByConflict.length > 0;
        const hasSkippedByPermission = skippedByPermission.length > 0;
        const hasAnySkipped = hasSkippedByConflict || hasSkippedByPermission;
        const failedItems = failed.map(f => ({
          fileName: (f.sourcePath || f.path || '').split('/').pop() || t('common.unknown'),
          error: f.error || t('common.unknownError'),
        }));

        updateProgressWithRetry(progressId, {
          progress: jobProgress,
          total: jobTotal,
          current: jobStatus === 'running' ? t('fileManager.bulkActionProgress', { action: actionName }) : undefined,
        }, retryDataObj);

        if (jobStatus !== 'pending' && jobStatus !== 'running') {
          activeIntervalsRef.current.delete(intervalId);
          clearInterval(intervalId);
          let skippedErrorMsg;
          if (hasAnySkipped) {
            const parts = [];
            if (hasSkippedByConflict) parts.push(t('fileManager.bulkSkippedCount', { count: skippedByConflict.length }));
            if (hasSkippedByPermission) parts.push(t('fileManager.bulkExcludedByPermission', { count: skippedByPermission.length }));
            skippedErrorMsg = parts.join(', ');
          }
          const finalStatus = jobStatus === 'cancelled' ? 'warning' : (failCount > 0 ? 'error' : (hasAnySkipped ? 'warning' : 'completed'));
          const currentMsg = jobStatus === 'cancelled'
            ? t('fileManager.bulkCancelledDone', { done: successCount, total: filePaths.length })
            : failCount > 0
              ? t('fileManager.bulkActionDonePartial', { done: successCount, total: filePaths.length, action: actionName, failCount })
              : t('fileManager.bulkActionDone', { done: successCount, total: filePaths.length, action: actionName });
          updateProgressWithRetry(progressId, {
            type: action,
            status: finalStatus,
            progress: successCount,
            total: filePaths.length,
            current: currentMsg,
            name: t('fileManager.bulkItemCount', { count: filePaths.length, action: actionName }),
            error: jobStatus === 'cancelled' ? t('common.cancelledByUser') : (failCount > 0 ? t('fileManager.uploadFailCount', { count: failCount }) : skippedErrorMsg),
            failedItems: failedItems.length > 0 ? failedItems : undefined,
            keepOnError: failCount > 0 || hasAnySkipped || jobStatus === 'cancelled',
            skippedPathsByConflict: hasSkippedByConflict ? skippedByConflict : undefined,
            skippedCountByConflict: hasSkippedByConflict ? skippedByConflict.length : undefined,
            skippedPathsByPermission: hasSkippedByPermission ? skippedByPermission : undefined,
            skippedCountByPermission: hasSkippedByPermission ? skippedByPermission.length : undefined,
          }, retryDataObj);

          if (successCount > 0) {
            if (action === 'move') {
              try {
                const moves = succeeded.map(({ sourcePath, destinationPath: destPath }) => {
                  const file = files.find(f => f.path === sourcePath);
                  const fileName = sourcePath.split('/').pop();
                  return { oldPath: sourcePath, newPath: destPath, file: file || { type: 'file', name: fileName, basename: fileName } };
                });
                if (moves.length > 0) {
                  await applyRecentFilesAfterBulkMove(moves);
                }
              } catch (err) {
                console.error('Failed to update recent files after bulk move:', err);
              }
            }
          }
          clearProcessing(filePaths);
          if (onOperationComplete) {
            onOperationComplete({ opType: action, startedPath, targetPath: destinationPath });
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
  }, [selectedFiles, folderPickerAction, onOperationComplete, setSelectedFiles, setSelectionMode, getCurrentPath, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, getActionName, updateProgress, files, t]);

  /**
   * Handle folder picker selection with conflict check
   */
  const handleFolderPickerSelect = useCallback(async (destinationPath, retryData = null) => {
    const action = retryData?.type || folderPickerAction;
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    
    if (!action || filePaths.length === 0) return;

    // Prepare moves/copies array for conflict check
    const operations = filePaths.map(sourcePath => {
      const fileName = sourcePath.split('/').pop();
      const destinationFilePath = destinationPath === '/' 
        ? `/${fileName}` 
        : `${destinationPath}/${fileName}`;
      return { sourcePath, destinationPath: destinationFilePath, type: action };
    });

    const progressId = retryData?.progressId || `${action}_${Date.now()}`;
    const startedPath = retryData?.startedPath ?? (typeof getCurrentPath === 'function' ? getCurrentPath() : undefined);
    const actionName = getActionName(action);
    const retryDataForModal = { type: action, filePaths, destinationPath, startedPath, progressId };

    updateProgressWithRetry(progressId, {
      type: action,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: t('fileManager.statusConflictCheck'),
      name: t('fileManager.bulkItemCount', { count: filePaths.length, action: actionName }),
    }, retryDataForModal);

    markProcessing(filePaths, action);

    try {
      const conflicts = await checkConflicts(operations);

      if (conflicts && conflicts.length > 0) {
        updateProgress({ id: progressId, remove: true });
        clearProcessing(filePaths);
        setBulkConflictData({
          destinationPath,
          retryData: retryData ?? { type: action, filePaths },
          conflicts,
          action,
        });
        return;
      }

      await executeBulkOperation(destinationPath, { type: action, filePaths, destinationPath, startedPath, progressId });
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
    } catch (error) {
      console.error('Bulk conflict check failed:', error);
      clearProcessing(filePaths);
      await executeBulkOperation(destinationPath, { type: action, filePaths, destinationPath, startedPath, progressId });
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
    }
  }, [selectedFiles, folderPickerAction, getCurrentPath, getActionName, updateProgressWithRetry, updateProgress, executeBulkOperation, markProcessing, clearProcessing, t]);

  /**
   * Resolve bulk conflicts
   */
  const resolveBulkConflict = useCallback(async (resolution) => {
    if (!bulkConflictData) return;

    const { destinationPath, retryData, conflicts } = bulkConflictData;
    setBulkConflictData(null);

    // When user chooses skip: exclude conflicting source paths from the operation payload
    // so the server receives only non-conflicting files and skips redundant getConflicts.
    let effectiveRetryData = retryData;
    if (resolution === 'skip' && conflicts && Array.isArray(conflicts) && conflicts.length > 0) {
      const conflictSourcePaths = new Set(
        conflicts.map((c) => c.sourcePath).filter(Boolean)
      );
      const filteredPaths = (retryData.filePaths || []).filter(
        (p) => !conflictSourcePaths.has(p)
      );
      effectiveRetryData = { ...retryData, filePaths: filteredPaths };
    }

    await executeBulkOperation(destinationPath, effectiveRetryData, resolution);
    setFolderPickerOpen(false);
    setFolderPickerAction(null);
  }, [bulkConflictData, executeBulkOperation]);

  const handleRetry = async (progressId) => {
    const progressItem = progressItems.find(item => item.id === progressId);
    if (!progressItem || !progressItem.retryData) {
      console.error('Retry data not found for progress item:', progressId);
      return;
    }
    const { type, filePaths, destinationPath, startedPath } = progressItem.retryData;
    if (type === 'delete') {
      await handleBulkDelete({ filePaths, progressId, startedPath });
    } else if (type === 'move' || type === 'copy') {
      await handleFolderPickerSelect(destinationPath, { type, filePaths, progressId, startedPath });
    }
  };

  const handleCancelBulkOperation = useCallback(async (progressId) => {
    const progressItem = progressItems.find(item => item.id === progressId);
    const jobId = progressItem?.jobId;
    if (!jobId) return;
    try {
      await cancelBulkOperation(jobId);
    } catch (err) {
      console.error('Cancel bulk operation failed:', err);
    }
  }, [progressItems]);

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
