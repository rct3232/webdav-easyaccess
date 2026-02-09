import { useState, useCallback } from 'react';
import {
  downloadMultipleFiles,
  batchDeleteFiles,
  batchMoveFiles,
  batchCopyFiles,
  checkConflicts,
  getBulkOperationStatus,
  cancelBulkOperation,
} from '../services/fileService';
import { useFileOperationProgress } from './useFileOperationProgress';
import {
  applyRecentFilesAfterBulkDelete,
  applyRecentFilesAfterBulkMove,
} from '../utils/recentFiles';

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
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerAction, setFolderPickerAction] = useState(null);
  const [bulkConflictData, setBulkConflictData] = useState(null);
  const { progressItems, updateProgress } = useFileOperationProgress();

  const { markProcessing: markProcessingImpl, clearProcessing: clearProcessingImpl } = options;

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
    return action === 'move' ? '이동' : '복사';
  }, []);

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
      current: '준비 중...',
      name: `${filePaths.length}개 항목 삭제`,
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
        error: err.message || '삭제 시작 실패',
        keepOnError: true,
      }, retryDataObj);
      clearProcessing(filePaths);
      return;
    }

    updateProgressWithRetry(progressId, { jobId, status: 'processing', current: '삭제 중...' }, retryDataObj);

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
          fileName: (f.path || '').split('/').pop() || '알 수 없음',
          error: f.error || '알 수 없는 오류',
        }));

        updateProgressWithRetry(progressId, {
          progress: jobProgress,
          total: jobTotal,
          current: jobStatus === 'running' ? '삭제 중...' : undefined,
        }, retryDataObj);

        if (jobStatus !== 'pending' && jobStatus !== 'running') {
          clearInterval(intervalId);
          const deletedFolders = [];
          succeeded.forEach(filePath => {
            const file = files.find(f => f.path === filePath);
            if (file?.type === 'directory') deletedFolders.push(filePath);
          });
          const finalStatus = jobStatus === 'cancelled' ? 'warning' : (failCount > 0 ? 'error' : (skippedSet.size > 0 ? 'warning' : 'completed'));
          const currentMsg = jobStatus === 'cancelled'
            ? `취소됨 (${successCount}/${filePaths.length} 완료)`
            : failCount > 0
              ? `(${successCount}/${filePaths.length}) 삭제 완료 (${failCount}개 실패)`
              : `(${successCount}/${filePaths.length}) 삭제 완료`;
          updateProgressWithRetry(progressId, {
            type: 'delete',
            status: finalStatus,
            progress: successCount,
            total: filePaths.length,
            current: currentMsg,
            name: `${filePaths.length}개 항목 삭제`,
            error: jobStatus === 'cancelled' ? '사용자에 의해 취소됨' : (failCount > 0 ? `${failCount}개 실패` : (skippedSet.size > 0 ? `권한으로 제외된 항목: ${skippedSet.size}개` : undefined)),
            failedItems: failedItems.length > 0 ? failedItems : undefined,
            keepOnError: failCount > 0 || skippedSet.size > 0 || jobStatus === 'cancelled',
            skippedPaths: skippedSet.size > 0 ? Array.from(skippedSet) : undefined,
            skippedCount: skippedSet.size > 0 ? skippedSet.size : undefined,
          }, retryDataObj);

          if (successCount > 0) {
            try {
              await applyRecentFilesAfterBulkDelete(succeeded, deletedFolders);
            } catch (err) {
              console.error('Failed to clean up recent files after bulk delete:', err);
            }
            deletedFolders.forEach(folderPath => {
              setTreeUpdateTrigger({ type: 'deleted', folderPath, timestamp: Date.now() });
            });
            if (onOperationComplete) {
              onOperationComplete({ opType: 'delete', startedPath, deletedFolderPaths: deletedFolders });
            }
            if (deletedFolders.length > 0) {
              setTimeout(() => setTreeUpdateTrigger({ type: 'refresh', timestamp: Date.now() }), 500);
            }
          }
          clearProcessing(filePaths);
          if (failCount === 0 && skippedSet.size === 0 && jobStatus !== 'cancelled') {
            setTimeout(() => updateProgress({ id: progressId, remove: true }), 3000);
          }
        }
      } catch (err) {
        console.error('Poll bulk delete status failed:', err);
      }
    };

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    poll();
  }, [selectedFiles, files, onOperationComplete, setTreeUpdateTrigger, setSelectedFiles, setSelectionMode, getCurrentPath, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, updateProgress]);

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
      const result = await downloadMultipleFiles(filePaths, (progress) => {
        updateProgress({ ...progress, id: progressId });
      });

      const skippedCount = result?.skippedCount || 0;
      const skippedPaths = result?.skippedInfo?.paths || [];
      const skippedTruncated = Boolean(result?.skippedInfo?.truncated);
      if (skippedCount > 0 || skippedPaths.length > 0) {
        updateProgress({
          id: progressId,
          type: 'download',
          status: 'warning',
          error: `권한으로 제외된 항목: ${skippedCount || skippedPaths.length}개`,
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
      current: '준비 중...',
      name: `${filePaths.length}개 항목 ${actionName}`,
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
        error: err.message || '시작 실패',
        keepOnError: true,
      }, retryDataObj);
      clearProcessing(filePaths);
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
      return;
    }

    updateProgressWithRetry(progressId, { jobId, status: 'processing', current: `${actionName} 중...` }, retryDataObj);

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
          fileName: (f.sourcePath || f.path || '').split('/').pop() || '알 수 없음',
          error: f.error || '알 수 없는 오류',
        }));

        updateProgressWithRetry(progressId, {
          progress: jobProgress,
          total: jobTotal,
          current: jobStatus === 'running' ? `${actionName} 중...` : undefined,
        }, retryDataObj);

        if (jobStatus !== 'pending' && jobStatus !== 'running') {
          clearInterval(intervalId);
          let skippedErrorMsg;
          if (hasAnySkipped) {
            const parts = [];
            if (hasSkippedByConflict) parts.push(`건너뛴 항목: ${skippedByConflict.length}개`);
            if (hasSkippedByPermission) parts.push(`권한으로 제외된 항목: ${skippedByPermission.length}개`);
            skippedErrorMsg = parts.join(', ');
          }
          const finalStatus = jobStatus === 'cancelled' ? 'warning' : (failCount > 0 ? 'error' : (hasAnySkipped ? 'warning' : 'completed'));
          const currentMsg = jobStatus === 'cancelled'
            ? `취소됨 (${successCount}/${filePaths.length} 완료)`
            : failCount > 0
              ? `(${successCount}/${filePaths.length}) ${actionName} 완료 (${failCount}개 실패)`
              : `(${successCount}/${filePaths.length}) ${actionName} 완료`;
          updateProgressWithRetry(progressId, {
            type: action,
            status: finalStatus,
            progress: successCount,
            total: filePaths.length,
            current: currentMsg,
            name: `${filePaths.length}개 항목 ${actionName}`,
            error: jobStatus === 'cancelled' ? '사용자에 의해 취소됨' : (failCount > 0 ? `${failCount}개 실패` : skippedErrorMsg),
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
                if (!hasAnySkipped) {
                  const moves = succeeded.map(({ sourcePath, destinationPath: destPath }) => {
                    const file = files.find(f => f.path === sourcePath);
                    const fileName = sourcePath.split('/').pop();
                    return { oldPath: sourcePath, newPath: destPath, file: file || { type: 'file', name: fileName, basename: fileName } };
                  });
                  await applyRecentFilesAfterBulkMove(moves);
                }
              } catch (err) {
                console.error('Failed to update recent files after bulk move:', err);
              }
            }
            if (onOperationComplete) {
              onOperationComplete({ opType: action, startedPath, targetPath: destinationPath });
            }
          }
          clearProcessing(filePaths);
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
    poll();
  }, [selectedFiles, folderPickerAction, onOperationComplete, setSelectedFiles, setSelectionMode, getCurrentPath, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, getActionName, updateProgress, files]);

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
      current: '충돌 확인 중...',
      name: `${filePaths.length}개 항목 ${actionName}`,
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
  }, [selectedFiles, folderPickerAction, getCurrentPath, getActionName, updateProgressWithRetry, updateProgress, executeBulkOperation, markProcessing, clearProcessing]);

  /**
   * Resolve bulk conflicts
   */
  const resolveBulkConflict = useCallback(async (resolution) => {
    if (!bulkConflictData) return;

    const { destinationPath, retryData } = bulkConflictData;
    setBulkConflictData(null);
    await executeBulkOperation(destinationPath, retryData, resolution);
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
