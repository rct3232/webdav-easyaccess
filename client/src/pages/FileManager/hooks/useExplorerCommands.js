import { useCallback, useMemo, useRef, useState } from 'react';
import explorerGateway from '../../../services/explorerGateway';
import { createProcessingUpdater } from '../../../utils/processingUtils';
import { getServerErrorDisplay, showErrorFromError } from '../../../utils/errorUtils';
import { HTTP_STATUS } from '@webdav-easyaccess/shared/constants';
import { validateFileName } from '@webdav-easyaccess/shared/validation';
import { getValidationMessage } from '../../../utils/validationMessage';
import { shouldRefreshAfterOperation } from '../../../utils/refreshPolicy';
import { useBulkOperations } from './useBulkOperations';
import { useFileOperations } from './useFileOperations';

export function useExplorerCommands({
  t,
  user,
  isShareLinkMode,
  shareToken,
  currentNodeId,
  currentNodeIdRef,
  refreshNow,
  getCurrentNodeIdNow,
  hasWritePermission,
  selectedFiles,
  sortedFiles,
  dismissFailedItems,
  setTreeUpdateTrigger,
  setDropMessage,
  setSelectedFiles,
  setSelectionMode,
  showError,
  // dialogs / UI state (shell-owned)
  closeUploadDialog,
  closeBulkDeleteDialog,
  closeRenameDialog,
  closeActionSheet,
  setActionSheetOpen,
  setActionSheetFile,
  actionSheetFile,
  mobileRenameFile,
  renameNewName,
  setRenameError,
  bulkDeleteFilePaths,
}) {
  const [renameLoading, setRenameLoading] = useState(false);

  const [uploadConflictData, setUploadConflictData] = useState(null);
  const explorerUploadAbortControllersRef = useRef(new Map());
  const explorerUploadCancelledRef = useRef(new Map());
  const explorerUploadCancelAllRequestedRef = useRef(new Set());
  const explorerUploadFilesRef = useRef(new Map());

  const [processingMap, setProcessingMap] = useState(new Map());
  const { markProcessing, clearProcessing } = createProcessingUpdater(setProcessingMap);

  const handleOperationComplete = useCallback(
    (info = {}) => {
      const payload = typeof info === 'string' ? { opType: 'delete' } : info || {};

      const opType = payload.opType || payload.type || 'refresh';
      const startedNodeId = payload.startedNodeId;
      const targetParentNodeId = payload.targetParentNodeId;
      const currentNodeIdNow =
        typeof getCurrentNodeIdNow === 'function'
          ? getCurrentNodeIdNow()
          : currentNodeIdRef?.current;

      const deletedNodeIds = Array.isArray(payload.deletedNodeIds)
        ? payload.deletedNodeIds
        : payload.deletedNodeId
          ? [payload.deletedNodeId]
          : [];

      deletedNodeIds.filter(Boolean).forEach((nodeId) => {
        setTreeUpdateTrigger({
          type: 'deleted',
          nodeId,
          timestamp: Date.now(),
        });
      });

      const shouldRefresh = shouldRefreshAfterOperation({
        opType,
        startedNodeId: startedNodeId ?? currentNodeIdNow,
        currentNodeIdNow,
        targetParentNodeId,
      });

      if (shouldRefresh && typeof refreshNow === 'function') {
        refreshNow();
      }

      if (deletedNodeIds.length > 0) {
        setTimeout(() => {
          setTreeUpdateTrigger({
            type: 'refresh',
            timestamp: Date.now(),
          });
        }, 500);
      }
    },
    [currentNodeIdRef, getCurrentNodeIdNow, refreshNow, setTreeUpdateTrigger]
  );

  const {
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
    dismissFailedItems: dismissFailedItemsFromBulk,
    setFolderPickerOpen,
    setFolderPickerAction,
    bulkConflictData,
    resolveBulkConflict,
    setBulkConflictData,
  } = useBulkOperations(
    selectedFiles,
    sortedFiles,
    handleOperationComplete,
    setTreeUpdateTrigger,
    setDropMessage,
    setSelectedFiles,
    setSelectionMode,
    () => currentNodeIdRef?.current ?? currentNodeId,
    { markProcessing, clearProcessing, shareToken: isShareLinkMode ? shareToken : undefined }
  );

  const dismissFailedItemsSafe = useCallback(() => {
    if (typeof dismissFailedItems === 'function') dismissFailedItems();
    if (typeof dismissFailedItemsFromBulk === 'function') dismissFailedItemsFromBulk();
  }, [dismissFailedItems, dismissFailedItemsFromBulk]);

  const { handleFileDownload: handleFileDownloadOp, handleFileRename: handleFileRenameOp } =
    useFileOperations({
      onProgress: updateProgress,
      setProcessingMap,
      onActionComplete: handleOperationComplete,
      onClose: () => {
        setActionSheetOpen(false);
        setActionSheetFile(null);
      },
      onConflictResolveStart: () => {
        setSelectionMode(false);
        setSelectedFiles(new Set());
      },
    });

  const executeExplorerUpload = useCallback(
    async (filesToUpload, parentNodeId, onConflict = 'error') => {
      const uploadParentNodeId = parentNodeId || currentNodeId;
      if (!filesToUpload || filesToUpload.length === 0) return;

      dismissFailedItemsSafe();

      const progressId = `upload_drop_${Date.now()}`;
      explorerUploadAbortControllersRef.current.set(progressId, new Map());
      explorerUploadCancelledRef.current.set(progressId, new Set());
      explorerUploadFilesRef.current.set(progressId, filesToUpload);

      const fileItems = filesToUpload.map(({ file, relativePath }) => ({
        fileName: relativePath || file?.name || 'unknown',
        status: 'pending',
        error: undefined,
      }));

      const baseProgress = {
        id: progressId,
        type: 'upload',
        progress: 0,
        total: filesToUpload.length,
        current: '',
        name: t('fileManager.uploadFileCount', { count: filesToUpload.length }),
        fileItems: [...fileItems],
        cancellable: true,
        retryData: { type: 'upload', parentNodeId: uploadParentNodeId },
      };

      if (!hasWritePermission && !user?.is_admin) {
        updateProgress({
          ...baseProgress,
          status: 'error',
          error: t('fileManager.uploadNoPermission'),
          keepOnError: true,
        });
        return;
      }

      updateProgress({
        ...baseProgress,
        status: 'preparing',
        current: t('fileManager.uploadPreparing'),
      });

      const cancelledSet = explorerUploadCancelledRef.current.get(progressId);
      const abortControllers = explorerUploadAbortControllersRef.current.get(progressId);
      const getSignalForFile = (fileName) => {
        if (cancelledSet?.has(fileName)) {
          const ac = new AbortController();
          ac.abort();
          return ac.signal;
        }
        const controller = new AbortController();
        abortControllers?.set(fileName, controller);
        return controller.signal;
      };

      try {
        const { errors } = await explorerGateway.uploadToPath({
          parentNodeId: uploadParentNodeId,
          files: filesToUpload,
          onProgress: (progress) => {
            if (explorerUploadCancelAllRequestedRef.current.has(progressId)) return;
            const fileName = progress.currentFile;
            const fileStatus =
              progress.status === 'uploading'
                ? 'uploading'
                : progress.status === 'success'
                  ? 'completed'
                  : progress.status === 'skipped'
                    ? 'skipped'
                    : progress.status === 'error'
                      ? 'error'
                      : progress.status === 'cancelled'
                        ? 'cancelled'
                        : 'pending';
            const idx = fileItems.findIndex((it) => it.fileName === fileName);
            if (idx !== -1) {
              fileItems[idx] = {
                ...fileItems[idx],
                status: fileStatus,
                error: progress.status === 'error' ? progress.error : undefined,
              };
            }

            const completedCount = fileItems.filter((it) => it.status === 'completed').length;
            const skippedCount = fileItems.filter((it) => it.status === 'skipped').length;
            const failCount = fileItems.filter((it) => it.status === 'error').length;

            const progressPayload = {
              ...baseProgress,
              status: 'processing',
              progress: completedCount + skippedCount,
              total: progress.total,
              current: `(${progress.current}/${progress.total}) ${progress.currentFile}`,
              error:
                failCount > 0 ? t('fileManager.uploadFailCount', { count: failCount }) : undefined,
              keepOnError: failCount > 0 || skippedCount > 0 || undefined,
              updatedFileItem: {
                fileName,
                status: fileStatus,
                error: progress.status === 'error' ? progress.error : undefined,
              },
            };
            delete progressPayload.fileItems;
            updateProgress(progressPayload);
          },
          onConflict,
          options: { getSignalForFile },
        });

        const completedCount = fileItems.filter((it) => it.status === 'completed').length;
        const skippedCount = fileItems.filter((it) => it.status === 'skipped').length;
        const failCount = fileItems.filter((it) => it.status === 'error').length;
        const failedItems = (errors || []).map((e) => ({
          fileName: e.relativePath || e.file?.name || 'unknown',
          error: e.error,
        }));

        if (explorerUploadCancelAllRequestedRef.current.has(progressId)) {
          handleOperationComplete({ opType: 'upload', startedNodeId: uploadParentNodeId });
          return;
        }

        if (failCount > 0) {
          updateProgress({
            ...baseProgress,
            status: 'error',
            progress: completedCount + skippedCount,
            total: filesToUpload.length,
            current: t('fileManager.uploadCompletePartial'),
            error: t('fileManager.uploadFailMessage', { count: failCount }),
            keepOnError: true,
            failedItems: failedItems.length > 0 ? failedItems : undefined,
            fileItems: [...fileItems],
          });
        } else if (skippedCount > 0) {
          updateProgress({
            ...baseProgress,
            status: 'warning',
            progress: completedCount + skippedCount,
            total: filesToUpload.length,
            current: t('fileManager.pullRefreshDone'),
            error: t('fileManager.uploadSkippedCount', { count: skippedCount }),
            keepOnError: true,
            fileItems: [...fileItems],
          });
        } else {
          updateProgress({
            ...baseProgress,
            status: 'completed',
            progress: filesToUpload.length,
            total: filesToUpload.length,
            current: t('fileManager.pullRefreshDone'),
            fileItems: [...fileItems],
          });
          setTimeout(() => {
            updateProgress({ id: progressId, remove: true });
            explorerUploadFilesRef.current.delete(progressId);
          }, 3000);
        }

        handleOperationComplete({ opType: 'upload', startedNodeId: uploadParentNodeId });
        setTreeUpdateTrigger({
          type: 'refresh',
          timestamp: Date.now(),
        });
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Upload error:', error);

        let errorMessage =
          getServerErrorDisplay(error?.response?.data, t) ||
          error?.message ||
          t('fileManager.uploadFailed');
        if (error.response?.status === HTTP_STATUS.FORBIDDEN) {
          errorMessage = t('fileManager.uploadNoPermission');
        } else if (error.response?.status === HTTP_STATUS.INTERNAL_SERVER_ERROR) {
          errorMessage = t('fileManager.uploadServerError', { message: errorMessage });
        }

        updateProgress({
          ...baseProgress,
          status: 'error',
          error: errorMessage,
          keepOnError: true,
          fileItems: [...fileItems],
        });
        handleOperationComplete({ opType: 'upload', startedNodeId: uploadParentNodeId });
      } finally {
        explorerUploadAbortControllersRef.current.delete(progressId);
        explorerUploadCancelledRef.current.delete(progressId);
        explorerUploadCancelAllRequestedRef.current.delete(progressId);
      }
    },
    [
      currentNodeId,
      dismissFailedItemsSafe,
      hasWritePermission,
      user,
      updateProgress,
      handleOperationComplete,
      setTreeUpdateTrigger,
      t,
    ]
  );

  const resolveUploadConflict = useCallback(
    async (resolution) => {
      if (!uploadConflictData) return;

      const { filesToUpload, parentNodeId } = uploadConflictData;
      setUploadConflictData(null);

      if (filesToUpload.length > 0) {
        await executeExplorerUpload(filesToUpload, parentNodeId, resolution);
      }
    },
    [uploadConflictData, executeExplorerUpload]
  );

  const handleUploadStart = useCallback(
    async (files, uploadParentNodeId) => {
      closeUploadDialog();

      if (!files || files.length === 0) return;
      const filesToUpload = files.map((f) => ({
        file: f,
        relativePath: f.webkitRelativePath || f.name,
      }));

      const progressId = `upload_check_${Date.now()}`;
      updateProgress({
        id: progressId,
        type: 'upload',
        status: 'preparing',
        progress: 0,
        total: filesToUpload.length,
        current: t('fileManager.statusConflictCheck'),
        name: t('fileManager.uploadFileCount', { count: filesToUpload.length }),
      });

      try {
        const conflicts = await explorerGateway.checkConflicts({
          parentNodeId: uploadParentNodeId,
          files: filesToUpload,
        });

        if (conflicts && conflicts.length > 0) {
          updateProgress({ id: progressId, remove: true });
          setUploadConflictData({ filesToUpload, parentNodeId: uploadParentNodeId, conflicts });
          return;
        }

        updateProgress({ id: progressId, remove: true });
        await executeExplorerUpload(filesToUpload, uploadParentNodeId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Upload conflict check failed:', error);
        updateProgress({ id: progressId, remove: true });
        await executeExplorerUpload(filesToUpload, uploadParentNodeId);
      }
    },
    [closeUploadDialog, executeExplorerUpload, updateProgress, t]
  );

  const handleExplorerDrop = useCallback(
    async (filesToUpload, parentNodeId) => {
      const uploadParentNodeId = parentNodeId || currentNodeId;
      if (!filesToUpload || filesToUpload.length === 0) return;

      const progressId = `upload_check_${Date.now()}`;
      updateProgress({
        id: progressId,
        type: 'upload',
        status: 'preparing',
        progress: 0,
        total: filesToUpload.length,
        current: t('fileManager.statusConflictCheck'),
        name: t('fileManager.uploadFileCount', { count: filesToUpload.length }),
      });

      try {
        const conflicts = await explorerGateway.checkConflicts({
          parentNodeId: uploadParentNodeId,
          files: filesToUpload,
        });

        if (conflicts && conflicts.length > 0) {
          updateProgress({ id: progressId, remove: true });
          setUploadConflictData({ filesToUpload, parentNodeId: uploadParentNodeId, conflicts });
          return;
        }

        updateProgress({ id: progressId, remove: true });
        await executeExplorerUpload(filesToUpload, uploadParentNodeId);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('Upload conflict check failed:', error);
        updateProgress({ id: progressId, remove: true });
        await executeExplorerUpload(filesToUpload, uploadParentNodeId);
      }
    },
    [currentNodeId, updateProgress, executeExplorerUpload, t]
  );

  const handleBulkDeleteConfirm = useCallback(() => {
    const nodeIds = [...bulkDeleteFilePaths];
    closeBulkDeleteDialog();
    setSelectedFiles(new Set());
    setSelectionMode(false);
    handleBulkDelete({ nodeIds }, null);
  }, [
    bulkDeleteFilePaths,
    closeBulkDeleteDialog,
    handleBulkDelete,
    setSelectedFiles,
    setSelectionMode,
  ]);

  const handleRename = useCallback(async () => {
    const targetFile = mobileRenameFile || actionSheetFile;
    if (!targetFile) return;
    const nameError = validateFileName(renameNewName);
    if (nameError) {
      setRenameError(getValidationMessage(nameError, t));
      return;
    }

    setRenameLoading(true);
    try {
      setRenameError('');
      await handleFileRenameOp(targetFile, renameNewName, {
        startedNodeId: currentNodeIdRef?.current,
      });
      closeRenameDialog();
      closeActionSheet();
    } finally {
      setRenameLoading(false);
    }
  }, [
    actionSheetFile,
    closeActionSheet,
    closeRenameDialog,
    currentNodeIdRef,
    handleFileRenameOp,
    mobileRenameFile,
    renameNewName,
    setRenameError,
    t,
  ]);

  const handleActionSheetDownload = useCallback(async () => {
    if (!actionSheetFile) return;
    try {
      await handleFileDownloadOp(actionSheetFile);
      closeActionSheet();
    } catch {
      // handled in useFileOperations
    }
  }, [actionSheetFile, closeActionSheet, handleFileDownloadOp]);

  const moveNodeIdsToFolder = useCallback(
    async (sourceNodeIds, destinationParentNodeId) => {
      const nodeIds = Array.isArray(sourceNodeIds) ? sourceNodeIds.filter(Boolean) : [];
      if (!destinationParentNodeId || nodeIds.length === 0) return;

      if (nodeIds.includes(destinationParentNodeId)) return;
      try {
        await handleFolderPickerSelect(destinationParentNodeId, { type: 'move', nodeIds });
      } catch {
        // handled in useBulkOperations
      }
    },
    [handleFolderPickerSelect]
  );

  const handleFileDrop = useCallback(
    (draggedFile, targetFolder) => {
      moveNodeIdsToFolder([draggedFile.nodeId], targetFolder.nodeId);
    },
    [moveNodeIdsToFolder]
  );

  const handleInternalFileDrop = useCallback(
    (draggedNodeId, destinationParentNodeId) => {
      moveNodeIdsToFolder([draggedNodeId], destinationParentNodeId);
    },
    [moveNodeIdsToFolder]
  );

  const handleDropPermissionDenied = useCallback(
    (destinationPath) => {
      showError(t('fileManager.dropNoWritePermission', { path: destinationPath }));
    },
    [showError, t]
  );

  const folderPickerMoveCopyInProgress = useMemo(() => {
    if (folderPickerOpen && (folderPickerAction === 'move' || folderPickerAction === 'copy'))
      return true;
    if (bulkConflictData != null) return true;
    const hasActiveBulkMoveCopy = progressItems.some(
      (item) =>
        (item.type === 'move' || item.type === 'copy') &&
        (item.status === 'preparing' || item.status === 'processing')
    );
    return !!hasActiveBulkMoveCopy;
  }, [folderPickerOpen, folderPickerAction, bulkConflictData, progressItems]);

  const renameEntry = useCallback(
    async (file, newName) => {
      const nameError = validateFileName(newName);
      if (nameError) {
        throw new Error(getValidationMessage(nameError, t));
      }

      await handleFileRenameOp(file, newName, { startedNodeId: currentNodeIdRef?.current });
    },
    [currentNodeIdRef, handleFileRenameOp, t]
  );

  const deleteEntries = useCallback(
    async (nodeIds) => {
      const ids = Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : [];
      if (ids.length === 0) return;
      await handleBulkDelete({ nodeIds: ids }, null);
    },
    [handleBulkDelete]
  );

  const moveEntries = useCallback(
    async (nodeIds, destinationParentNodeId) => {
      const ids = Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : [];
      if (!destinationParentNodeId || ids.length === 0) return;
      await handleFolderPickerSelect(destinationParentNodeId, { type: 'move', nodeIds: ids });
    },
    [handleFolderPickerSelect]
  );

  const copyEntries = useCallback(
    async (nodeIds, destinationParentNodeId) => {
      const ids = Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : [];
      if (!destinationParentNodeId || ids.length === 0) return;
      await handleFolderPickerSelect(destinationParentNodeId, { type: 'copy', nodeIds: ids });
    },
    [handleFolderPickerSelect]
  );

  const downloadEntries = useCallback(
    async (nodeIds) => {
      const ids = Array.isArray(nodeIds) ? nodeIds.filter(Boolean) : [];
      if (ids.length === 0) return;
      await handleBulkDownload({ nodeIds: ids });
    },
    [handleBulkDownload]
  );

  const uploadFiles = useCallback(
    async (files, targetParentNodeId) => {
      if (!files) return;
      const list = Array.isArray(files) ? files : Array.from(files);
      await handleUploadStart(list, targetParentNodeId ?? currentNodeIdRef?.current);
    },
    [currentNodeIdRef, handleUploadStart]
  );

  const runWithErrorSurface = useCallback(
    async (fn) => {
      try {
        return await fn();
      } catch (err) {
        showErrorFromError(err, showError, t);
        throw err;
      }
    },
    [showError, t]
  );

  return useMemo(
    () => ({
      processingMap,
      setProcessingMap,
      renameLoading,

      // bulk ops
      folderPickerOpen,
      folderPickerAction,
      setFolderPickerOpen,
      setFolderPickerAction,
      progressItems,
      updateProgress,
      handleBulkMove,
      handleBulkCopy,
      handleBulkDelete,
      handleBulkDownload,
      handleFolderPickerSelect,
      handleRetry,
      handleCancelBulkOperation,
      bulkConflictData,
      resolveBulkConflict,
      setBulkConflictData,
      folderPickerMoveCopyInProgress,

      // upload
      uploadConflictData,
      setUploadConflictData,
      resolveUploadConflict,
      executeExplorerUpload,
      handleUploadStart,
      handleExplorerDrop,
      explorerUploadFilesRef,
      explorerUploadAbortControllersRef,
      explorerUploadCancelledRef,
      explorerUploadCancelAllRequestedRef,

      // action sheet
      handleRename,
      handleActionSheetDownload,
      handleFileDownloadOp,

      // dnd move
      handleFileDrop,
      handleInternalFileDrop,
      handleDropPermissionDenied,

      // confirm flows
      handleBulkDeleteConfirm,
      handleOperationComplete,

      // command-style API (for future wiring)
      uploadFiles: (files, targetParentNodeId) =>
        runWithErrorSurface(() => uploadFiles(files, targetParentNodeId)),
      renameEntry: (file, newName) => runWithErrorSurface(() => renameEntry(file, newName)),
      moveEntries: (nodeIds, destinationParentNodeId) =>
        runWithErrorSurface(() => moveEntries(nodeIds, destinationParentNodeId)),
      copyEntries: (nodeIds, destinationParentNodeId) =>
        runWithErrorSurface(() => copyEntries(nodeIds, destinationParentNodeId)),
      deleteEntries: (nodeIds) => runWithErrorSurface(() => deleteEntries(nodeIds)),
      downloadEntries: (nodeIds) => runWithErrorSurface(() => downloadEntries(nodeIds)),
    }),
    [
      processingMap,
      setProcessingMap,
      renameLoading,
      folderPickerOpen,
      folderPickerAction,
      setFolderPickerOpen,
      setFolderPickerAction,
      progressItems,
      updateProgress,
      handleBulkMove,
      handleBulkCopy,
      handleBulkDelete,
      handleBulkDownload,
      handleFolderPickerSelect,
      handleRetry,
      handleCancelBulkOperation,
      bulkConflictData,
      resolveBulkConflict,
      setBulkConflictData,
      folderPickerMoveCopyInProgress,
      uploadConflictData,
      setUploadConflictData,
      resolveUploadConflict,
      executeExplorerUpload,
      handleUploadStart,
      handleExplorerDrop,
      explorerUploadFilesRef,
      explorerUploadAbortControllersRef,
      explorerUploadCancelledRef,
      explorerUploadCancelAllRequestedRef,
      handleRename,
      handleActionSheetDownload,
      handleFileDownloadOp,
      handleFileDrop,
      handleInternalFileDrop,
      handleDropPermissionDenied,
      handleBulkDeleteConfirm,
      handleOperationComplete,
      runWithErrorSurface,
      uploadFiles,
      renameEntry,
      moveEntries,
      copyEntries,
      deleteEntries,
      downloadEntries,
    ]
  );
}
