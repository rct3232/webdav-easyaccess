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
   * @param {string} [progressItem.status] - Current status ('preparing', 'processing', 'completed', 'error')
   * @param {number} [progressItem.progress] - Current progress count
   * @param {number} [progressItem.total] - Total items count
   * @param {string} [progressItem.current] - Current item description
   * @param {string} [progressItem.name] - Operation name/description
   * @param {string} [progressItem.error] - Error message (if status is 'error')
   */
  const updateProgress = useCallback((progressItem) => {
    if (progressItem.remove) {
      setProgressItems(prev => prev.filter(item => item.id !== progressItem.id));
    } else {
      setProgressItems(prev => {
        const existing = prev.find(item => item.id === progressItem.id);
        if (existing) {
          return prev.map(item => item.id === progressItem.id ? progressItem : item);
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
