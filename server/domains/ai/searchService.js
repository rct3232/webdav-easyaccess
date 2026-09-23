'use strict';

/**
 * searchService — the Search Engine layer behind POST /api/search
 * (docs/spec/server/services/searchService.md; wire contract:
 * docs/spec/server/routes/search.md).
 *
 * P0 scope (T0.11): the LLM-free `name_matches` section (§4.6 stage 1) —
 * plain containment over ALL requester-visible file_nodes with the same
 * closure/owner visibility rule as the fileService listing — plus the §4.22
 * `result_ref` replay signature emission and the §3.4 `search_hit` usage
 * recording (one raw event per RETURNED node, fire-and-forget).
 *
 * The `semantic` section (segment-AND scoring + per-query dynamic baseline,
 * searchService.md §2.3 steps 3–7) is the P1 add-on (T1.5): until the embed
 * adapter (T1.1) and the vectorStore seam (T1.4) land, the embed role is
 * never configured, so every response is the routes/search.md §2.4
 * embed-absent degrade shape — `semantic` omitted, `semantic_available:
 * false`, `semantic_unavailable_reason: serverErrors.ai.notConfigured`.
 * AI absence is DATA, never an error (§4.12).
 *
 * Thrown codes are bare strings translated by the route ERROR_MAP:
 * `queryRequired` / `queryTooLong` / `searchFail` (§2.7). The conversational
 * layer is a RESERVED boundary: this MVP accepts `resultRef` on the wire
 * (ignored by the engine) and emits only.
 */

const crypto = require('crypto');

const QUERY_MAX_LENGTH = 200;
const DEFAULT_NAME_LIMIT = 200;
const SEMANTIC_UNAVAILABLE_REASON = 'serverErrors.ai.notConfigured';

/**
 * Stable section-order+caps version of the signature `sort` component
 * (§2.4: the sort slot freezes which sections/caps produced the rows).
 * The semantic half is part of the contract even while the leg is P1 — the
 * name-only fallback signature covers query + space + this sort.
 */
const SORT_VERSION = 'v1:name_asc:cap200|semantic_score_desc:cap50';

/** E-space key of the signature `space` component (§2.4). The embed model id
 *  joins it at T1.5 (a model change MUST change the signature); P0 keeps the
 *  empty-model form `v1|model:` — deterministic and replay-stable. */
const SIGNATURE_SPACE = 'v1|model:';

/**
 * Factory. All IO through DI seams — tests inject fakes; the default
 * instance resolves the shared seams lazily (usageService precedent).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - store seam (default: store/fileNodesStore).
 * @param {Object} [opts.usageService] - usage seam exposing recordEvent
 *   (default: infrastructure/usageService shared instance).
 * @param {Object} [opts.configResolver] - seam exposing getConfig(key)
 *   (default: the shared configResolver).
 */
function createSearchService({ fileNodesStore, usageService, configResolver } = {}) {
  function resolveFileNodesStore() {
    if (fileNodesStore) return fileNodesStore;
    return require('../../store/fileNodesStore').createFileNodesStore();
  }

  function resolveUsageService() {
    if (usageService) return usageService;
    const { getUsageService } = require('../../infrastructure/usageService');
    return getUsageService();
  }

  function resolveConfigResolver() {
    if (configResolver) return configResolver;
    const { getSharedResolver } = require('../../infrastructure/configResolver');
    return getSharedResolver();
  }

  /**
   * §2.3 step 1: normalized form (NFKC, ASCII-case fold, whitespace collapse)
   * is the signature material. The SQL leg keeps the TRIMMED raw query — the
   * server-side `lower()` folding owns matching semantics.
   */
  function normalizeQuery(rawQuery) {
    return String(rawQuery ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  /**
   * §2.4: `sig = sha256(normalized-predicates ∥ vector-query ∥ space ∥ sort)`,
   * wire form `"sr1." + hex(sig)[0..16]`. The ∥ join uses NUL separators so
   * queries containing any printable character still produce injective
   * material. No timestamps, no random seeds — the dynamic-baseline sample is
   * execution noise and deliberately NOT signature material.
   */
  function buildResultRef({
    normalizedQuery,
    vectorQuery = '',
    space = SIGNATURE_SPACE,
    sort = SORT_VERSION,
  }) {
    const material = [normalizedQuery, vectorQuery, space, sort].join('\u0000');
    const hex = crypto.createHash('sha256').update(material, 'utf8').digest('hex');
    return `sr1.${hex.slice(0, 16)}`;
  }

  async function resolveNameLimit() {
    try {
      const value = Number(await resolveConfigResolver().getConfig('SEARCH_NAME_LIMIT'));
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    } catch {
      /* resolver unavailable → shipped default */
    }
    return DEFAULT_NAME_LIMIT;
  }

  /**
   * §3.4 signal path: one `usage_events` row `action='search_hit'` per
   * RETURNED node — fire-and-forget; recording failures never throw out of
   * the signal path (usageService contract: errors are the caller's concern).
   */
  function scheduleSearchHitEvents(userId, nodeIds) {
    const usage = resolveUsageService();
    for (const nodeId of nodeIds) {
      Promise.resolve()
        .then(() => usage.recordEvent({ userId, nodeId, action: 'search_hit' }))
        .catch(() => {});
    }
  }

  async function search(userId, { query, resultRef } = {}) {
    // §2.2: `resultRef` is accepted, stored on the signature computation
    // input as `null`, and IGNORED by the MVP — sending it never changes the
    // response (interpretation is the future conversational layer's job).
    void resultRef;

    if (typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('queryRequired');
    }
    const trimmed = query.trim();
    if (trimmed.length > QUERY_MAX_LENGTH) {
      throw new Error('queryTooLong');
    }

    const nameLimit = await resolveNameLimit();

    // §2.3 step 2 (`name_matches`, zero-LLM): fetch one extra row so the cap
    // flag is truthful — `name_truncated` is set only when the cap actually
    // cut the set, then the tail is dropped.
    const store = resolveFileNodesStore();
    const rows = await store.searchNodesByName(userId, trimmed, { limit: nameLimit + 1 });
    const truncated = rows.length > nameLimit;
    const capped = truncated ? rows.slice(0, nameLimit) : rows;

    const nameMatches = capped.map((row) => ({ nodeId: Number(row.id), name: row.name }));

    const resultRefValue = buildResultRef({ normalizedQuery: normalizeQuery(trimmed) });

    scheduleSearchHitEvents(
      userId,
      nameMatches.map((row) => row.nodeId)
    );

    return {
      nameMatches,
      resultRef: resultRefValue,
      counts: {
        name: nameMatches.length,
        semantic: 0,
        total: nameMatches.length,
        nameTruncated: truncated,
      },
      semanticAvailable: false,
      semanticUnavailableReason: SEMANTIC_UNAVAILABLE_REASON,
    };
  }

  return { search, normalizeQuery, buildResultRef };
}

/** Shared default instance (production wiring seam). */
let shared = null;
function getSearchService() {
  if (!shared) shared = createSearchService();
  return shared;
}

module.exports = {
  createSearchService,
  getSearchService,
  SORT_VERSION,
  SIGNATURE_SPACE,
  QUERY_MAX_LENGTH,
};
