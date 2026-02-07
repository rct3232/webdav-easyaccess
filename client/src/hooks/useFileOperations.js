import { useState, useCallback } from 'react';
import { downloadFile, downloadMultipleFiles, renameFile, deleteFile, moveFile, checkConflicts } from '../services/fileService';
import { getErrorMessage, determineErrorType, getErrorMessageByType, ERROR_TYPES } from '../utils/errorUtils';
import { markProcessing, clearProcessing } from '../utils/processingUtils';
import { normalizePath } from '../utils/refreshPolicy';
import { 
  applyRecentFilesAfterMove,
  applyRecentFilesAfterRename,
  applyRecentFilesAfterDelete,
} from '../utils/recentFiles';

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
 * @param {Function} [options.onConflictResolveStart] - Called when user chooses overwrite/skip (before running); e.g. clear selection mode
 * @returns {Object} File operation handlers and conflict state
 */
export const useFileOperations = ({
  onProgress,
  setProcessingMap,
  onProcessingStart,
  onProcessingEnd,
  onActionComplete,
  onClose,
  onConflictResolveStart,
}) => {
  const [conflictData, setConflictData] = useState(null);

  /**
   * Execute file operation after pre-checks
   */
  const executeFileOperation = useCallback(async (file, selectedPath, operation, operationName, actionVerb, context = {}, onConflict = 'error') => {
    if (typeof onConflictResolveStart === 'function') {
      onConflictResolveStart();
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
      }, onConflict);
      
      // If result is skipped (single file skip)
      if (result?.skipped) {
        if (onProgress) {
          onProgress({
            ...progressItem,
            status: 'warning',
            progress: 1,
            total: 1,
            current: '건너뜀',
            error: '대상 파일이 이미 존재하여 건너뛰었습니다.',
            keepOnError: true,
          });
        }
        return;
      }
      
      // 이동 성공 시 최근항목 경로 업데이트
      if (operation === moveFile) {
        try {
          const skippedPaths = Array.isArray(result?.skippedPaths) ? result.skippedPaths : [];
          const hasSkipped = skippedPaths.length > 0;
          
          if (!hasSkipped) {
            await applyRecentFilesAfterMove(filePath, destPath, file);
          }
        } catch (err) {
          // 최근항목 업데이트 실패는 무시 (치명적이지 않음)
          console.error('Failed to update recent files after move:', err);
        }
      }
      
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
      const errorType = determineErrorType(error);
      const errorMsg = errorType === ERROR_TYPES.DUPLICATE_FILE 
        ? getErrorMessageByType(ERROR_TYPES.DUPLICATE_FILE)
        : getErrorMessage(error, `${operationName}에 실패했습니다`);
      
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'error',
          error: errorMsg,
          keepOnError: true,
        });
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
  }, [onProgress, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose, onConflictResolveStart]);

  /**
   * Resolve conflicts and resume operation
   * @param {string} resolution - 'overwrite' | 'skip'
   */
  const resolveConflict = useCallback(async (resolution) => {
    if (!conflictData) return;

    const { file, selectedPath, operation, operationName, actionVerb, context } = conflictData;
    setConflictData(null);
    await executeFileOperation(file, selectedPath, operation, operationName, actionVerb, context, resolution);
    if (onClose) {
      onClose();
    }
  }, [conflictData, executeFileOperation, onClose]);

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
          keepOnError: true,
        });
      } else {
        alert(errorMsg);
      }
    }
  }, [onProgress, onClose]);

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
      if (onProgress) {
        const progressId = `${operationName}_invalid_${Date.now()}`;
        onProgress({
          id: progressId,
          type: operation === moveFile ? 'move' : 'copy',
          status: 'error',
          error: msg,
          keepOnError: true,
          name: `${file?.basename || ''} ${operationName}`.trim(),
        });
      } else {
        alert(msg);
      }
      return;
    }

    const destPath = selectedPath.endsWith('/')
      ? selectedPath + file.basename
      : selectedPath + '/' + file.basename;

    const operationType = operation === moveFile ? 'move' : 'copy';
    const progressId = `${operationType}_check_${Date.now()}`;

    if (setProcessingMap) {
      markProcessing(setProcessingMap, file.path, operationType);
    }
    if (onProgress) {
      onProgress({
        id: progressId,
        type: operationType,
        status: 'preparing',
        progress: 0,
        total: 1,
        current: '충돌 확인 중...',
        name: `${file.basename || file.name || ''} ${operationName}`.trim(),
      });
    }

    try {
      const conflicts = await checkConflicts([{
        sourcePath: file.path,
        destinationPath: destPath,
        type: operationType,
      }]);

      if (conflicts && conflicts.length > 0) {
        if (onProgress) {
          onProgress({ id: progressId, remove: true });
        }
        if (setProcessingMap) {
          clearProcessing(setProcessingMap, file.path);
        }
        setConflictData({ file, selectedPath, operation, operationName, actionVerb, context, conflicts });
        return;
      }

      if (onProgress) {
        onProgress({ id: progressId, remove: true });
      }
      await executeFileOperation(file, selectedPath, operation, operationName, actionVerb, context);
    } catch (error) {
      console.error('Conflict check failed:', error);
      if (onProgress) {
        onProgress({ id: progressId, remove: true });
      }
      if (setProcessingMap) {
        clearProcessing(setProcessingMap, file.path);
      }
      await executeFileOperation(file, selectedPath, operation, operationName, actionVerb, context);
    }
  }, [onProgress, executeFileOperation, setProcessingMap]);

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
      if (onProgress) {
        const progressId = `rename_invalid_${Date.now()}`;
        onProgress({
          id: progressId,
          type: 'rename',
          status: 'error',
          error: msg,
          keepOnError: true,
          name: `${file?.basename || '파일'} 이름 변경`,
        });
      } else {
        alert(msg);
      }
      return;
    }

    const filePath = file.path;
    const startedPath = context?.startedPath;
    const progressId = `rename_${Date.now()}`;
    const progressItem = {
      id: progressId,
      type: 'rename',
      status: 'preparing',
      progress: 0,
      total: 1,
      current: '',
      name: `${file.basename} 이름 변경`,
    };
    
    // Mark processing
    if (setProcessingMap) {
      markProcessing(setProcessingMap, filePath, 'rename');
    } else if (onProcessingStart) {
      onProcessingStart([filePath], 'rename');
    }

    try {
      if (onProgress) {
        onProgress(progressItem);
        onProgress({
          ...progressItem,
          status: 'processing',
          current: '(0/1) 이름 변경중...',
        });
      }

      await renameFile(filePath, newName);
      
      // 이름변경 성공 시 최근항목 경로 업데이트
      try {
        // 새 경로 계산
        const parentPath = normalizePath(filePath.substring(0, filePath.lastIndexOf('/')) || '/');
        const newPath = parentPath === '/' ? `/${newName}` : `${parentPath}/${newName}`;
        
        await applyRecentFilesAfterRename(filePath, newPath, {
          ...file,
          name: newName,
          basename: newName,
        });
      } catch (err) {
        // 최근항목 업데이트 실패는 무시 (치명적이지 않음)
        console.error('Failed to update recent files after rename:', err);
      }
      
      if (onActionComplete) {
        onActionComplete({
          opType: 'rename',
          startedPath,
        });
      }
      
      if (onClose) {
        onClose();
      }

      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'completed',
          progress: 1,
          total: 1,
          current: '완료',
        });
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 3000);
      }
    } catch (error) {
      const errorMsg = getErrorMessage(error, '이름 변경에 실패했습니다');
      if (onProgress) {
        onProgress({
          ...progressItem,
          status: 'error',
          error: errorMsg,
          keepOnError: true,
        });
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
  }, [onProgress, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose]);

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
      
      // 삭제 성공 시 최근항목에서 제거
      if (!hasSkipped) {
        try {
          await applyRecentFilesAfterDelete(filePath, isDirectory);
        } catch (err) {
          // 최근항목 제거 실패는 무시 (치명적이지 않음)
          console.error('Failed to remove from recent files:', err);
        }
      }
      
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
      if (!onProgress) {
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
  }, [onProgress, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose]);

  return {
    handleFileDownload,
    handleFileOperation,
    handleFileRename,
    handleFileDelete,
    conflictData,
    resolveConflict,
    setConflictData,
  };
};
