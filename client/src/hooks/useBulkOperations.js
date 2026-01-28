import { useState, useCallback } from 'react';
import { downloadMultipleFiles, batchDeleteFiles, batchMoveFiles, batchCopyFiles, checkConflicts } from '../services/fileService';
import { useFileOperationProgress } from './useFileOperationProgress';
import { 
  applyRecentFilesAfterBulkDelete,
  applyRecentFilesAfterBulkMove,
} from '../utils/recentFiles';

// Batch processing configuration
const BATCH_SIZE = parseInt(process.env.REACT_APP_BATCH_SIZE || '50', 10);
const MAX_CONCURRENT_BATCHES = parseInt(process.env.REACT_APP_MAX_CONCURRENT_BATCHES || '3', 10);

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

  // Action text 상수
  const getActionText = useCallback((action) => {
    return action === 'move' ? '이동중' : '복사중';
  }, []);

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

  // Helper function to retry a failed operation with exponential backoff
  const retryOperation = useCallback(async (operationFn, maxRetries = 3, baseDelay = 1000) => {
    let lastError;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await operationFn();
      } catch (error) {
        lastError = error;
        
        // Don't retry on client errors (4xx)
        if (error.response?.status >= 400 && error.response?.status < 500) {
          throw error;
        }
        
        // Don't retry on last attempt
        if (attempt === maxRetries) {
          break;
        }
        
        // Calculate delay with exponential backoff
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    throw lastError;
  }, []);

  // Helper function to check if error is retryable
  const isRetryableError = useCallback((error) => {
    // Network errors, timeouts, and server errors (5xx) are retryable
    if (!error.response) {
      return true; // Network error
    }
    const status = error.response?.status;
    if (status >= 500) {
      return true; // Server error
    }
    if (status === 408 || status === 429) {
      return true; // Timeout or rate limit
    }
    return false;
  }, []);

  // Helper function to process items in batches with concurrency control
  const processInBatches = useCallback(async (items, batchSize, maxConcurrent, operationFn, progressId, updateProgressFn, retryDataObj) => {
    const chunks = [];
    for (let i = 0; i < items.length; i += batchSize) {
      chunks.push(items.slice(i, i + batchSize));
    }

    const totalChunks = chunks.length;
    let processedCount = 0;
    const allSucceeded = [];
    const allFailed = [];
    const allSkipped = [];

    // Process chunks with concurrency control
    for (let i = 0; i < chunks.length; i += maxConcurrent) {
      const batchChunks = chunks.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.allSettled(
        batchChunks.map(async (chunk, chunkIndex) => {
          try {
            // Retry on network/timeout errors
            const result = await retryOperation(
              () => operationFn(chunk),
              3, // max retries
              1000 // base delay 1s
            );
            return { success: true, result, chunk };
          } catch (error) {
            // Check if error is retryable but already exhausted retries
            if (isRetryableError(error)) {
              // Log retry exhaustion
              console.warn(`Batch operation failed after retries for chunk:`, error);
            }
            return { success: false, error, chunk };
          }
        })
      );

      // Process batch results
      for (const batchResult of batchResults) {
        if (batchResult.status === 'fulfilled') {
          const { success, result, chunk, error } = batchResult.value;
          if (success && result) {
            // Handle batch API response format
            if (result.succeeded) {
              allSucceeded.push(...(Array.isArray(result.succeeded) ? result.succeeded : []));
            }
            if (result.failed) {
              allFailed.push(...(Array.isArray(result.failed) ? result.failed : []));
            }
            if (result.skipped) {
              allSkipped.push(...(Array.isArray(result.skipped) ? result.skipped : []));
            }
          } else {
            // If batch failed, treat all items in chunk as failed
            chunk.forEach(item => {
              allFailed.push({
                path: typeof item === 'string' ? item : (item.sourcePath || item.path),
                error: error?.message || 'Batch operation failed'
              });
            });
          }
        } else {
          // Promise rejected - try to extract chunk from error or use empty array
          const errorInfo = batchResult.reason || {};
          const chunk = errorInfo.chunk || [];
          chunk.forEach(item => {
            allFailed.push({
              path: typeof item === 'string' ? item : (item.sourcePath || item.path),
              error: errorInfo.message || 'Unknown error'
            });
          });
        }
        processedCount++;
        
        // Update progress
        updateProgressFn(progressId, {
          status: 'processing',
          progress: processedCount,
          total: totalChunks,
          current: `배치 처리 중... (${processedCount}/${totalChunks})`,
        }, retryDataObj);
      }
    }

    return { succeeded: allSucceeded, failed: allFailed, skipped: allSkipped };
  }, [retryOperation, isRetryableError]);

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
    
    const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
    updateProgressWithRetry(progressId, {
      type: 'delete',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: `준비 중... (총 ${totalBatches}개 배치)`,
      name: `${filePaths.length}개 항목 삭제`,
    }, retryDataObj);

    // Process in batches
    const batchResults = await processInBatches(
      filePaths,
      BATCH_SIZE,
      MAX_CONCURRENT_BATCHES,
      async (chunk) => {
        const result = await batchDeleteFiles(chunk);
        return result;
      },
      progressId,
      (id, updates, retry) => {
        const batchProgress = updates.progress || 0;
        const batchTotal = updates.total || totalBatches;
        const itemProgress = Math.floor((batchProgress / batchTotal) * filePaths.length);
        updateProgressWithRetry(id, {
          ...updates,
          progress: itemProgress,
          total: filePaths.length,
          current: `배치 처리 중... (${batchProgress}/${batchTotal} 배치, ${itemProgress}/${filePaths.length} 항목)`,
        }, retry);
      },
      retryDataObj
    );

    const successCount = batchResults.succeeded.length;
    const failCount = batchResults.failed.length;
    const skippedSet = new Set(batchResults.skipped);
    const failedItems = batchResults.failed.map(f => {
      const path = f.path || (typeof f === 'string' ? f : '');
      return {
        fileName: path.split('/').pop() || '알 수 없음',
        error: f.error || '알 수 없는 오류',
      };
    });

    // Identify deleted folders
    const deletedFolders = [];
    batchResults.succeeded.forEach(filePath => {
      const file = files.find(f => f.path === filePath);
      if (file?.type === 'directory') {
        deletedFolders.push(filePath);
      }
    });

    updateProgressWithRetry(progressId, {
      type: 'delete',
      status: failCount > 0 ? 'error' : (skippedSet.size > 0 ? 'warning' : 'completed'),
      progress: successCount,
      total: filePaths.length,
      current: failCount > 0 
        ? `(${successCount}/${filePaths.length}) 삭제 완료 (${failCount}개 실패)` 
        : `(${successCount}/${filePaths.length}) 삭제 완료`,
      name: `${filePaths.length}개 항목 삭제`,
      error: failCount > 0 ? `${failCount}개 실패` : (skippedSet.size > 0 ? `권한으로 제외된 항목: ${skippedSet.size}개` : undefined),
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      keepOnError: failCount > 0 || skippedSet.size > 0,
      skippedPaths: skippedSet.size > 0 ? Array.from(skippedSet) : undefined,
      skippedCount: skippedSet.size > 0 ? skippedSet.size : undefined,
    }, retryDataObj);

    if (successCount > 0) {
      // 삭제 성공한 파일들을 최근항목에서 제거
      try {
        await applyRecentFilesAfterBulkDelete(batchResults.succeeded, deletedFolders);
      } catch (err) {
        // 최근항목 정리 실패는 무시 (치명적이지 않음)
        console.error('Failed to clean up recent files after bulk delete:', err);
      }
      
      deletedFolders.forEach(folderPath => {
        setTreeUpdateTrigger({
          type: 'deleted',
          folderPath,
          timestamp: Date.now(),
        });
      });

      if (!retryData) {
        setSelectedFiles(new Set());
      }
      if (onOperationComplete) {
        onOperationComplete({
          opType: 'delete',
          startedPath,
          deletedFolderPaths: deletedFolders,
        });
      }
      
      if (deletedFolders.length > 0) {
        setTimeout(() => {
          setTreeUpdateTrigger({
            type: 'refresh',
            timestamp: Date.now(),
          });
        }, 500);
      }
    }

    clearProcessing(filePaths);

    if (failCount === 0 && skippedSet.size === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 3000);
    }
  }, [selectedFiles, files, onOperationComplete, setTreeUpdateTrigger, setSelectedFiles, setSelectionMode, getCurrentPath, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, updateProgress, processInBatches]);

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
   * Execute bulk operation after pre-checks
   */
  const executeBulkOperation = useCallback(async (destinationPath, retryData = null, onConflict = 'error') => {
    const action = retryData?.type || folderPickerAction;
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    
    if (!action || filePaths.length === 0) return;
    const startedPath = retryData?.startedPath || (typeof getCurrentPath === 'function' ? getCurrentPath() : undefined);
    
    if (!retryData) {
      dismissFailedItems();
      setSelectionMode(false);
    }

    markProcessing(filePaths, action);
    const progressId = retryData?.progressId || `${action}_${Date.now()}`;
    const actionName = getActionName(action);
    const actionText = getActionText(action);
    const retryDataObj = { type: action, filePaths, destinationPath, startedPath };
    
    const totalBatches = Math.ceil(filePaths.length / BATCH_SIZE);
    updateProgressWithRetry(progressId, {
      type: action,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: `준비 중... (총 ${totalBatches}개 배치)`,
      name: `${filePaths.length}개 항목 ${actionName}`,
    }, retryDataObj);

    // Prepare moves/copies array
    const operations = filePaths.map(sourcePath => {
      const fileName = sourcePath.split('/').pop();
      const destinationFilePath = destinationPath === '/' 
        ? `/${fileName}` 
        : `${destinationPath}/${fileName}`;
      return { sourcePath, destinationPath: destinationFilePath };
    });

    // Process in batches
    const batchResults = await processInBatches(
      operations,
      BATCH_SIZE,
      MAX_CONCURRENT_BATCHES,
      async (chunk) => {
        if (action === 'move') {
          return await batchMoveFiles(chunk, onConflict);
        } else if (action === 'copy') {
          return await batchCopyFiles(chunk, onConflict);
        }
        throw new Error('Invalid action');
      },
      progressId,
      (id, updates, retry) => {
        const batchProgress = updates.progress || 0;
        const batchTotal = updates.total || totalBatches;
        const itemProgress = Math.floor((batchProgress / batchTotal) * filePaths.length);
        updateProgressWithRetry(id, {
          ...updates,
          progress: itemProgress,
          total: filePaths.length,
          current: `배치 처리 중... (${batchProgress}/${batchTotal} 배치, ${itemProgress}/${filePaths.length} 항목)`,
        }, retry);
      },
      retryDataObj
    );

    const successCount = batchResults.succeeded.length;
    const failCount = batchResults.failed.length;
    const skippedSet = new Set(batchResults.skipped);
    const failedItems = batchResults.failed.map(f => {
      const path = f.sourcePath || f.path || (typeof f === 'string' ? f : '');
      return {
        fileName: path.split('/').pop() || '알 수 없음',
        error: f.error || '알 수 없는 오류',
      };
    });

    updateProgressWithRetry(progressId, {
      type: action,
      status: failCount > 0 ? 'error' : (skippedSet.size > 0 ? 'warning' : 'completed'),
      progress: successCount,
      total: filePaths.length,
      current: failCount > 0 
        ? `(${successCount}/${filePaths.length}) ${actionText} 완료 (${failCount}개 실패)` 
        : `(${successCount}/${filePaths.length}) ${actionText} 완료`,
      name: `${filePaths.length}개 항목 ${actionName}`,
      error: failCount > 0 ? `${failCount}개 실패` : (skippedSet.size > 0 ? `권한으로 제외된 항목: ${skippedSet.size}개` : undefined),
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      keepOnError: failCount > 0 || skippedSet.size > 0,
      skippedPaths: skippedSet.size > 0 ? Array.from(skippedSet) : undefined,
      skippedCount: skippedSet.size > 0 ? skippedSet.size : undefined,
    }, retryDataObj);

    if (successCount > 0) {
      // 이동 성공 시 최근항목 경로 업데이트
      if (action === 'move') {
        try {
          const skippedPaths = Array.from(skippedSet);
          const hasSkipped = skippedPaths.length > 0;
          
          if (!hasSkipped) {
            // 이동된 파일/폴더별로 최근항목 업데이트
            const moves = batchResults.succeeded.map(({ sourcePath, destinationPath: destPath }) => {
              const file = files.find(f => f.path === sourcePath);
              const fileName = sourcePath.split('/').pop();
              
              return {
                oldPath: sourcePath,
                newPath: destPath,
                file: file || { type: 'file', name: fileName, basename: fileName },
              };
            });
            
            await applyRecentFilesAfterBulkMove(moves);
          }
        } catch (err) {
          // 최근항목 업데이트 실패는 무시 (치명적이지 않음)
          console.error('Failed to update recent files after bulk move:', err);
        }
      }
      
      if (!retryData) {
        setSelectedFiles(new Set());
        setSelectionMode(false);
      }
      if (onOperationComplete) {
        onOperationComplete({
          opType: action,
          startedPath,
          targetPath: destinationPath,
        });
      }
    }

    if (failCount === 0 && skippedSet.size === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        clearProcessing(filePaths);
      }, 3000);
    } else {
      clearProcessing(filePaths);
    }

    if (!retryData) {
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
    }
  }, [selectedFiles, folderPickerAction, onOperationComplete, setSelectedFiles, setSelectionMode, getCurrentPath, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, getActionName, getActionText, updateProgress, processInBatches, files]);

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

    try {
      const conflicts = await checkConflicts(operations);

      if (conflicts && conflicts.length > 0) {
        setBulkConflictData({ destinationPath, retryData, conflicts, action });
        return;
      }

      await executeBulkOperation(destinationPath, retryData);
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
    } catch (error) {
      console.error('Bulk conflict check failed:', error);
      // fallback to direct execution
      await executeBulkOperation(destinationPath, retryData);
      setFolderPickerOpen(false);
      setFolderPickerAction(null);
    }
  }, [selectedFiles, folderPickerAction, executeBulkOperation]);

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

    // 기존 progressItem 재사용하여 재시도
    if (type === 'delete') {
      await handleBulkDelete({ filePaths, progressId, startedPath });
    } else if (type === 'move' || type === 'copy') {
      await handleFolderPickerSelect(destinationPath, { type, filePaths, progressId, startedPath });
    }
  };

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
    dismissFailedItems,
    setFolderPickerOpen,
    setFolderPickerAction,
    bulkConflictData,
    resolveBulkConflict,
    setBulkConflictData,
  };
};
