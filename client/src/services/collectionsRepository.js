/**
 * Server-backed repository for the collections platform (T0.3 surface).
 *
 * Isolates HTTP IO and notification triggering. Responses are consumed
 * verbatim in snake_case (no client-side key remapping — consumers map fields
 * at render time). Failures are absorbed into the contract-safe fallback:
 * reads never reject and mutations return `null` (delete → `false`), while
 * the absorbed error envelope is surfaced through `options.onError` so
 * controllers can still show a mapped message (docs/spec/client/services/
 * collectionsRepository.md §2.3/§2.4).
 */
import { get, post, put, del } from './apiClient';
import { notifyCollectionsChange } from './collectionsNotifier';

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
    console.error('collectionsRepository onError handler failed:', handlerError);
  }
}

/**
 * Read wrapper: never rejects; on failure returns `fallback` and logs.
 */
async function absorbRead(url, fallback, onError) {
  try {
    return readPayload(await get(url));
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to load ${url}:`, error);
    if (onError) reportEnvelope(onError, error);
    return fallback;
  }
}

/**
 * Mutation wrapper: a real (2xx) success returns the payload verbatim and
 * notifies unless `silent`; any failure returns the fallback without
 * notifying. `fallback` is `null` for payload mutations, `false` for
 * boolean-contract deletes.
 */
async function absorbMutation(
  url,
  { method = 'post', data = undefined, options, fallback = null } = {}
) {
  const opts = options && typeof options === 'object' ? options : {};
  try {
    let payload;
    if (method === 'post') {
      payload = readPayload(await post(url, data));
    } else if (method === 'put') {
      payload = readPayload(await put(url, data));
    } else if (data == null) {
      payload = readPayload(await del(url));
    } else {
      payload = readPayload(await del(url, data));
    }
    if (!opts.silent) notifyCollectionsChange();
    return payload;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to ${method.toUpperCase()} ${url}:`, error);
    if (typeof opts.onError === 'function') reportEnvelope(opts.onError, error);
    return fallback;
  }
}

/**
 * Owner-only sharing-grant read.
 * @returns {Promise<{ grants: Array<Object> }>} empty array on failure
 */
export const getGrants = async (id) => {
  return absorbRead(`/collections/${id}/grants`, { grants: [] });
};

function buildQuery(pairs) {
  const search = new URLSearchParams();
  for (const [key, value] of pairs) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value));
    }
  }
  return search.toString();
}

// -- reads -------------------------------------------------------------------

/**
 * @param {{ sort?: 'activity'|'name'|'created'|'updated'|'similar', include?: string }} [params]
 * @returns {Promise<{ collections: Array<Object> }>} snake_case rows verbatim;
 *   `{ collections: [] }` on failure
 */
export const getCollections = async (params = {}) => {
  const query = buildQuery([
    ['sort', params.sort],
    ['include', params.include],
  ]);
  return absorbRead(query ? `/collections?${query}` : '/collections', { collections: [] });
};

/**
 * @param {number} id
 * @param {{ since?: string }} [params] — Decision B (2026-09-29): the former
 *   `cursor`/`limit` params are RETIRED (the endpoint ships the FULL row set in
 *   one response; the server ignores them), so they never ride the query string.
 * @returns {Promise<{ items: Array<Object>, publish_pending_count?: number,
 *   digest?: Object }>} fallback view shape on failure (no paging keys)
 */
export const getCollectionItems = async (id, params = {}) => {
  const query = buildQuery([['since', params.since]]);
  return absorbRead(query ? `/collections/${id}/items?${query}` : `/collections/${id}/items`, {
    items: [],
  });
};

/**
 * @returns {Promise<{ suggestions: Array<Object> }>} empty array on failure —
 *   the merge slot renders zero footprint (useCollections §2.8)
 */
export const getMergeSuggestions = async () => {
  return absorbRead('/collections/merge-suggestions', { suggestions: [] });
};

/**
 * Batch membership chips for the file listing (DEF-25 — listing contracts frozen).
 * @param {number[]} nodeIds
 */
export const getMemberships = async (nodeIds) => {
  try {
    return (await post('/collections/for-nodes', { nodeIds }))?.data ?? { memberships: [] };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to load collection memberships:', error);
    return { memberships: [] };
  }
};

/**
 * Dry preview (`{ seedNodeId }` or `{ definition }`). `null` only on
 * transport/5xx-style failure — a degraded payload from the server is still a
 * success payload.
 * @param {{ seedNodeId?: number, definition?: Object }} target
 */
