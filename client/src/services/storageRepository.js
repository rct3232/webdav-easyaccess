/**
 * Server-backed repository for the personal Storage domain (storage client
 * domain split; docs/spec/client/services/storageRepository.md).
 *
 * Responses are consumed verbatim in snake_case. Failures are absorbed into
 * the contract-safe fallback: reads never reject (`{ suggestions: [] }` /
 * `null`), mutations return `null`, and the absorbed error envelope is
 * surfaced through `options.onError` so controllers can still show a mapped
 * message. The storage domain is collection-independent: no notifier fan-out.
 */
import { get, post } from './apiClient';

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
    console.error('storageRepository onError handler failed:', handlerError);
  }
}

/**
 * Read wrapper: never rejects; on failure returns `fallback` and logs.
 */
async function absorbRead(url, fallback) {
  try {
    return readPayload(await get(url));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to load ${url}:`, error);
    return fallback;
  }
}

/**
 * Mutation wrapper: a real (2xx) success returns the payload verbatim; any
 * failure returns `null` without notifying.
 */
async function absorbMutation(url, { data = undefined, options } = {}) {
  const opts = options && typeof options === 'object' ? options : {};
  try {
    return readPayload(await post(url, data));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to POST ${url}:`, error);
    if (typeof opts.onError === 'function') reportEnvelope(opts.onError, error);
    return null;
  }
}

// -- reads -------------------------------------------------------------------

/**
 * ONE hygiene + persisted cleanup-suggestions read (GET /api/storage).
 * Failure fallback keeps the spec'd `{ suggestions: [] }` shape — consumers
 * read the hygiene keys defensively (absent ⇒ block omitted,
 * StorageDashboard.md §2.3.1).
 * @returns {Promise<Object>}
 */
export const getStorageHygiene = async () => {
  return absorbRead('/storage', { suggestions: [] });
};

/**
 * Current storage breakdown + per-user daily series (GET /api/storage/usage).
 * Absorbed failure returns `null` so the summary and sparkline are omitted
 * (no fabricated or partial series — StorageDashboard.md §2.3).
 * @returns {Promise<{ current: Object, series: { points: Array<{ day: string, bytes: number }> } } | null>}
 */
export const getStorageUsage = async () => {
  return absorbRead('/storage/usage', null);
};

// -- mutations ---------------------------------------------------------------

/**
 * Accept checked suggestion rows → trash as ONE journaled command (POST
 * /api/storage/suggestions/accept, camelCase body). The response carries
 * `undo: { action_id }` for the undo toast (StorageDashboard.md §2.3.1).
 * @param {number[]} nodeIds
 * @param {{ onError?: Function }} [options]
 * @returns {Promise<Object|null>}
 */
export const acceptStorageSuggestions = async (nodeIds, options) => {
  return absorbMutation('/storage/suggestions/accept', { data: { nodeIds }, options });
};

/**
 * Dismiss one persisted suggestion (`pending → dismissed`, POST
 * /api/storage/suggestions/dismiss). Absorbed failure returns null and the
 * row stays (no toast either way — StorageCleanupSuggestions.md §2.3).
 * @param {number} suggestionId
 * @param {{ onError?: Function }} [options]
 * @returns {Promise<{ id: number, state: string } | null>}
 */
export const dismissStorageSuggestion = async (suggestionId, options) => {
  return absorbMutation('/storage/suggestions/dismiss', { data: { suggestionId }, options });
};
