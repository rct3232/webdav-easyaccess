import { useState, useCallback } from 'react';
import { moveFile, copyFile, deleteFile, downloadMultipleFiles } from '../services/fileService';
import { useFileOperationProgress } from './useFileOperationProgress';
import { getErrorMessage } from '../utils/errorUtils';

export const useBulkOperations = (
  selectedFiles,
  files,
  loadFiles,
  setTreeUpdateTrigger,
  setDropMessage,
  setSelectedFiles,
  setSelectionMode,
  options = {}
) => {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerAction, setFolderPickerAction] = useState(null);
  const { progressItems, updateProgress } = useFileOperationProgress();

  const markProcessing = options.markProcessing || (() => {});
  const clearProcessing = options.clearProcessing || (() => {});

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

  const handleBulkDelete = useCallback(async (retryData = null, onConfirm = null) => {
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    
    if (filePaths.length === 0) return;
    
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
    const retryDataObj = { type: 'delete', filePaths };
    
    updateProgressWithRetry(progressId, {
      type: 'delete',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 삭제`,
    }, retryDataObj);

    let successCount = 0;
    let failCount = 0;
    const deletedFolders = [];
    const failedItems = [];

    for (const filePath of filePaths) {
      try {
        updateProgressWithRetry(progressId, {
          type: 'delete',
          status: 'processing',
          progress: successCount,
          total: filePaths.length,
          current: `(${successCount}/${filePaths.length}) 삭제중...`,
          name: `${filePaths.length}개 항목 삭제`,
        }, retryDataObj);

        await deleteFile(filePath);
        const file = files.find(f => f.path === filePath);
        if (file?.type === 'directory') {
          deletedFolders.push(filePath);
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
        failCount++;
        failedItems.push({
          fileName: filePath.split('/').pop(),
          error: getErrorMessage(error, '알 수 없는 오류'),
        });
      }
    }

    updateProgressWithRetry(progressId, {
      type: 'delete',
      status: failCount > 0 ? 'error' : 'completed',
      progress: successCount,
      total: filePaths.length,
      current: failCount > 0 
        ? `(${successCount}/${filePaths.length}) 삭제중... (${failCount}개 실패)` 
        : `(${successCount}/${filePaths.length}) 삭제중...`,
      name: `${filePaths.length}개 항목 삭제`,
      error: failCount > 0 ? `${failCount}개 실패` : undefined,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      keepOnError: failCount > 0,
    }, retryDataObj);

    if (successCount > 0) {
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
      loadFiles();
      
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

    if (failCount === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 3000);
    }
  }, [selectedFiles, files, loadFiles, setTreeUpdateTrigger, setSelectedFiles, setSelectionMode, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry]);

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
      await downloadMultipleFiles(filePaths, (progress) => {
        updateProgress({ ...progress, id: progressId });
      });
      
      setSelectedFiles(new Set());
      setSelectionMode(false);
      
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 3000);
    } catch (error) {
      console.error('Bulk download error:', error);
      updateProgress({
        id: progressId,
        status: 'error',
        error: error.message,
      });
    }
  };

  const handleFolderPickerSelect = useCallback(async (destinationPath, retryData = null) => {
    const action = retryData?.type || folderPickerAction;
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    
    if (!action || filePaths.length === 0) return;
    
    if (!retryData) {
      dismissFailedItems();
      setSelectionMode(false);
    }

    markProcessing(filePaths, action);
    const progressId = retryData?.progressId || `${action}_${Date.now()}`;
    const actionName = getActionName(action);
    const actionText = getActionText(action);
    const retryDataObj = { type: action, filePaths, destinationPath };
    
    updateProgressWithRetry(progressId, {
      type: action,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 ${actionName}`,
    }, retryDataObj);

    let successCount = 0;
    let failCount = 0;
    const failedItems = [];

    for (const sourcePath of filePaths) {
      try {
        const fileName = sourcePath.split('/').pop();
        const destinationFilePath = destinationPath === '/' 
          ? `/${fileName}` 
          : `${destinationPath}/${fileName}`;

        updateProgressWithRetry(progressId, {
          type: action,
          status: 'processing',
          progress: successCount,
          total: filePaths.length,
          current: `(${successCount}/${filePaths.length}) ${actionText}...`,
          name: `${filePaths.length}개 항목 ${actionName}`,
        }, retryDataObj);

        if (action === 'move') {
          await moveFile(sourcePath, destinationFilePath);
        } else if (action === 'copy') {
          await copyFile(sourcePath, destinationFilePath);
        }
        
        successCount++;
      } catch (error) {
        console.error(`Failed to ${action} ${sourcePath}:`, error);
        const errorMsg = getErrorMessage(error, '알 수 없는 오류');
        const fileName = sourcePath.split('/').pop();
        
        if (error.response?.status === 409 || errorMsg.includes('already exists')) {
          // Skip duplicate files
        } else {
          failCount++;
          failedItems.push({
            fileName,
            error: errorMsg,
          });
        }
      }
    }

    updateProgressWithRetry(progressId, {
      type: action,
      status: failCount > 0 ? 'error' : 'completed',
      progress: successCount,
      total: filePaths.length,
      current: failCount > 0 
        ? `(${successCount}/${filePaths.length}) ${actionText}... (${failCount}개 실패)` 
        : `(${successCount}/${filePaths.length}) ${actionText}...`,
      name: `${filePaths.length}개 항목 ${actionName}`,
      error: failCount > 0 ? `${failCount}개 실패` : undefined,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      keepOnError: failCount > 0,
    }, retryDataObj);

    if (successCount > 0) {
      if (!retryData) {
        setSelectedFiles(new Set());
        setSelectionMode(false);
      }
      loadFiles();
    }

    if (failCount === 0) {
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
  }, [selectedFiles, folderPickerAction, loadFiles, setSelectedFiles, setSelectionMode, dismissFailedItems, markProcessing, clearProcessing, updateProgressWithRetry, getActionName, getActionText]);

  const handleRetry = async (progressId) => {
    const progressItem = progressItems.find(item => item.id === progressId);
    if (!progressItem || !progressItem.retryData) {
      console.error('Retry data not found for progress item:', progressId);
      return;
    }

    const { type, filePaths, destinationPath } = progressItem.retryData;

    // 기존 progressItem 재사용하여 재시도
    if (type === 'delete') {
      await handleBulkDelete({ filePaths, progressId });
    } else if (type === 'move' || type === 'copy') {
      await handleFolderPickerSelect(destinationPath, { type, filePaths, progressId });
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
  };
};

