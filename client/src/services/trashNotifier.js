/**
 * In-process pub-sub for trash-change events (DEF-16 P9).
 *
 * Raised on the two stable seams that move items into or out of trash:
 * - `useExplorerCommands.handleOperationComplete` after a completed delete-to-trash
 *   (single delete and bulk delete funnel through the same completion path).
 * - `useTrashOperations` after successful restore / purge / empty runs.
 *
 * The pinned sidebar trash icon (`TrashSidebarItem`) subscribes and plays its
 * one-shot lid/flash animation on every notification.
 */

let trashListeners = [];

/**
 * Register a callback invoked when trash contents change.
 * @param {() => void} callback
 * @returns {() => void} unsubscribe
 */
export const subscribeToTrashChanged = (callback) => {
  trashListeners.push(callback);
  return () => {
    trashListeners = trashListeners.filter((cb) => cb !== callback);
  };
};

/**
 * Notify all subscribers.
 * - Subscriber errors must not break fan-out.
 */
export const notifyTrashChanged = () => {
  trashListeners.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error in trash change listener:', error);
    }
  });
};
