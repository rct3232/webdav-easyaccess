import { useState, useCallback } from 'react';

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
  const [progressItems, setProgressItems] = useState([]);

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
          
          // fileItems 배열이 있는 경우 병합
          if (progressItem.fileItems && existing.fileItems) {
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
            
            // 기존에만 있고 새 항목에 없는 fileItems 추가 (취소된 파일 등)
            existing.fileItems.forEach(existingItem => {
              if (!progressItem.fileItems.find(item => item.fileName === existingItem.fileName)) {
                // 취소된 파일은 항상 유지
                if (existingItem.status === 'cancelled') {
                  mergedFileItems.push(existingItem);
                }
              }
            });
            
            merged.fileItems = mergedFileItems;
          } else if (progressItem.fileItems) {
            // 기존에 fileItems가 없고 새로 추가하는 경우
            merged.fileItems = progressItem.fileItems;
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
          
          return prev.map(item => item.id === progressItem.id ? merged : item);
        } else {
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

  return {
    progressItems,
    updateProgress,
    clearAllProgress,
  };
};
