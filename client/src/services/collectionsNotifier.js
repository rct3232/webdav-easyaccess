/**
 * In-process pub-sub for "collections changed" events.
 *
 * collectionsRepository triggers `notifyCollectionsChange()` after real
 * (2xx-acknowledged) mutations only, so controllers can refresh their
 * collections-derived state. Single coarse channel, no event payload —
 * silent system evolution (§4.9) can change anything and subscribers re-read
 * through the gateway (docs/spec/client/services/collectionsNotifier.md).
 */

let collectionsListeners = [];

/**
 * Register a callback invoked when collections change.
 * @param {() => void} callback
 * @returns {() => void} unsubscribe (safe to call more than once / during
 *   effect cleanup)
 */
export const onCollectionsChange = (callback) => {
  collectionsListeners.push(callback);
  return () => {
    collectionsListeners = collectionsListeners.filter((cb) => cb !== callback);
  };
};

/**
 * Notify all subscribers.
 * - Subscriber errors must not break fan-out.
 */
export const notifyCollectionsChange = () => {
  collectionsListeners.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error in collections change listener:', error);
    }
  });
};
