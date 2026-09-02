import { useCallback, useMemo, useState } from 'react';

/**
 * Explorer progress controller for FileManager.
 * Owns progress drawer open/close state and coordinates retry/cancel entry points
 * while delegating underlying operation execution to shell-provided callbacks/refs.
 */
export function useExplorerProgress({
  progressItems,
  updateProgress,
  handleRetry,

  // Upload retry/cancel dependencies (shell-owned execution details)
  executeExplorerUpload,
  explorerUploadFilesRef,
  explorerUploadAbortControllersRef,
  explorerUploadCancelledRef,
  explorerUploadCancelAllRequestedRef,

  // Bulk operation cancel (shell-owned execution)
  handleCancelBulkOperation,

  // Notifications/refresh wiring needed to preserve current UX
  handleOperationComplete,
  setTreeUpdateTrigger,
  currentPathRef,
  t,
}) {
  const [isProgressDrawerOpen, setIsProgressDrawerOpen] = useState(false);

  const openProgressDrawer = useCallback(() => setIsProgressDrawerOpen(true), []);
  const closeProgressDrawer = useCallback(() => setIsProgressDrawerOpen(false), []);

  const dismissProgressItem = useCallback(
    (progressId) => {
      if (!progressId) return;
      updateProgress({ id: progressId, remove: true });
    },
    [updateProgress]
  );

  // Cancel upload: single file
  const cancelUploadFile = useCallback(
    (progressId, fileName) => {
      if (!progressId?.startsWith('upload_drop_')) return;
      const controllers = explorerUploadAbortControllersRef.current.get(progressId);
      const cancelledSet = explorerUploadCancelledRef.current.get(progressId);
      controllers?.get(fileName)?.abort();
      cancelledSet?.add(fileName);

      const progressItem = progressItems.find((item) => item.id === progressId);
      if (progressItem?.fileItems) {
        const updatedFileItems = progressItem.fileItems.map((item) =>
          item.fileName === fileName ? { ...item, status: 'cancelled' } : item
        );
        updateProgress({ id: progressId, fileItems: updatedFileItems });
      }
    },
    [progressItems, updateProgress, explorerUploadAbortControllersRef, explorerUploadCancelledRef]
  );

  // Cancel upload: all files within the progress item
  const cancelAllUpload = useCallback(
    (progressId) => {
      if (!progressId?.startsWith('upload_drop_')) return;

      explorerUploadCancelAllRequestedRef.current.add(progressId);
      const controllers = explorerUploadAbortControllersRef.current.get(progressId);
      controllers?.forEach((ac) => ac.abort());

      const cancelledSet = explorerUploadCancelledRef.current.get(progressId);
      const progressItem = progressItems.find((item) => item.id === progressId);
      if (progressItem?.fileItems && cancelledSet) {
        progressItem.fileItems.forEach((item) => {
          if (item.status === 'pending' || item.status === 'uploading') {
            cancelledSet.add(item.fileName);
          }
        });

        const updatedFileItems = progressItem.fileItems.map((item) =>
          item.status === 'pending' || item.status === 'uploading'
            ? { ...item, status: 'cancelled' }
            : item
        );

        updateProgress({
          id: progressId,
          fileItems: updatedFileItems,
          status: 'warning',
          error: t('fileManager.uploadCancelled'),
          keepOnError: true,
        });

        handleOperationComplete({
          opType: 'upload',
          startedNodeId: progressItem.retryData?.parentNodeId ?? currentPathRef.current,
        });
        setTreeUpdateTrigger({ type: 'refresh', timestamp: Date.now() });
      }
    },
    [
      progressItems,
      updateProgress,
      explorerUploadAbortControllersRef,
      explorerUploadCancelledRef,
      explorerUploadCancelAllRequestedRef,
      handleOperationComplete,
      setTreeUpdateTrigger,
      currentPathRef,
      t,
    ]
  );

  // Cancel: upload (all) or bulk operation (job-based)
  const cancelAllProgress = useCallback(
    (progressId) => {
      const item = progressItems.find((i) => i.id === progressId);
      if (!item) return;

      if (item.type === 'upload') {
        cancelAllUpload(progressId);
      } else if (
        (item.type === 'delete' || item.type === 'move' || item.type === 'copy') &&
        item.jobId
      ) {
        handleCancelBulkOperation(progressId);
      }
    },
    [progressItems, cancelAllUpload, handleCancelBulkOperation]
  );

  // Retry: upload (failed-only) or fallback to bulk retry handler (provided via progress item)
  const retryProgress = useCallback(
    async (progressId) => {
      const progressItem = progressItems.find((item) => item.id === progressId);
      if (!progressItem || !progressItem.retryData) {
        if (handleRetry) return handleRetry(progressId);
        return;
      }

      if (progressItem.retryData.type !== 'upload') {
        if (handleRetry) return handleRetry(progressId);
        return;
      }

      const filesToUpload = explorerUploadFilesRef.current.get(progressId);
      if (!filesToUpload || filesToUpload.length === 0) {
        dismissProgressItem(progressId);
        explorerUploadFilesRef.current.delete(progressId);
        return;
      }

      const failedFileNames = new Set(
        (progressItem.fileItems || [])
          .filter((it) => it.status === 'error')
          .map((it) => it.fileName)
      );
      const failedFilesToUpload = filesToUpload.filter((item) =>
        failedFileNames.has(item.relativePath || item.file?.name)
      );

      if (failedFilesToUpload.length === 0) {
        dismissProgressItem(progressId);
        explorerUploadFilesRef.current.delete(progressId);
        return;
      }

      const targetParentNodeId = progressItem.retryData.parentNodeId;
      dismissProgressItem(progressId);
      explorerUploadFilesRef.current.delete(progressId);
      await executeExplorerUpload(failedFilesToUpload, targetParentNodeId);
    },
    [progressItems, handleRetry, explorerUploadFilesRef, executeExplorerUpload, dismissProgressItem]
  );

  const setProgressDrawerOpen = useCallback((open) => {
    setIsProgressDrawerOpen(Boolean(open));
  }, []);

  return useMemo(
    () => ({
      progressItems,
      updateProgress,

      isProgressDrawerOpen,
      openProgressDrawer,
      closeProgressDrawer,
      setProgressDrawerOpen,

      dismissProgressItem,
      retryProgress,
      cancelUploadFile,
      cancelAllProgress,
    }),
    [
      progressItems,
      updateProgress,
      isProgressDrawerOpen,
      openProgressDrawer,
      closeProgressDrawer,
      setProgressDrawerOpen,
      dismissProgressItem,
      retryProgress,
      cancelUploadFile,
      cancelAllProgress,
    ]
  );
}
