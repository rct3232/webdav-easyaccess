import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile, downloadMultipleFiles, renameFile } from '../services/fileService';
import { getErrorMessage } from '../utils/errorUtils';
import { markProcessing, clearProcessing } from '../utils/processingUtils';
import { normalizePath } from '../utils/pathUtils';
import { applyRecentFilesAfterRename } from '../utils/recentFiles';

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
  const { t } = useTranslation();

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
            error: t('fileManager.bulkExcludedByPermission', { count: skippedCount || skippedPaths.length }),
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
        const fileName = file.basename ?? file.name ?? file.path?.split('/').pop();
        await downloadFile(file.path, { fileName });
      }
      
      if (onClose) {
        onClose();
      }
    } catch (error) {
      const { key, raw } = getErrorMessage(error, 'errors.downloadFailed');
      const errorMsg = raw != null ? raw : t(key);
      if (onProgress) {
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
  }, [onProgress, onClose, t]);

  /**
   * Handle file rename
   * @param {Object} file - File object
   * @param {string} newName - New file name
   * @param {Object} [context] - Operation context
   * @param {string} [context.startedPath] - Path at operation start
   */
  const handleFileRename = useCallback(async (file, newName, context = {}) => {
    if (!file || !newName || !newName.trim()) {
      const msg = t('validation.fileNameRequired');
      if (onProgress) {
        const progressId = `rename_invalid_${Date.now()}`;
        onProgress({
          id: progressId,
          type: 'rename',
          status: 'error',
          error: msg,
          keepOnError: true,
          name: `${file?.basename || t('actions.file')} ${t('dialogs.renameTitle')}`,
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
      name: `${file.basename} ${t('dialogs.renameTitle')}`,
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
          current: t('fileManager.statusRenaming'),
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
          current: t('fileManager.statusCompleted'),
        });
        setTimeout(() => {
          onProgress({ id: progressId, remove: true });
        }, 3000);
      }
    } catch (error) {
      const { key, raw } = getErrorMessage(error, 'errors.renameFailed');
      const errorMsg = raw != null ? raw : t(key);
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
      if (onActionComplete) {
        onActionComplete({ opType: 'rename', startedPath });
      }
    } finally {
      // Clear processing
      if (setProcessingMap) {
        clearProcessing(setProcessingMap, filePath);
      } else if (onProcessingEnd) {
        onProcessingEnd([filePath]);
      }
    }
  }, [onProgress, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose, t]);

  return {
    handleFileDownload,
    handleFileRename,
  };
};