export const previewCollection = async (target = {}) => {
  try {
    return (await post('/collections/preview', target))?.data ?? null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to preview collection:', error);
    return null;
  }
};

/**
 * Dry-run the stored definition of an existing collection (owner-only server-side).
 */
export const previewExistingCollection = async (id) => {
  try {
    return (await post(`/collections/${id}/preview`, {}))?.data ?? null;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to preview collection ${id}:`, error);
    return null;
  }
};

/**
 * One-shot upload-queue-drain hint for the silent-evolution `upload` trigger
 * (`POST /collections/evolution/hint`). The server-side per-user debounce is
 * authoritative — the hint is latency sugar only (useFileOperations.md §3).
 * Fire-and-forget contract: failures are absorbed to `null`, the mutation is
 * silent (no collections-change fan-out), and the promise never rejects.
 * @returns {Promise<Object|null>} `{ scheduled }` ∥ null on failure
 */
export const notifyEvolutionHint = async () => {
  return absorbMutation('/collections/evolution/hint', {
    data: { uploadComplete: true },
    options: { silent: true },
  });
};

// -- mutations ---------------------------------------------------------------

/**
 * @param {{ name: string }} payload
 * @param {{ silent?: boolean, onError?: Function }} [options]
 * @returns {Promise<Object|null>} `{ collection, undo: { action_id } } ∥ null`
 */
export const createCollection = async (payload, options) => {
  return absorbMutation('/collections', { data: payload, options });
};

/**
 * @param {number} id
 * @param {{ name?: string, pinned?: boolean, publishMode?: 'ask'|'off'|'auto' }} payload
 */
export const updateCollection = async (id, payload, options) => {
  return absorbMutation(`/collections/${id}`, { method: 'put', data: payload, options });
};

export const archiveCollection = async (id, options) => {
  return absorbMutation(`/collections/${id}/archive`, { data: {}, options });
};

export const restoreCollection = async (id, options) => {
  return absorbMutation(`/collections/${id}/restore`, { data: {}, options });
};

/**
 * Archived-only 2-step permanent delete (trash-parity). `true` on 204,
 * `false` on failure; carries no undo pointer by contract (invariant 10).
 */
export const deleteCollection = async (id, options) => {
  const opts = options && typeof options === 'object' ? options : {};
  try {
    await del(`/collections/${id}`);
    if (!opts.silent) notifyCollectionsChange();
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to DELETE /collections/${id}:`, error);
    if (typeof opts.onError === 'function') reportEnvelope(opts.onError, error);
    return false;
  }
};

/**
 * @param {number} id
 * @param {number[]} nodeIds — camelCase body; unreadable nodes are reported
 *   by the server in `rejected_not_readable` while the rest still add
 */
export const addCollectionItems = async (id, nodeIds, options) => {
  return absorbMutation(`/collections/${id}/items`, { data: { nodeIds }, options });
};

/**
 * DELETE with a JSON body — symmetric batch semantics with POST /:id/items.
 */
export const removeCollectionItems = async (id, nodeIds, options) => {
  return absorbMutation(`/collections/${id}/items`, {
    method: 'del',
    data: { data: { nodeIds } },
    options,
  });
};

/**
 * P-4 member publish (routes/collections.md PUT /:id/items/publish): flips
 * stored rows / materializes derived publishes. The DEF-25 seam POSTed the
 * nonexistent `/collections/:id/publish` — the shipped surface is a PUT with
 * `{ nodeIds, published }`; response `{ published, ignored, undo }`.
 */
export const publishItems = async (id, nodeIds, published, options) => {
  return absorbMutation(`/collections/${id}/items/publish`, {
    method: 'put',
    data: { nodeIds, published },
    options,
  });
};

/**
 * Merge execution: `:id` survives, `:otherId` is absorbed.
 */
export const mergeCollections = async (id, otherId, options) => {
  return absorbMutation(`/collections/${id}/merge/${otherId}`, { data: {}, options });
};

export const dismissMerge = async (id, otherId, options) => {
  return absorbMutation(`/collections/${id}/merge-dismiss`, { data: { otherId }, options });
};

export const rejectMerge = async (id, otherId, options) => {
  return absorbMutation(`/collections/${id}/merge-reject`, { data: { otherId }, options });
};

/**
 * @param {number} id
 * @param {{ userId: number, role: 'viewer'|'editor' }} payload
 */
