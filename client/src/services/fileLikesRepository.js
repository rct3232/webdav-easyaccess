/**
 * Viewer-scoped like-state repository (T0.5 — docs/features/collections-platform.md
 * §3.3; routes: docs/spec/server/routes/fileLikes.md).
 *
 * Isolates the `/api/file-likes` HTTP IO (whole-viewer read + explicit set) and
 * publishes a change signal after a REAL (2xx-acknowledged) write so subscribed
 * controllers converge on the server truth. Follows the collectionsRepository
 * failure-absorption contract: reads never reject (fallback returned), mutations
 * return `null` on absorbed failure while surfacing the error envelope through
 * `options.onError`. A like carries no undo pointer (§4.11), so no journal
 * fan-out is involved.
 *
 * **Decision (wave-2 integration):** the notifier is co-located here (not a
 * separate fileLikesNotifier.js twin) to keep the integration surface minimal;
 * the subscribe/notify contract matches `collectionsNotifier.md`.
 *
 * @see docs/spec/client/services/fileLikesRepository.md
 */
import { get, put } from './apiClient';

function readPayload(response) {
  return response?.data ?? null;
}

function extractErrorEnvelope(error) {
  const data = error?.response?.data;
  if (!data || typeof data !== 'object') return null;
  return {
    ...(data.errorCode !== undefined && { errorCode: data.errorCode }),
    params: data.params ?? {},
  };
}

function reportEnvelope(handler, error) {
  try {
    handler(extractErrorEnvelope(error));
  } catch (handlerError) {
    // eslint-disable-next-line no-console
    console.error('fileLikesRepository onError handler failed:', handlerError);
  }
}

// -- module-local notifier (collectionsNotifier parity) ----------------------

let fileLikesListeners = [];

/**
 * Register a callback invoked after a real like-state change.
 * @param {() => void} callback
 * @returns {() => void} unsubscribe (safe to call more than once / during
 *   effect cleanup — recentFiles/collections notifier contract)
 */
export const subscribeFileLikesChange = (callback) => {
  fileLikesListeners.push(callback);
  return () => {
    fileLikesListeners = fileLikesListeners.filter((cb) => cb !== callback);
  };
};

/**
 * Notify all subscribers; a throwing subscriber never breaks the fan-out.
 */
export const notifyFileLikesChange = () => {
  fileLikesListeners.forEach((callback) => {
    try {
      callback();
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error in file-likes change listener:', error);
    }
  });
};

// -- reads -------------------------------------------------------------------

/**
 * Whole-viewer like read feeding `file.liked` on explorer listing rows
 * (§3.3; the read is viewer-scoped — invariant 9).
 * @returns {Promise<{ liked: number[] }>} snake_case payload verbatim;
 *   `{ liked: [] }` on failure (never rejects, never notifies)
 */
export const getLikedNodeIds = async () => {
  try {
    const payload = readPayload(await get('/file-likes'));
    return { liked: Array.isArray(payload?.liked) ? payload.liked : [] };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load file likes:', error);
    return { liked: [] };
  }
};

/**
 * P-5 Likes-surface listing (routes/fileLikes.md §2.4.2) — mirrors
 * collectionsRepository.getCollectionItems: Decision B (2026-09-29 owner
 * ruling) ships the COMPLETE classified row set in ONE response (the former
 * `cursor`/`limit` query params are RETIRED), rows stay snake_case verbatim
 * (consumed by the shell's toMemberRow adapter), and the read NEVER rejects
 * (absorbed `{ items: [] }` fallback) and never notifies (it is the read the
 * change-subscribers converge on).
 * @returns {Promise<{ items: Array<object> }>}
 */
export const getLikedItems = async () => {
  try {
    const payload = readPayload(await get('/file-likes/items'));
    return { items: Array.isArray(payload?.items) ? payload.items : [] };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load liked items:', error);
    return { items: [] };
  }
};

// -- mutations ---------------------------------------------------------------

/**
 * Explicit set (the client-initiated toggle — never a guess, fileLikes.md §2.4).
 * Notifies subscribers after a real 2xx; the response echoes the settled state
 * (idempotent). `null` on absorbed failure.
 *
 * @param {number} nodeId
 * @param {boolean} liked
 * @param {{ onError?: (envelope: {errorCode?: string, params: object} | null) => void }} [options]
 * @returns {Promise<{ node_id: number, liked: boolean } | null>}
 */
export const setFileLike = async (nodeId, liked, options) => {
  const opts = options && typeof options === 'object' ? options : {};
  try {
    const payload = readPayload(await put(`/file-likes/${nodeId}`, { liked }));
    notifyFileLikesChange();
    return payload;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to set like for node ${nodeId}:`, error);
    if (typeof opts.onError === 'function') reportEnvelope(opts.onError, error);
    return null;
  }
};
