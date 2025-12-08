import { useState } from 'react';
import { moveFile, copyFile, deleteFile, downloadMultipleFiles } from '../services/fileService';

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
  const [progressItems, setProgressItems] = useState([]);

  const markProcessing = options.markProcessing || (() => {});
  const clearProcessing = options.clearProcessing || (() => {});

  const handleBulkMove = () => {
    setFolderPickerAction('move');
    setFolderPickerOpen(true);
  };

  const handleBulkCopy = () => {
    setFolderPickerAction('copy');
    setFolderPickerOpen(true);
  };

  const handleBulkDelete = async () => {
    if (selectedFiles.size === 0) return;
    setSelectionMode(false);
    
    const confirmMessage = `선택한 ${selectedFiles.size}개의 파일/폴더를 삭제하시겠습니까?`;
    if (!window.confirm(confirmMessage)) return;

    const filePaths = Array.from(selectedFiles);
    markProcessing(filePaths, 'delete');
    const progressId = `delete_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: 'delete',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 삭제`,
    };
    
    setProgressItems(prev => [...prev, progressItem]);

    let successCount = 0;
    let failCount = 0;
    const deletedFolders = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      try {
        setProgressItems(prev => {
          const currentItem = prev.find(item => item.id === progressId);
          const currentProgress = currentItem ? currentItem.progress || 0 : 0;
          return prev.map(item => 
            item.id === progressId 
              ? { 
                  ...item, 
                  status: 'processing',
                  progress: currentProgress,
                  total: filePaths.length,
                  current: `(${currentProgress}/${filePaths.length}) 삭제중...`,
                }
              : item
          );
        });

        await deleteFile(filePath);
        const file = files.find(f => f.path === filePath);
        if (file && file.type === 'directory') {
          deletedFolders.push(filePath);
        }
        successCount++;
        
        setProgressItems(prev => {
          const currentItem = prev.find(item => item.id === progressId);
          const currentProgress = currentItem ? (currentItem.progress || 0) + 1 : 1;
          return prev.map(item => 
            item.id === progressId 
              ? { 
                  ...item, 
                  status: 'processing',
                  progress: currentProgress,
                  total: filePaths.length,
                  current: `(${currentProgress}/${filePaths.length}) 삭제중...`,
                }
              : item
          );
        });
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
        failCount++;
      }
    }

    setProgressItems(prev => 
      prev.map(item => 
        item.id === progressId 
          ? { 
              ...item, 
              status: failCount > 0 ? 'error' : 'completed',
              progress: successCount,
              total: filePaths.length,
              current: failCount > 0 ? `(${successCount}/${filePaths.length}) 삭제중... (${failCount}개 실패)` : `(${successCount}/${filePaths.length}) 삭제중...`,
              error: failCount > 0 ? `${failCount}개 실패` : undefined,
            }
          : item
      )
    );

    if (successCount > 0) {
      deletedFolders.forEach(folderPath => {
        setTreeUpdateTrigger({
          type: 'deleted',
          folderPath,
          timestamp: Date.now(),
        });
      });

      setSelectedFiles(new Set());
      setSelectionMode(false);
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

    setTimeout(() => {
      setProgressItems(prev => prev.filter(item => item.id !== progressId));
    }, 3000);
  };

  const handleBulkDownload = async () => {
    if (selectedFiles.size === 0) return;
    setSelectionMode(false);

    const filePaths = Array.from(selectedFiles);
    const progressId = `download_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: 'download',
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      zipName: '',
    };
    
    setProgressItems(prev => [...prev, progressItem]);

    try {
      await downloadMultipleFiles(filePaths, (progress) => {
        setProgressItems(prev => 
          prev.map(item => item.id === progressId ? { ...progress, id: progressId } : item)
        );
      });
      
      setSelectedFiles(new Set());
      setSelectionMode(false);
      
      setTimeout(() => {
        setProgressItems(prev => prev.filter(item => item.id !== progressId));
      }, 3000);
    } catch (error) {
      console.error('Bulk download error:', error);
      setProgressItems(prev => 
        prev.map(item => 
          item.id === progressId 
            ? { ...item, status: 'error', error: error.message }
            : item
        )
      );
    }
  };

  const handleFolderPickerSelect = async (destinationPath) => {
    if (!folderPickerAction || selectedFiles.size === 0) return;
    // 이동/복사 실행 시점에 선택 모드 해제
    setSelectionMode(false);

    const filePaths = Array.from(selectedFiles);
    markProcessing(filePaths, folderPickerAction);
    const progressId = `${folderPickerAction}_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: folderPickerAction,
      status: 'preparing',
      progress: 0,
      total: filePaths.length,
      current: '',
      name: `${filePaths.length}개 항목 ${folderPickerAction === 'move' ? '이동' : '복사'}`,
    };
    
    setProgressItems(prev => [...prev, progressItem]);

    let successCount = 0;
    let failCount = 0;
    const skippedFiles = [];

    for (let i = 0; i < filePaths.length; i++) {
      const sourcePath = filePaths[i];
      try {
        const fileName = sourcePath.split('/').pop();
        const destinationFilePath = destinationPath === '/' 
          ? `/${fileName}` 
          : `${destinationPath}/${fileName}`;

        const actionText = folderPickerAction === 'move' ? '이동중' : '복사중';
        setProgressItems(prev => {
          const currentItem = prev.find(item => item.id === progressId);
          const currentProgress = currentItem ? currentItem.progress || 0 : 0;
          return prev.map(item => 
            item.id === progressId 
              ? { 
                  ...item, 
                  status: 'processing',
                  progress: currentProgress,
                  total: filePaths.length,
                  current: `(${currentProgress}/${filePaths.length}) ${actionText}...`,
                }
              : item
          );
        });

        if (folderPickerAction === 'move') {
          await moveFile(sourcePath, destinationFilePath);
        } else if (folderPickerAction === 'copy') {
          await copyFile(sourcePath, destinationFilePath);
        }
        
        successCount++;
        
        setProgressItems(prev => {
          const currentItem = prev.find(item => item.id === progressId);
          const currentProgress = currentItem ? (currentItem.progress || 0) + 1 : 1;
          return prev.map(item => 
            item.id === progressId 
              ? { 
                  ...item, 
                  status: 'processing',
                  progress: currentProgress,
                  total: filePaths.length,
                  current: `(${currentProgress}/${filePaths.length}) ${actionText}...`,
                }
              : item
          );
        });
      } catch (error) {
        console.error(`Failed to ${folderPickerAction} ${sourcePath}:`, error);
        const errorMsg = error.response?.data?.error || error.message;
        const fileName = sourcePath.split('/').pop();
        
        if (error.response?.status === 409 || errorMsg.includes('already exists')) {
          skippedFiles.push(fileName);
        } else {
          failCount++;
        }
      }
    }

    const actionText = folderPickerAction === 'move' ? '이동중' : '복사중';
    setProgressItems(prev => 
      prev.map(item => 
        item.id === progressId 
          ? { 
              ...item, 
              status: failCount > 0 ? 'error' : 'completed',
              progress: successCount,
              total: filePaths.length,
              current: failCount > 0 ? `(${successCount}/${filePaths.length}) ${actionText}... (${failCount}개 실패)` : `(${successCount}/${filePaths.length}) ${actionText}...`,
              error: failCount > 0 ? `${failCount}개 실패` : undefined,
            }
          : item
      )
    );

    if (successCount > 0) {
      setSelectedFiles(new Set());
      setSelectionMode(false);
      loadFiles();
    }

    setTimeout(() => {
      setProgressItems(prev => prev.filter(item => item.id !== progressId));
      clearProcessing(filePaths);
    }, 3000);

    setFolderPickerOpen(false);
    setFolderPickerAction(null);
  };

  return {
    folderPickerOpen,
    folderPickerAction,
    progressItems,
    setProgressItems,
    handleBulkMove,
    handleBulkCopy,
    handleBulkDelete,
    handleBulkDownload,
    handleFolderPickerSelect,
    setFolderPickerOpen,
    setFolderPickerAction,
  };
};

