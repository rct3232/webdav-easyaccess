/**
 * In-process pub-sub for recent-files change events.
 *
 * Repository triggers `notifyRecentFilesChange()` on successful updates
 * so controllers can refresh observable state.
 */

let recentFilesListeners = [];

/**
 * Register a callback invoked when recent files change.
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export const onRecentFilesChange = (callback) => {
  recentFilesListeners.push(callback);
  return () => {
    recentFilesListeners = recentFilesListeners.filter((cb) => cb !== callback);
  };
};

/**
 * Notify all subscribers.
 * - Subscriber errors must not break fan-out.
 */
export const notifyRecentFilesChange = () => {
  recentFilesListeners.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error in recent files change listener:', error);
    }
  });
};
