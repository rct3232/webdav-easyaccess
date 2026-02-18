import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * Custom hook for managing file operation progress
 * 
 * Provides centralized progress state management for file operations
 * such as move, copy, delete, download, and upload.
 * 
 * @returns {Object} Progress state and control functions
 * @property {Array} progressItems - Array of current progress items
 * @property {Function} updateProgress - Function to update/add/remove progress items
 * @property {Function} clearAllProgress - Function to clear all progress items
 * 
 * @example
 * const { progressItems, updateProgress } = useFileOperationProgress();
 * 
 * // Add or update a progress item
 * updateProgress({
 *   id: 'move_123',
 *   type: 'move',
 *   status: 'processing',
 *   progress: 5,
 *   total: 10,
 *   current: '(5/10) 이동중...',
 *   name: '10개 항목 이동'
 * });
 * 
 * // Remove a progress item
 * updateProgress({ id: 'move_123', remove: true });
 */
export const useFileOperationProgress = () => {
  const { t } = useTranslation();
  const [progressItems, setProgressItems] = useState([]);
  /** progressId별 최신 fileItems (배치/이중 호출 시 prev 대신 사용해 델타 누적) */
  const fileItemsByProgressIdRef = useRef(new Map());

  /**
   * Update, add, or remove a progress item
   * 
   * @param {Object} progressItem - Progress item to update
   * @param {string} progressItem.id - Unique identifier for the progress item
   * @param {boolean} [progressItem.remove] - If true, removes the item instead of updating
   * @param {string} [progressItem.type] - Type of operation ('move', 'copy', 'delete', 'download', 'upload')
   * @param {string} [progressItem.status] - Current status ('preparing', 'processing', 'downloading', 'uploading', 'completed', 'warning', 'error')
   * @param {number} [progressItem.progress] - Current progress count
   * @param {number} [progressItem.total] - Total items count
   * @param {string} [progressItem.current] - Current item description
   * @param {string} [progressItem.name] - Operation name/description
   * @param {string} [progressItem.error] - Message for error/warning states
   * @param {Array<Object>} [progressItem.failedItems] - Array of failed items with fileName and error
   * @param {boolean} [progressItem.keepOnError] - If true, prevents automatic removal on error
   * @param {Array<string>} [progressItem.skippedPaths] - Paths excluded from selective operations
   * @param {number} [progressItem.skippedCount] - Total excluded count (may exceed skippedPaths length)
   * @param {boolean} [progressItem.skippedTruncated] - Whether skipped list was truncated
   * @param {Object} [progressItem.retryData] - Data needed for retry operation (filePaths, destinationPath, etc.)
   */
  const updateProgress = useCallback((progressItem) => {
    if (progressItem.remove) {
      fileItemsByProgressIdRef.current.delete(progressItem.id);
      setProgressItems(prev => prev.filter(item => item.id !== progressItem.id));
    } else {
      setProgressItems(prev => {
        const existing = prev.find(item => item.id === progressItem.id);
        if (existing) {
          // 기존 항목과 새 항목 병합
          const merged = { ...existing, ...progressItem };

          // Final status precedence: error > warning > completed.
          // Also prevent regressing from warning/error back to completed.
          const existingStatus = existing.status;
          const nextStatus = progressItem.status ?? existingStatus;
          if ((existingStatus === 'error' && nextStatus !== 'error') || (existingStatus === 'warning' && nextStatus === 'completed')) {
            merged.status = existingStatus;
          } else {
            merged.status = nextStatus;
          }
          
          // 단일 파일 상태만 갱신 (progress 콜백용, 성능 유지)
          if (progressItem.updatedFileItem && existing.fileItems) {
            const ufi = progressItem.updatedFileItem;
            const fileName = ufi.fileName;
            const fileStatus = ufi.status;
            const base = fileItemsByProgressIdRef.current.get(progressItem.id) ?? existing.fileItems;
            const idx = base.findIndex((it) => it.fileName === fileName);
            if (idx !== -1) {
              const next = [...base];
              next[idx] = { ...next[idx], ...ufi, status: fileStatus };
              fileItemsByProgressIdRef.current.set(progressItem.id, next);
              merged.fileItems = next;
            } else {
              merged.fileItems = base;
            }
            delete merged.updatedFileItem;
          }
          // fileItems 배열이 있는 경우 병합 (updatedFileItem으로 이미 반영한 경우 스킵)
          if (progressItem.fileItems && existing.fileItems && !progressItem.updatedFileItem) {
            const existingFileItemsMap = new Map();
            existing.fileItems.forEach(item => {
              existingFileItemsMap.set(item.fileName, item);
            });
            
            // 새 fileItems를 기존 항목과 병합
            const mergedFileItems = progressItem.fileItems.map(newItem => {
              const existingItem = existingFileItemsMap.get(newItem.fileName);
              
              // 취소 상태는 항상 보존 (우선순위 최우선)
              if (existingItem && existingItem.status === 'cancelled') {
                return existingItem; // 취소 상태 보존
              }
              
              // 기존 항목과 새 항목 병합 (기존 항목의 속성 유지)
              if (existingItem) {
                return {
                  ...existingItem,
                  ...newItem,
                  // 취소 상태가 이미 있는 경우 유지
                  status: existingItem.status === 'cancelled' ? 'cancelled' : newItem.status,
                };
              }
              
              return newItem;
            });
            
            // 기존에만 있고 새 항목에 없는 fileItems 추가 (취소된 파일 등) - O(1) 조회를 위해 Set 사용
            const newFileNames = new Set(progressItem.fileItems.map(item => item.fileName));
            existing.fileItems.forEach(existingItem => {
              if (!newFileNames.has(existingItem.fileName)) {
                // 취소된 파일은 항상 유지
                if (existingItem.status === 'cancelled') {
                  mergedFileItems.push(existingItem);
                }
              }
            });
            
            merged.fileItems = mergedFileItems;
            fileItemsByProgressIdRef.current.set(progressItem.id, mergedFileItems);
          } else if (progressItem.fileItems) {
            // 기존에 fileItems가 없고 새로 추가하는 경우
            merged.fileItems = progressItem.fileItems;
            fileItemsByProgressIdRef.current.set(progressItem.id, progressItem.fileItems);
          }
          // 기존 fileItems가 있고 새로 전달하지 않은 경우는 기존 것 유지

          // skipped paths merge (union) so incremental updates don't lose earlier data
          if (Array.isArray(existing.skippedPaths) || Array.isArray(progressItem.skippedPaths)) {
            const a = Array.isArray(existing.skippedPaths) ? existing.skippedPaths : [];
            const b = Array.isArray(progressItem.skippedPaths) ? progressItem.skippedPaths : [];
            merged.skippedPaths = Array.from(new Set([...a, ...b]));
          }
          if (typeof existing.skippedCount === 'number' || typeof progressItem.skippedCount === 'number') {
            const a = typeof existing.skippedCount === 'number' ? existing.skippedCount : 0;
            const b = typeof progressItem.skippedCount === 'number' ? progressItem.skippedCount : 0;
            merged.skippedCount = Math.max(a, b);
          }
          if (typeof existing.skippedTruncated === 'boolean' || typeof progressItem.skippedTruncated === 'boolean') {
            merged.skippedTruncated = Boolean(existing.skippedTruncated || progressItem.skippedTruncated);
          }
          if (Array.isArray(existing.skippedPathsByConflict) || Array.isArray(progressItem.skippedPathsByConflict)) {
            const a = Array.isArray(existing.skippedPathsByConflict) ? existing.skippedPathsByConflict : [];
            const b = Array.isArray(progressItem.skippedPathsByConflict) ? progressItem.skippedPathsByConflict : [];
            merged.skippedPathsByConflict = Array.from(new Set([...a, ...b]));
          }
          if (Array.isArray(existing.skippedPathsByPermission) || Array.isArray(progressItem.skippedPathsByPermission)) {
            const a = Array.isArray(existing.skippedPathsByPermission) ? existing.skippedPathsByPermission : [];
            const b = Array.isArray(progressItem.skippedPathsByPermission) ? progressItem.skippedPathsByPermission : [];
            merged.skippedPathsByPermission = Array.from(new Set([...a, ...b]));
          }
          if (typeof existing.skippedCountByConflict === 'number' || typeof progressItem.skippedCountByConflict === 'number') {
            const a = typeof existing.skippedCountByConflict === 'number' ? existing.skippedCountByConflict : 0;
            const b = typeof progressItem.skippedCountByConflict === 'number' ? progressItem.skippedCountByConflict : 0;
            merged.skippedCountByConflict = Math.max(a, b);
          }
          if (typeof existing.skippedCountByPermission === 'number' || typeof progressItem.skippedCountByPermission === 'number') {
            const a = typeof existing.skippedCountByPermission === 'number' ? existing.skippedCountByPermission : 0;
            const b = typeof progressItem.skippedCountByPermission === 'number' ? progressItem.skippedCountByPermission : 0;
            merged.skippedCountByPermission = Math.max(a, b);
          }
          
          return prev.map(item => item.id === progressItem.id ? merged : item);
        } else {
          if (progressItem.fileItems) {
            fileItemsByProgressIdRef.current.set(progressItem.id, progressItem.fileItems);
          }
          return [...prev, progressItem];
        }
      });
    }
  }, []);

  /**
   * Clear all progress items
   */
  const clearAllProgress = useCallback(() => {
    setProgressItems([]);
  }, []);

  /**
   * Create a standard progress item for file operations
   * @param {Object} options - Progress item options
   * @param {string} options.type - Operation type
   * @param {string} options.name - Operation name
   * @param {number} options.total - Total items
   * @param {string} [options.id] - Custom ID (auto-generated if not provided)
   * @returns {Object} Progress item
   */
  const createProgressItem = useCallback((options) => {
    const {
      type,
      name,
      total = 1,
      id = null,
    } = options;

    const progressId = id || `${type}_${Date.now()}`;
    
    return {
      id: progressId,
      type,
      status: 'preparing',
      progress: 0,
      total,
      current: '',
      name,
    };
  }, []);

  /**
   * Update progress with error handling
   * @param {string} progressId - Progress item ID
   * @param {Object} progressData - Progress data
   * @param {Error} [error] - Optional error object
   * @param {string} [defaultErrorMsg] - Default error message
   */
  const updateProgressWithError = useCallback((progressId, progressData, error = null, defaultKey = 'errors.operationFailed') => {
    if (error) {
      const { getErrorMessage } = require('../utils/errorUtils');
      const { key, raw } = getErrorMessage(error, defaultKey);
      const errorMsg = raw != null ? raw : t(key);
      updateProgress({
        id: progressId,
        ...progressData,
        status: 'error',
        error: errorMsg,
        keepOnError: true,
      });
    } else {
      updateProgress({
        id: progressId,
        ...progressData,
      });
    }
  }, [updateProgress, t]);

  /**
   * Create and initialize a progress item
   * @param {Object} options - Progress item options
   * @returns {string} Progress item ID
   */
  const initProgress = useCallback((options) => {
    const item = createProgressItem(options);
    updateProgress(item);
    return item.id;
  }, [createProgressItem, updateProgress]);

  /**
   * Mark progress as completed and schedule removal
   * @param {string} progressId - Progress item ID
   * @param {number} [delay] - Delay before removal in ms (default: 3000)
   */
  const completeProgress = useCallback((progressId, delay = 3000) => {
    updateProgress({
      id: progressId,
      status: 'completed',
      progress: 1,
      total: 1,
      current: t('fileManager.statusCompleted'),
    });
    
    if (delay > 0) {
      setTimeout(() => {
        updateProgress({ id: progressId, remove: true });
      }, delay);
    }
  }, [updateProgress, t]);

  return {
    progressItems,
    updateProgress,
    clearAllProgress,
    createProgressItem,
    updateProgressWithError,
    initProgress,
    completeProgress,
  };
};
