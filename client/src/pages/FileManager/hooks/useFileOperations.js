import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadFile, downloadMultipleFiles, renameFile } from '../../../services/fileService';
import { getErrorMessage } from '../../../utils/errorUtils';
import { markProcessing, clearProcessing } from '../../../utils/processingUtils';
import { notifyRecentFilesChange } from '../../../services/recentFilesNotifier';

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
}) => {
  const { t } = useTranslation();

  /**
   * Handle file download
   * @param {Object} file - File object with nodeId
   */
  const handleFileDownload = useCallback(
    async (file) => {
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

          const result = await downloadMultipleFiles([file.nodeId], (progress) => {
            if (onProgress) {
              onProgress({ ...progress, id: progressId });
            }
          });

          const skippedCount = result?.skippedCount || 0;
          const skippedNodeIds = result?.skippedInfo?.nodeIds || [];
          const skippedTruncated = Boolean(result?.skippedInfo?.truncated);
          const hasSkipped = skippedCount > 0 || skippedNodeIds.length > 0;
          if (hasSkipped && onProgress) {
            onProgress({
              id: progressId,
              type: 'download',
              status: 'warning',
              error: t('fileManager.bulkExcludedByPermission', {
                count: skippedCount || skippedNodeIds.length,
              }),
              keepOnError: true,
              skippedNodeIds,
              skippedCount: skippedCount || skippedNodeIds.length,
              skippedTruncated,
            });
          }

          if (onProgress && !hasSkipped) {
            setTimeout(() => {
              onProgress({ id: progressId, remove: true });
            }, 3000);
          }
        } else {
          const fileName = file.basename ?? file.name ?? '';
          await downloadFile(file.nodeId, { fileName });
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
    },
    [onProgress, onClose, t]
  );

  /**
   * Handle file rename
   * @param {Object} file - File object with nodeId
   * @param {string} newName - New file name
   * @param {Object} [context] - Operation context
   * @param {number} [context.startedNodeId] - nodeId at operation start
   */
  const handleFileRename = useCallback(
    async (file, newName, context = {}) => {
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

      const nodeId = file.nodeId;
      const startedNodeId = context?.startedNodeId;
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
        markProcessing(setProcessingMap, nodeId, 'rename');
      } else if (onProcessingStart) {
        onProcessingStart([nodeId], 'rename');
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

        await renameFile(nodeId, newName);

        // 이름변경 성공 시 최근항목 새로고침 (nodeId는 rename 이후에도 안정적)
        try {
          notifyRecentFilesChange();
        } catch (err) {
          // 최근항목 새로고침 실패는 무시 (치명적이지 않음)
          console.error('Failed to refresh recent files after rename:', err);
        }

        if (onActionComplete) {
          onActionComplete({
            opType: 'rename',
            startedNodeId,
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
          onActionComplete({ opType: 'rename', startedNodeId });
        }
      } finally {
        // Clear processing
        if (setProcessingMap) {
          clearProcessing(setProcessingMap, nodeId);
        } else if (onProcessingEnd) {
          onProcessingEnd([nodeId]);
        }
      }
    },
    [onProgress, setProcessingMap, onProcessingStart, onProcessingEnd, onActionComplete, onClose, t]
  );

  return {
    handleFileDownload,
    handleFileRename,
  };
};
