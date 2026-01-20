import { useCallback } from 'react';
import { downloadFile, downloadMultipleFiles, renameFile, deleteFile, moveFile } from '../services/fileService';
import { getErrorMessage, showErrorMessage, showSuccessMessage, showMessage } from '../utils/errorUtils';
import { markProcessing, clearProcessing } from '../utils/processingUtils';
import { normalizePath } from '../utils/refreshPolicy';

/**
 * Common file operations hook
 * Provides unified file operation handlers for FileContextMenu and FileManager
 * 
 * @param {Object} options - Hook options
 * @param {Function} options.onProgress - Progress update callback
 * @param {Function} options.onMessage - Message callback (for FileContextMenu)
 * @param {Function} options.setDropMessage - Drop message setter (for FileManager)
 * @param {Function} options.setProcessingMap - Processing map setter (for FileManager)
 * @param {Function} options.onProcessingStart - Processing start callback (for FileContextMenu)
 * @param {Function} options.onProcessingEnd - Processing end callback (for FileContextMenu)
 * @param {Function} options.onActionComplete - Action complete callback
 * @param {Function} options.onClose - Close callback (for dialogs)
 * @returns {Object} File operation handlers
 */
export const useFileOperations = ({
  onProgress,
  onMessage,
  setDropMessage,
  setProcessingMap,
  onProcessingStart,
  onProcessingEnd,
  onActionComplete,
  onClose,
}) => {
  /**
   * Handle file download
   * @param {Object} file - File object
   */
  const handleFileDownload = useCallback(async (file) => {
    try {
      if (file.type === 'directory') {
        const progressId = `download_${Date.now()}`;
        const progressItem = {
          id: progressId,
          type: 'download',
          status: 'preparing',
          progress: 0,
          total: 1,
          current: '',
          zipName: '',
        };
        
        if (onProgress) {
          onProgress(progressItem);
        }
        
        const result = await downloadMultipleFiles([file.path], (progress) => {
          if (onProgress) {
            onProgress({ ...progress, id: progressId });
          }
        });

        const skippedCount = result?.skippedCount || 0;
        const skippedPaths = result?.skippedInfo?.paths || [];
        const skippedTruncated = Boolean(result?.skippedInfo?.truncated);
        const hasSkipped = skippedCount > 0 || skippedPaths.length > 0;
        if (hasSkipped && onProgress) {
          onProgress({
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
        
        if (onProgress && !hasSkipped) {
          setTimeout(() => {
            onProgress({ id: progressId, remove: true });
          }, 3000);
        }
      } else {
        await downloadFile(file.path);
      }
      
      if (onClose) {
        onClose();
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error, '다운로드에 실패했습니다');
      
      if (onProgress) {
        // Progress에 에러 표시
        const progressId = `download_${Date.now()}`;
        onProgress({
          id: progressId,
          type: 'download',
          status: 'error',
          error: errorMsg,
        });
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 5000);
      } else if (onMessage) {
        showMessage(onMessage, errorMsg, 'error');
      } else if (setDropMessage) {
        showErrorMessage(setDropMessage, error, '다운로드에 실패했습니다');
      } else {
        alert(errorMsg);
      }
    }
  }, [onProgress, onMessage, setDropMessage, onClose]);

  /**
   * Handle file operation (move/copy)
   * @param {Object} file - File object
   * @param {string} selectedPath - Destination path
   * @param {Function} operation - Operation function (moveFile or copyFile)
   * @param {string} operationName - Operation name for display ('이동' or '복사')
   * @param {string} actionVerb - Action verb for progress ('이동' or '복사')
   * @param {Object} [context] - Operation context
   * @param {string} [context.startedPath] - Path at operation start
   */
  const handleFileOperation = useCallback(async (file, selectedPath, operation, operationName, actionVerb, context = {}) => {
    if (!file || !selectedPath || !selectedPath.trim()) {
      const msg = '대상 경로를 선택하세요';
      if (setDropMessage) {
        setDropMessage({ show: true, text: msg, type: 'error' });
        setTimeout(() => setDropMessage({ show: false, text: '', type: 'success' }), 5000);
      } else if (onMessage) {
        showMessage(onMessage, msg, 'error');
      } else {
        alert(msg);
      }
      return;
    }

    const destPath = selectedPath.endsWith('/')
      ? selectedPath + file.basename
      : selectedPath + '/' + file.basename;
    
    const filePath = file.path;
    const progressId = `${operationName}_${Date.now()}`;
    const operationType = operation === moveFile ? 'move' : 'copy';
    const startedPath = context?.startedPath;
    const targetFolderPath = normalizePath(selectedPath);

    // Mark processing
    if (setProcessingMap) {
      markProcessing(setProcessingMap, filePath, operationType);
    } else if (onProcessingStart) {
      onProcessingStart([filePath], operationType);
    }

    const progressItem = {
      id: progressId,
      type: operationType,
      status: 'preparing',
      progress: 0,
      total: 1,
      current: '',
      name: `${file.basename} ${operationName}`,
    };
    
    if (onProgress) {
      onProgress(progressItem);
    }

    try {
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'processing',
          progress: 0,
          total: 1,
          current: `(0/1) ${actionVerb}중...`,
        });
      }
      
      const result = await operation(filePath, destPath, (progress) => {
        if (onProgress) {
          onProgress({
            ...progressItem,
            status: progress.stage === 'completed' ? 'completed' : 'processing',
            progress: progress.stage === 'completed' ? 1 : 0,
            total: 1,
            current: progress.stage === 'completed' ? `(1/1) ${actionVerb}중...` : `(0/1) ${actionVerb}중...`,
          });
        }
      });
      
      if (onActionComplete) {
        onActionComplete({
          opType: operationType,
          startedPath,
          targetPath: targetFolderPath,
        });
      }
      
      if (onClose) {
        onClose();
      }
      
      if (onProgress) {
        const skippedPaths = Array.isArray(result?.skippedPaths) ? result.skippedPaths : [];
        const hasSkipped = skippedPaths.length > 0;

        onProgress({
          ...progressItem,
          status: hasSkipped ? 'warning' : 'completed',
          progress: 1,
          total: 1,
          current: hasSkipped ? '일부 제외됨' : '완료',
          error: hasSkipped ? `권한으로 제외된 항목: ${skippedPaths.length}개` : undefined,
          keepOnError: hasSkipped || undefined,
          skippedPaths: hasSkipped ? skippedPaths : undefined,
          skippedCount: hasSkipped ? skippedPaths.length : undefined,
          skippedTruncated: undefined,
        });
        
        if (!hasSkipped) {
          setTimeout(() => {
            onProgress({ id: progressId, remove: true });
          }, 3000);
        }
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error, `${operationName}에 실패했습니다`);
      const isDuplicate = error.response?.status === 409 || errorMsg.includes('already exists');
      
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'error',
          error: errorMsg,
        });
        
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 5000);
      } else {
        const displayMsg = isDuplicate ? '대상 디렉토리에 같은 이름의 파일이 이미 존재합니다' : errorMsg;
        if (onMessage) {
          showMessage(onMessage, displayMsg, 'error');
        } else if (setDropMessage) {
          showErrorMessage(setDropMessage, error, displayMsg);
        } else {
          alert(displayMsg);
        }
      }
    } finally {
      // Clear processing
      if (setProcessingMap) {
        clearProcessing(setProcessingMap, filePath);
      } else if (onProcessingEnd) {
        onProcessingEnd([filePath]);
      }
    }
  }, [onProgress, onMessage, setDropMessage, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose]);

  /**
   * Handle file rename
   * @param {Object} file - File object
   * @param {string} newName - New file name
   * @param {Object} [context] - Operation context
   * @param {string} [context.startedPath] - Path at operation start
   */
  const handleFileRename = useCallback(async (file, newName, context = {}) => {
    if (!file || !newName || !newName.trim()) {
      const msg = '이름을 입력하세요';
      if (setDropMessage) {
        setDropMessage({ show: true, text: msg, type: 'error' });
        setTimeout(() => setDropMessage({ show: false, text: '', type: 'success' }), 5000);
      } else if (onMessage) {
        showMessage(onMessage, msg, 'error');
      } else {
        alert(msg);
      }
      return;
    }

    const filePath = file.path;
    const startedPath = context?.startedPath;
    
    // Mark processing
    if (setProcessingMap) {
      markProcessing(setProcessingMap, filePath, 'rename');
    } else if (onProcessingStart) {
      onProcessingStart([filePath], 'rename');
    }

    try {
      await renameFile(filePath, newName);
      
      if (onActionComplete) {
        onActionComplete({
          opType: 'rename',
          startedPath,
        });
      }
      
      if (onClose) {
        onClose();
      }
      
      const successMsg = `"${file.basename}"을(를) "${newName}"(으)로 이름 변경했습니다`;
      if (onMessage) {
        showMessage(onMessage, successMsg, 'success');
      } else if (setDropMessage) {
        showSuccessMessage(setDropMessage, successMsg);
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error, '이름 변경에 실패했습니다');
      if (onMessage) {
        showMessage(onMessage, errorMsg, 'error');
      } else if (setDropMessage) {
        showErrorMessage(setDropMessage, error, '이름 변경에 실패했습니다');
      } else {
        alert(errorMsg);
      }
    } finally {
      // Clear processing
      if (setProcessingMap) {
        clearProcessing(setProcessingMap, filePath);
      } else if (onProcessingEnd) {
        onProcessingEnd([filePath]);
      }
    }
  }, [onMessage, setDropMessage, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose]);

  /**
   * Handle file delete
   * @param {Object} file - File object
   * @param {Object} [context] - Operation context
   * @param {string} [context.startedPath] - Path at operation start
   */
  const handleFileDelete = useCallback(async (file, context = {}) => {
    if (!file) return;

    const filePath = file.path;
    const isDirectory = file.type === 'directory';
    const startedPath = context?.startedPath;
    const progressId = `delete_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: 'delete',
      status: 'preparing',
      progress: 0,
      total: 1,
      current: '',
      name: `${file.basename} 삭제`,
    };
    
    // Mark processing
    if (setProcessingMap) {
      markProcessing(setProcessingMap, filePath, 'delete');
    } else if (onProcessingStart) {
      onProcessingStart([filePath], 'delete');
    }

    try {
      if (onProgress) {
        onProgress(progressItem);
        onProgress({
          ...progressItem,
          status: 'processing',
          progress: 0,
          total: 1,
          current: '(0/1) 삭제중...',
        });
      }

      const result = await deleteFile(filePath);
      const skippedPaths = Array.isArray(result?.skippedPaths) ? result.skippedPaths : [];
      const hasSkipped = skippedPaths.length > 0;
      
      if (onActionComplete) {
        onActionComplete({
          opType: 'delete',
          startedPath,
          deletedFolderPath: isDirectory ? filePath : null,
        });
      }
      
      if (onClose) {
        onClose();
      }
      
      const successMsg = `"${file.basename}"을(를) 삭제했습니다`;
      if (onMessage) {
        showMessage(onMessage, successMsg, 'success');
      } else if (setDropMessage) {
        showSuccessMessage(setDropMessage, successMsg);
      }

      if (onProgress) {
        onProgress({
          ...progressItem,
          status: hasSkipped ? 'warning' : 'completed',
          progress: 1,
          total: 1,
          current: hasSkipped ? '(1/1) 삭제중... (일부 제외됨)' : '완료',
          error: hasSkipped ? `권한으로 제외된 항목: ${skippedPaths.length}개` : undefined,
          keepOnError: hasSkipped || undefined,
          skippedPaths: hasSkipped ? skippedPaths : undefined,
          skippedCount: hasSkipped ? skippedPaths.length : undefined,
        });

        if (!hasSkipped) {
          setTimeout(() => {
            onProgress({ id: progressId, remove: true });
          }, 3000);
        }
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error, '삭제에 실패했습니다');
      if (onMessage) {
        showMessage(onMessage, errorMsg, 'error');
      } else if (setDropMessage) {
        showErrorMessage(setDropMessage, error, '삭제에 실패했습니다');
      } else {
        alert(errorMsg);
      }

      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'error',
          error: errorMsg,
          keepOnError: true,
        });
      }
    } finally {
      // Clear processing
      if (setProcessingMap) {
        clearProcessing(setProcessingMap, filePath);
      } else if (onProcessingEnd) {
        onProcessingEnd([filePath]);
      }
    }
  }, [onProgress, onMessage, setDropMessage, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose]);

  return {
    handleFileDownload,
    handleFileOperation,
    handleFileRename,
    handleFileDelete,
  };
};
