import { useState } from 'react';
import { moveFile, copyFile, deleteFile, downloadMultipleFiles } from '../services/fileService';

export const useBulkOperations = (selectedFiles, files, loadFiles, setTreeUpdateTrigger, setDropMessage, setSelectedFiles, setSelectionMode) => {
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerAction, setFolderPickerAction] = useState(null);
  const [progressItems, setProgressItems] = useState([]);

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
    
    const confirmMessage = `선택한 ${selectedFiles.size}개의 파일/폴더를 삭제하시겠습니까?`;
    if (!window.confirm(confirmMessage)) return;

    const filePaths = Array.from(selectedFiles);
    let successCount = 0;
    let failCount = 0;
    const deletedFolders = [];

    for (const filePath of filePaths) {
      try {
        await deleteFile(filePath);
        const file = files.find(f => f.path === filePath);
        if (file && file.type === 'directory') {
          deletedFolders.push(filePath);
        }
        successCount++;
      } catch (error) {
        console.error(`Failed to delete ${filePath}:`, error);
        failCount++;
      }
    }

    if (successCount > 0) {
      deletedFolders.forEach(folderPath => {
        setTreeUpdateTrigger({
          type: 'deleted',
          folderPath,
          timestamp: Date.now(),
        });
      });

      setDropMessage({
        show: true,
        text: `${successCount}개 파일/폴더가 삭제되었습니다${failCount > 0 ? ` (${failCount}개 실패)` : ''}`,
        type: failCount > 0 ? 'warning' : 'success',
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
    } else {
      setDropMessage({
        show: true,
        text: '삭제에 실패했습니다',
        type: 'error',
      });
    }
  };

  const handleBulkDownload = async () => {
    if (selectedFiles.size === 0) return;

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

    const filePaths = Array.from(selectedFiles);
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
      let message = `${successCount}개 파일/폴더가 ${folderPickerAction === 'move' ? '이동' : '복사'}되었습니다`;
      if (skippedFiles.length > 0) {
        message += `\n건너뛴 파일: ${skippedFiles.join(', ')}`;
      }
      if (failCount > 0) {
        message += `\n실패: ${failCount}개`;
      }
      
      setDropMessage({
        show: true,
        text: message,
        type: failCount > 0 || skippedFiles.length > 0 ? 'warning' : 'success',
      });
      setSelectedFiles(new Set());
      setSelectionMode(false);
      loadFiles();
    } else {
      let message = `${folderPickerAction === 'move' ? '이동' : '복사'}에 실패했습니다`;
      if (skippedFiles.length > 0) {
        message += `\n건너뛴 파일: ${skippedFiles.join(', ')}`;
      }
      
      setDropMessage({
        show: true,
        text: message,
        type: 'error',
      });
    }

    setTimeout(() => {
      setProgressItems(prev => prev.filter(item => item.id !== progressId));
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

