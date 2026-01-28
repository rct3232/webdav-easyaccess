import { useCallback, useRef } from 'react';
import { uploadFile, listFiles } from '../services/fileService';
import { getErrorMessageByType, ERROR_TYPES } from '../utils/errorUtils';

/**
 * File upload hook
 * Manages file upload state, progress, cancellation, and retry logic
 * 
 * @param {Object} options - Hook options
 * @param {Function} options.updateProgress - Progress update callback
 * @param {Function} options.onOperationComplete - Notify completion (for conditional refresh)
 * @param {Function} options.dismissFailedItems - Callback to dismiss failed items
 * @returns {Object} Upload handlers
 */
export const useFileUpload = ({
  updateProgress,
  onOperationComplete,
  dismissFailedItems,
}) => {
  // Abort controllers for each upload session
  const uploadAbortControllersRef = useRef(new Map());
  // Cancelled files tracking (additional safety)
  const cancelledFilesRef = useRef(new Map());

  /**
   * Check if file is cancelled
   */
  const isFileCancelled = useCallback((progressId, fileName) => {
    const cancelledSet = cancelledFilesRef.current.get(progressId);
    return cancelledSet && cancelledSet.has(fileName);
  }, []);

  /**
   * Mark file as cancelled
   */
  const markFileCancelled = useCallback((progressId, fileName) => {
    const cancelledSet = cancelledFilesRef.current.get(progressId);
    if (cancelledSet) {
      cancelledSet.add(fileName);
    }
  }, []);

  /**
   * Update file item status in fileItems array
   */
  const updateFileItemStatus = useCallback((fileItems, fileName, status, error = undefined) => {
    const index = fileItems.findIndex(item => item.fileName === fileName);
    if (index !== -1) {
      fileItems[index] = { ...fileItems[index], status, error };
    }
    return fileItems;
  }, []);

  /**
   * Update progress with current file items
   */
  const updateProgressWithItems = useCallback((progressId, fileItems, status, successCount, total, failCount, failedItems) => {
    updateProgress({
      id: progressId,
      type: 'upload',
      status: successCount + failCount < total ? status : (failCount > 0 ? 'error' : 'completed'),
      progress: successCount,
      total,
      current: successCount + failCount < total
        ? `(${successCount}/${total}) 업로드 중...`
        : failCount > 0
          ? `(${successCount}/${total}) 완료 (${failCount}개 실패)`
          : `(${successCount}/${total}) 완료`,
      name: `${total}개 파일 업로드`,
      fileItems: [...fileItems],
      retryData: {
        type: 'upload',
        fileItems: fileItems
          .filter(item => item.status === 'error' || item.status === 'pending')
          .map(item => ({
            fileName: item.fileName,
            file: item.file,
            status: item.status === 'uploading' ? 'pending' : item.status,
          })),
        currentPath: undefined, // Will be set by caller
      },
      keepOnError: failCount > 0,
      error: failCount > 0 ? `${failCount}개 실패` : undefined,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
    });
  }, [updateProgress]);

  /**
   * Upload a single file
   */
  const uploadSingleFile = useCallback(async (
    fileItem,
    uploadPath,
    progressId,
    abortController,
    cancelledSet,
    fileItems,
    existingNames,
    onConflict = 'error'
  ) => {
    const fileName = fileItem.fileName;

    // Early return if cancelled
    if (isFileCancelled(progressId, fileName) || abortController.signal.aborted) {
      markFileCancelled(progressId, fileName);
      updateFileItemStatus(fileItems, fileName, 'cancelled');
      return { success: false, cancelled: true };
    }

    // Skip if already completed or error
    const currentItem = fileItems.find(item => item.fileName === fileName);
    if (currentItem?.status === 'completed') {
      return { success: true };
    }
    if (currentItem?.status === 'error' || currentItem?.status === 'cancelled') {
      return { success: false, cancelled: currentItem.status === 'cancelled' };
    }

    // Update to uploading
    updateFileItemStatus(fileItems, fileName, 'uploading');

    try {
      await uploadFile(fileItem.file, uploadPath, abortController.signal, onConflict);

      // Check if cancelled after upload
      if (isFileCancelled(progressId, fileName) || abortController.signal.aborted) {
        markFileCancelled(progressId, fileName);
        updateFileItemStatus(fileItems, fileName, 'cancelled');
        return { success: false, cancelled: true };
      }

      // Mark as completed
      updateFileItemStatus(fileItems, fileName, 'completed');
      existingNames.add(fileName);
      return { success: true };
    } catch (error) {
      // Handle cancellation
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        markFileCancelled(progressId, fileName);
        updateFileItemStatus(fileItems, fileName, 'cancelled');
        return { success: false, cancelled: true };
      }

      // Handle error
      const errorMsg = error?.response?.data?.error || error?.message || '업로드 실패';
      updateFileItemStatus(fileItems, fileName, 'error', errorMsg);
      return { success: false, error: errorMsg };
    }
  }, [isFileCancelled, markFileCancelled, updateFileItemStatus]);

  /**
   * Handle upload start
   */
  const handleUploadStart = useCallback(async (files, uploadPath, onConflict = 'error') => {
    if (!files || files.length === 0) return;

    if (dismissFailedItems) {
      dismissFailedItems();
    }

    const progressId = `upload_${Date.now()}`;
    const abortControllers = new Map();
    uploadAbortControllersRef.current.set(progressId, abortControllers);
    cancelledFilesRef.current.set(progressId, new Set());
    const cancelledSet = cancelledFilesRef.current.get(progressId);

    // Check for existing files
    let existingNames = new Set();
    if (onConflict === 'error') {
      try {
        const existing = await listFiles(uploadPath || '/');
        existingNames = new Set(existing.map(item => item.basename || item.name));
      } catch (e) {
        console.error('Failed to fetch existing files before upload:', e);
      }
    }

    // Create file items
    const fileItems = files.map(file => ({
      fileName: file.name,
      status: (onConflict === 'error' && existingNames.has(file.name)) ? 'error' : 'pending',
      error: (onConflict === 'error' && existingNames.has(file.name)) ? getErrorMessageByType(ERROR_TYPES.DUPLICATE_FILE) : undefined,
      file: file,
    }));

    // Initial progress
    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: 0,
      total: files.length,
      current: '업로드 준비 중...',
      name: `${files.length}개 파일 업로드`,
      fileItems: [...fileItems],
      retryData: {
        type: 'upload',
        fileItems: fileItems
          .filter(item => item.status !== 'error')
          .map(item => ({
            fileName: item.fileName,
            file: item.file,
            status: 'pending',
          })),
        currentPath: uploadPath,
        onConflict,
      },
      keepOnError: false,
    });

    // Upload files
    let successCount = 0;
    let failCount = 0;
    const failedItems = [];

    for (const fileItem of fileItems) {
      // Skip if already error
      if (fileItem.status === 'error') {
        failCount++;
        failedItems.push({
          fileName: fileItem.fileName,
          error: fileItem.error || '업로드 실패',
        });
        continue;
      }

      // Create abort controller
      const abortController = new AbortController();
      abortControllers.set(fileItem.fileName, abortController);

      // Upload file
      const result = await uploadSingleFile(
        fileItem,
        uploadPath,
        progressId,
        abortController,
        cancelledSet,
        fileItems,
        existingNames,
        onConflict
      );

      if (result.success) {
        successCount++;
      } else if (result.cancelled) {
        // Skip cancelled files
      } else {
        failCount++;
        failedItems.push({
          fileName: fileItem.fileName,
          error: result.error || '업로드 실패',
        });
      }

      // Update progress
      updateProgressWithItems(
        progressId,
        fileItems,
        'processing',
        successCount,
        files.length,
        failCount,
        failedItems
      );

      // Clean up abort controller if not cancelled
      if (!result.cancelled && !isFileCancelled(progressId, fileItem.fileName)) {
        abortControllers.delete(fileItem.fileName);
      }
    }

    // Refresh file list if successful
    if (successCount > 0 && onOperationComplete) {
      onOperationComplete({
        opType: 'upload',
        startedPath: uploadPath,
      });
    }

    // Auto-remove if no failures
    if (failCount === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        uploadAbortControllersRef.current.delete(progressId);
        cancelledFilesRef.current.delete(progressId);
      }, 3000);
    } else {
      updateProgress({
        id: progressId,
        keepOnError: true,
      });
    }
  }, [updateProgress, onOperationComplete, dismissFailedItems, uploadSingleFile, updateProgressWithItems, isFileCancelled]);

  /**
   * Handle retry upload
   */
  const handleRetryUpload = useCallback(async (progressId, retryData, existingFileItems) => {
    const { fileItems: retryFileItems, currentPath: uploadPath, onConflict = 'error' } = retryData;

    // Filter failed files
    const failedFiles = retryFileItems.filter(item => item.status === 'error' && item.file);
    if (failedFiles.length === 0) {
      updateProgress({ id: progressId, remove: true });
      uploadAbortControllersRef.current.delete(progressId);
      cancelledFilesRef.current.delete(progressId);
      return;
    }

    // Initialize abort controllers
    const abortControllers = new Map();
    uploadAbortControllersRef.current.set(progressId, abortControllers);
    const cancelledSet = cancelledFilesRef.current.get(progressId) || new Set();
    cancelledFilesRef.current.set(progressId, cancelledSet);

    // Check for existing files
    let existingNames = new Set();
    if (onConflict === 'error') {
      try {
        const existing = await listFiles(uploadPath || '/');
        existingNames = new Set(existing.map(item => item.basename || item.name));
      } catch (e) {
        console.error('Failed to fetch existing files before retry:', e);
      }
    }

    // Prepare retry file items
    const fileItemsToRetry = failedFiles.map(fileItem => ({
      fileName: fileItem.fileName,
      status: (onConflict === 'error' && existingNames.has(fileItem.fileName)) ? 'error' : 'pending',
      error: (onConflict === 'error' && existingNames.has(fileItem.fileName)) ? getErrorMessageByType(ERROR_TYPES.DUPLICATE_FILE) : undefined,
      file: fileItem.file,
    }));

    // Merge with existing items
    const mergedFileItems = [
      ...(existingFileItems || []).filter(item => item.status === 'completed' || item.status === 'cancelled'),
      ...fileItemsToRetry,
    ];

    const totalFiles = mergedFileItems.length;
    const completedCount = mergedFileItems.filter(item => item.status === 'completed').length;

    // Initial progress
    updateProgress({
      id: progressId,
      type: 'upload',
      status: 'preparing',
      progress: completedCount,
      total: totalFiles,
      current: '재시도 준비 중...',
      name: `${totalFiles}개 파일 업로드`,
      fileItems: [...mergedFileItems],
      retryData: {
        type: 'upload',
        fileItems: fileItemsToRetry
          .filter(item => item.status !== 'error')
          .map(item => ({
            fileName: item.fileName,
            file: item.file,
            status: 'pending',
          })),
        currentPath: uploadPath,
        onConflict,
      },
      keepOnError: false,
      error: undefined,
      failedItems: undefined,
    });

    // Retry upload
    let successCount = completedCount;
    let failCount = 0;
    const failedItems = [];

    for (const fileItem of fileItemsToRetry) {
      if (fileItem.status === 'error') {
        failCount++;
        failedItems.push({
          fileName: fileItem.fileName,
          error: fileItem.error,
        });
        continue;
      }

      const abortController = new AbortController();
      abortControllers.set(fileItem.fileName, abortController);

      const result = await uploadSingleFile(
        fileItem,
        uploadPath,
        progressId,
        abortController,
        cancelledSet,
        mergedFileItems,
        existingNames,
        onConflict
      );

      if (result.success) {
        successCount++;
      } else if (result.cancelled) {
        // Skip cancelled
      } else {
        failCount++;
        failedItems.push({
          fileName: fileItem.fileName,
          error: result.error || '업로드 실패',
        });
      }

      updateProgressWithItems(
        progressId,
        mergedFileItems,
        'processing',
        successCount,
        totalFiles,
        failCount,
        failedItems
      );

      if (!result.cancelled && !isFileCancelled(progressId, fileItem.fileName)) {
        abortControllers.delete(fileItem.fileName);
      }
    }

    // Refresh if successful
    if (successCount > completedCount && onOperationComplete) {
      onOperationComplete({
        opType: 'upload',
        startedPath: uploadPath,
      });
    }

    // Auto-remove if no failures
    if (failCount === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        uploadAbortControllersRef.current.delete(progressId);
        cancelledFilesRef.current.delete(progressId);
      }, 3000);
    } else {
      updateProgress({
        id: progressId,
        keepOnError: true,
      });
    }
  }, [updateProgress, onOperationComplete, uploadSingleFile, updateProgressWithItems, isFileCancelled]);

  /**
   * Cancel single file upload
   */
  const handleCancelUploadFile = useCallback((progressId, fileName, progressItems) => {
    const abortControllers = uploadAbortControllersRef.current.get(progressId);
    if (abortControllers) {
      const abortController = abortControllers.get(fileName);
      if (abortController) {
        abortController.abort();
      }
    }

    markFileCancelled(progressId, fileName);

    // Update progress
    const progressItem = progressItems?.find(item => item.id === progressId);
    if (progressItem && progressItem.fileItems) {
      const updatedFileItems = progressItem.fileItems.map(item =>
        item.fileName === fileName ? { ...item, status: 'cancelled' } : item
      );
      updateProgress({
        id: progressId,
        fileItems: updatedFileItems,
      });
    }
  }, [markFileCancelled, updateProgress]);

  /**
   * Cancel all uploads
   */
  const handleCancelAllUpload = useCallback((progressId, progressItems) => {
    const abortControllers = uploadAbortControllersRef.current.get(progressId);
    if (abortControllers) {
      abortControllers.forEach((abortController, fileName) => {
        abortController.abort();
        markFileCancelled(progressId, fileName);
      });
    }

    // Update progress
    const progressItem = progressItems?.find(item => item.id === progressId);
    if (progressItem && progressItem.fileItems) {
      const updatedFileItems = progressItem.fileItems.map(item => {
        if (item.status === 'pending' || item.status === 'uploading') {
          markFileCancelled(progressId, item.fileName);
          return { ...item, status: 'cancelled' };
        }
        return item;
      });

      updateProgress({
        id: progressId,
        fileItems: updatedFileItems,
        status: 'error',
        error: '업로드가 취소되었습니다.',
      });

      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
        uploadAbortControllersRef.current.delete(progressId);
        cancelledFilesRef.current.delete(progressId);
      }, 3000);
    }
  }, [markFileCancelled, updateProgress]);

  return {
    handleUploadStart,
    handleRetryUpload,
    handleCancelUploadFile,
    handleCancelAllUpload,
  };
};
