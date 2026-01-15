import { useState } from 'react';
import { moveFile, copyFile, deleteFile, downloadMultipleFiles } from '../services/fileService';
import { useFileOperationProgress } from './useFileOperationProgress';

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
  const dismissFailedItems = () => {
    progressItems.forEach(item => {
      if (item.status === 'error' && item.keepOnError) {
        updateProgress({ id: item.id, remove: true });
      }
    });
  };

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

  const handleBulkDelete = async (retryData = null) => {
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    
    if (filePaths.length === 0) return;
    
    if (!retryData) {
      dismissFailedItems();
      setSelectionMode(false);
      const confirmMessage = `선택한 ${filePaths.length}개의 파일/폴더를 삭제하시겠습니까?`;
      if (!window.confirm(confirmMessage)) return;
    }

    markProcessing(filePaths, 'delete');
    const progressId = retryData?.progressId || `delete_${Date.now()}`;
    
    updateProgress({
      id: progressId,
      type: 'delete',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 삭제`,
      retryData: {
        type: 'delete',
        filePaths: filePaths,
      },
    });

    let successCount = 0;
    let failCount = 0;
    const deletedFolders = [];
    const failedItems = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      try {
        updateProgress({
          id: progressId,
          type: 'delete',
          status: 'processing',
          progress: successCount,
          total: filePaths.length,
          current: `(${successCount}/${filePaths.length}) 삭제중...`,
          name: `${filePaths.length}개 항목 삭제`,
          retryData: {
            type: 'delete',
            filePaths: filePaths,
          },
        });

        await deleteFile(filePath);
        const file = files.find(f => f.path === filePath);
        if (file && file.type === 'directory') {
          deletedFolders.push(filePath);
        }
        successCount++;
        
        updateProgress({
          id: progressId,
          type: 'delete',
          status: 'processing',
          progress: successCount,
          total: filePaths.length,
          current: `(${successCount}/${filePaths.length}) 삭제중...`,
          name: `${filePaths.length}개 항목 삭제`,
          retryData: {
            type: 'delete',
            filePaths: filePaths,
          },
        });
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
        failCount++;
        const fileName = filePath.split('/').pop();
        const errorMsg = error.response?.data?.error || error.message || '알 수 없는 오류';
        failedItems.push({
          fileName: fileName,
          error: errorMsg,
        });
      }
    }

    updateProgress({
      id: progressId,
      type: 'delete',
      status: failCount > 0 ? 'error' : 'completed',
      progress: successCount,
      total: filePaths.length,
      current: failCount > 0 ? `(${successCount}/${filePaths.length}) 삭제중... (${failCount}개 실패)` : `(${successCount}/${filePaths.length}) 삭제중...`,
      name: `${filePaths.length}개 항목 삭제`,
      error: failCount > 0 ? `${failCount}개 실패` : undefined,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      keepOnError: failCount > 0,
      retryData: {
        type: 'delete',
        filePaths: filePaths,
      },
    });

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
        setSelectionMode(false);
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

    // 실패가 없을 때만 자동 제거
    if (failCount === 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, 3000);
    }
  };

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

  const handleFolderPickerSelect = async (destinationPath, retryData = null) => {
    const action = retryData?.type || folderPickerAction;
    const filePaths = retryData?.filePaths || Array.from(selectedFiles);
    
    if (!action || filePaths.length === 0) return;
    
    if (!retryData) {
      dismissFailedItems();
      // 이동/복사 실행 시점에 선택 모드 해제
      setSelectionMode(false);
    }

    markProcessing(filePaths, action);
    const progressId = retryData?.progressId || `${action}_${Date.now()}`;
    
    updateProgress({
      id: progressId,
      type: action,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 ${action === 'move' ? '이동' : '복사'}`,
      retryData: {
        type: action,
        filePaths: filePaths,
        destinationPath: destinationPath,
      },
    });

    let successCount = 0;
    let failCount = 0;
    const skippedFiles = [];
    const failedItems = [];

    for (let i = 0; i < filePaths.length; i++) {
      const sourcePath = filePaths[i];
      try {
        const fileName = sourcePath.split('/').pop();
        const destinationFilePath = destinationPath === '/' 
          ? `/${fileName}` 
          : `${destinationPath}/${fileName}`;

        const actionText = action === 'move' ? '이동중' : '복사중';
        updateProgress({
          id: progressId,
          type: action,
          status: 'processing',
          progress: successCount,
          total: filePaths.length,
          current: `(${successCount}/${filePaths.length}) ${actionText}...`,
          name: `${filePaths.length}개 항목 ${action === 'move' ? '이동' : '복사'}`,
          retryData: {
            type: action,
            filePaths: filePaths,
            destinationPath: destinationPath,
          },
        });

        if (action === 'move') {
          await moveFile(sourcePath, destinationFilePath);
        } else if (action === 'copy') {
          await copyFile(sourcePath, destinationFilePath);
        }
        
        successCount++;
        
        updateProgress({
          id: progressId,
          type: action,
          status: 'processing',
          progress: successCount,
          total: filePaths.length,
          current: `(${successCount}/${filePaths.length}) ${actionText}...`,
          name: `${filePaths.length}개 항목 ${action === 'move' ? '이동' : '복사'}`,
          retryData: {
            type: action,
            filePaths: filePaths,
            destinationPath: destinationPath,
          },
        });
      } catch (error) {
        console.error(`Failed to ${action} ${sourcePath}:`, error);
        const errorMsg = error.response?.data?.error || error.message || '알 수 없는 오류';
        const fileName = sourcePath.split('/').pop();
        
        if (error.response?.status === 409 || errorMsg.includes('already exists')) {
          skippedFiles.push(fileName);
        } else {
          failCount++;
          failedItems.push({
            fileName: fileName,
            error: errorMsg,
          });
        }
      }
    }

    const actionText = action === 'move' ? '이동중' : '복사중';
    updateProgress({
      id: progressId,
      type: action,
      status: failCount > 0 ? 'error' : 'completed',
      progress: successCount,
      total: filePaths.length,
      current: failCount > 0 ? `(${successCount}/${filePaths.length}) ${actionText}... (${failCount}개 실패)` : `(${successCount}/${filePaths.length}) ${actionText}...`,
      name: `${filePaths.length}개 항목 ${action === 'move' ? '이동' : '복사'}`,
      error: failCount > 0 ? `${failCount}개 실패` : undefined,
      failedItems: failedItems.length > 0 ? failedItems : undefined,
      keepOnError: failCount > 0,
      retryData: {
        type: action,
        filePaths: filePaths,
        destinationPath: destinationPath,
      },
    });

    if (successCount > 0) {
      if (!retryData) {
        setSelectedFiles(new Set());
        setSelectionMode(false);
      }
      loadFiles();
    }

    // 실패가 없을 때만 자동 제거
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
  };

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