export const grantCollection = async (id, payload, options) => {
  return absorbMutation(`/collections/${id}/grants`, { data: payload, options });
};

export const revokeGrant = async (id, userId, options) => {
  return absorbMutation(`/collections/${id}/grants?userId=${userId}`, { method: 'del', options });
};

/**
 * Grantee self-revocation (Path 1, routes spec DELETE /:id/grants/me):
 * instant, journaled owner-side parity; the revoked row drops out of the
 * next `GET /api/collections` read.
 */
export const revokeOwnGrant = async (id, options) => {
  return absorbMutation(`/collections/${id}/grants/me`, { method: 'del', options });
};

// -- Search results mode (T0.11; explorerGateway §2.6 search group) ----------

/**
 * §4.6 server-wide search. The snake_case response is returned verbatim;
 * `null` only on transport/5xx-style failure — an omitted `semantic` key is
 * a SUCCESS payload (degradation reported as data, routes/search.md §2.4).
 * Exception to the no-options read rule: `options.onError` receives the
 * absorbed error envelope exactly once (side channel, no rejection) so the
 * controller can map a still-returned 400 (useSearchResults §2.6).
 *
 * @param {{ query: string, resultRef?: string }} target — `resultRef` is an
 *   opaque replay token sent verbatim as `result_ref` (the only snake_case
 *   request-body field, routes/search.md §2.4.2)
 * @param {{ onError?: Function }} [options]
 * @returns {Promise<Object|null>}
 */
export const runSearch = async ({ query, resultRef } = {}, options = {}) => {
  try {
    const body = { query };
    if (resultRef !== undefined && resultRef !== null) {
      body.result_ref = resultRef;
    }
    const config = {};
    if (options.signal) config.signal = options.signal;
    if (options.timeout != null) config.timeout = options.timeout;
    const response =
      Object.keys(config).length > 0
        ? await post('/search', body, config)
        : await post('/search', body);
    return readPayload(response);
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to run search:', error);
    if (typeof options.onError === 'function') reportEnvelope(options.onError, error);
    return null;
  }
};

/**
 * §3.4 list-entry-click recording point for search results (register (a)):
 * fire-and-forget `POST /search/click` (`action='open'` server-side).
 * Always silent — a click signal must never fan the collections notifier.
 * `true` on 204, `false` on absorbed failure; never rejects.
 *
 * @param {number} nodeId
 * @returns {Promise<boolean>}
 */
export const recordSearchClick = async (nodeId) => {
  try {
    await post('/search/click', { node_id: nodeId });
    return true;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to record search entry click:', error);
    return false;
  }
};

/**
 * Undo execution — the §2.5 structured-result exception to the `∥ null`
 * mutation precedent: 409s are RETURNED (not collapsed) so the undo-toast
 * controller can read `errorCode`/`params.laterChanges` without a second
 * round trip. Camel keys here are the internal result object, not a wire
 * payload (the snake_case 200 body maps once at this boundary).
 * @param {number} actionId
 * @param {{ confirmCascade?: boolean }} [options]
 */
export const undoAction = async (actionId, options = {}) => {
  try {
    const response = await post(
      `/actions/${actionId}/undo`,
      options?.confirmCascade ? { confirmCascade: true } : {}
    );
    const payload = readPayload(response) ?? {};
    notifyCollectionsChange();
    return {
      ok: true,
      status: payload.status,
      undoneAt: payload.undone_at ?? null,
      cascadeUndone: payload.cascade_undone ?? [],
      itemsUndone: Number(payload.items_undone ?? 0),
      itemsSkipped: Number(payload.items_skipped ?? 0),
    };
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error(`Failed to undo action ${actionId}:`, error);
    const envelope = extractErrorEnvelope(error);
    return {
      ok: false,
      status: error?.response?.status,
      errorCode: envelope?.errorCode,
      params: envelope?.params ?? {},
    };
  }
};

// -- Actions feed (T0.10; routes/actions.md) ---------------------------------

/**
 * 30-day undo-journal feed (GET /api/actions) — rows consumed verbatim in
 * snake_case (actions.md §2.4); absorbed failures return `{ actions: [] }`.
 * @param {{ domain?: string }} [params]
 * @returns {Promise<{ actions: Array<Object> }>}
 */
export const getActions = async (params = {}) => {
  const query = buildQuery([['domain', params.domain]]);
  return absorbRead(query ? `/actions?${query}` : '/actions', { actions: [] });
};
