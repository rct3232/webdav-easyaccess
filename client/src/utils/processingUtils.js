/**
 * ProcessingMap management utilities
 * Provides common functions for managing processing state
 */

/**
 * Create processing updater functions
 * @param {Function} setProcessingMap - State setter for processing map
 * @returns {Object} Object with markProcessing and clearProcessing functions
 */
export const createProcessingUpdater = (setProcessingMap) => {
  /**
   * Mark files as processing
   * @param {string|string[]} paths - File path(s) to mark
   * @param {string} type - Processing type ('move', 'copy', 'delete', 'rename')
   */
  const markProcessing = (paths, type) => {
    const pathsArray = Array.isArray(paths) ? paths : [paths];
    setProcessingMap((prev) => {
      const next = new Map(prev);
      pathsArray.forEach((p) => next.set(p, type));
      return next;
    });
  };

  /**
   * Clear processing state for files
   * @param {string|string[]} paths - File path(s) to clear
   */
  const clearProcessing = (paths) => {
    const pathsArray = Array.isArray(paths) ? paths : [paths];
    setProcessingMap((prev) => {
      const next = new Map(prev);
      pathsArray.forEach((p) => next.delete(p));
      return next;
    });
  };

  return { markProcessing, clearProcessing };
};

/**
 * Mark files as processing (standalone function)
 * @param {Function} setProcessingMap - State setter for processing map
 * @param {string|string[]} paths - File path(s) to mark
 * @param {string} type - Processing type
 */
export const markProcessing = (setProcessingMap, paths, type) => {
  const pathsArray = Array.isArray(paths) ? paths : [paths];
  setProcessingMap((prev) => {
    const next = new Map(prev);
    pathsArray.forEach((p) => next.set(p, type));
    return next;
  });
};

/**
 * Clear processing state for files (standalone function)
 * @param {Function} setProcessingMap - State setter for processing map
 * @param {string|string[]} paths - File path(s) to clear
 */
export const clearProcessing = (setProcessingMap, paths) => {
  const pathsArray = Array.isArray(paths) ? paths : [paths];
  setProcessingMap((prev) => {
    const next = new Map(prev);
    pathsArray.forEach((p) => next.delete(p));
    return next;
  });
};
