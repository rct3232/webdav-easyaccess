'use strict';

/**
 * searchService — the Search Engine layer behind POST /api/search
 * (docs/spec/server/services/searchService.md; wire contract:
 * docs/spec/server/routes/search.md).
 *
 * The LLM-free `name_matches` section (§2.3 step 2) runs on every request:
 * plain containment over ALL requester-visible file_nodes with the same
 * closure/owner visibility rule as the fileService listing, plus the §2.4
 * `result_ref` replay signature emission and the §3.4 `search_hit` usage
 * recording (one raw event per RETURNED node, fire-and-forget).
 *
 * The `semantic` section (§2.3 steps 3–8): the step-3 gate
 * (`roleConfigured('embed')` ∧ `AI_SEMANTIC_SEARCH_ENABLED`) decides whether
 * the leg runs at all — gate off ⇒ the response OMITS the section
 * (`semantic_available:false`, `semantic_unavailable_reason:
 * serverErrors.ai.notConfigured`; AI absence is DATA, never an error). When
 * the gate opens, the query AND its ≤3 segments embed through
 * `llmAdapter.embedQuery` behind the `query_parses` get-or-embed cache
 * (§2.3 step 4 — normalized text is the primary key, the vector TEXT is a
 * JSON envelope validated against the current space identity) and the
 * scoring leg runs behind the ONE injectable `semanticScorer` seam (§2.5a).
 * No scorer injected ⇒ the section is returned HONESTLY EMPTY
 * (`semantic_available:true`, `counts.semantic:0`) — scores are never
 * fabricated. Any provider failure/timeout/mid-switch error degrades the
 * same honest-empty way — never a 5xx.
 *
 * Thrown codes are bare strings translated by the route ERROR_MAP:
 * `queryRequired` / `queryTooLong` / `searchFail` (§2.7). The conversational
 * layer is a RESERVED boundary: this service accepts `resultRef` on the wire
 * (ignored by the engine) and emits only.
 */

const crypto = require('crypto');

const { createSemanticScorer } = require('./semanticScorer');

const QUERY_MAX_LENGTH = 200;
const DEFAULT_NAME_LIMIT = 200;
const DEFAULT_SEMANTIC_LIMIT = 50;
const MAX_SEGMENTS = 3;
const SEMANTIC_UNAVAILABLE_REASON = 'serverErrors.ai.notConfigured';

/**
 * Stable section-order+caps version of the signature `sort` component
 * (§2.4: the sort slot freezes which sections/caps produced the rows).
 */
const SORT_VERSION = 'v1:name_asc:cap200|semantic_score_desc:cap50';

/** E-space key of the signature `space` component (§2.4) in its leg-off /
 *  identity-unresolvable form. The embed identity joins it whenever the leg
 *  runs (a model change MUST change the signature). */
const SIGNATURE_SPACE = 'v1|model:';

/**
 * Factory. All IO through DI seams — tests inject fakes; the default
 * instance resolves the shared seams lazily (usageService precedent). A seam
 * key ABSENT from opts falls back to the shared default; an explicitly
 * injected `null` llmAdapter means "no adapter" (the unconfigured shape).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - store seam (default: store/fileNodesStore).
 * @param {Object} [opts.usageService] - usage seam exposing recordEvent
 *   (default: infrastructure/usageService shared instance).
 * @param {Object} [opts.configResolver] - seam exposing getConfig(key)
 *   (default: the shared configResolver).
 * @param {Object} [opts.llmAdapter] - llmAdapter seam (`roleConfigured`,
 *   `embedQuery`); default: the llmAdapterRuntime singleton (null before
 *   boot init ⇒ the role is unconfigured).
 * @param {Object} [opts.queryParsesStore] - query-embed cache facade
 *   (default: store/queryParsesStore).
 * @param {Object} [opts.llmModelsStore] - model registry facade for the
 *   §2.4 space identity (default: store/llmModelsStore).
 * @param {Object} [opts.provisioner] - `loadLock()` seam for the space
 *   identity fallback (default: the llm provision module).
 * @param {Function} [opts.semanticScorer] - the §2.5a scoring seam
 *   `({ userId, queryVec, segmentVecs, sampleFn }) => [{ nodeId, score }]`;
 *   default: the production scorer (`./semanticScorer` — C2). Inject a
 *   non-function (tests) to disable the seam ⇒ the semantic section is
 *   honestly empty.
 */
function createSearchService(opts = {}) {
  const { fileNodesStore, usageService, configResolver, semanticScorer } = opts;
  const log = opts.log || { warn: console.warn.bind(console) };

  const hasInjectedAdapter = 'llmAdapter' in opts;
  const injectedAdapter = opts.llmAdapter;
  const hasInjectedCache = 'queryParsesStore' in opts;
  const injectedCache = opts.queryParsesStore;
  const hasInjectedModels = 'llmModelsStore' in opts;
  const injectedModels = opts.llmModelsStore;
  const hasInjectedProvisioner = 'provisioner' in opts;
  const injectedProvisioner = opts.provisioner;
  const hasScorer = 'semanticScorer' in opts;
  // C2: the production scorer is the DEFAULT when no seam is injected. An
  // explicitly-injected non-function (tests disable the seam) still means
  // "no scoring seam" — the C1 honest-empty contract is preserved.
  const scorer = hasScorer
    ? semanticScorer
    : createSemanticScorer({
        fileNodesStore,
        llmModelsStore: injectedModels,
        // Lazy facade: the service resolver may be the shared singleton
        // resolved after construction. The scorer reads BASELINE_SAMPLE_DOCS
        // per score() call so an operator change is hot.
        configResolver: {
          getConfig: (key) => resolveConfigResolver().getConfig(key),
        },
      });

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

  function resolveLlmAdapter() {
    if (hasInjectedAdapter) return injectedAdapter;
    try {
      return require('../../infrastructure/llmAdapterRuntime').getLlmAdapter();
    } catch {
      return null;
    }
  }

  function resolveQueryParsesStore() {
    if (hasInjectedCache && injectedCache) return injectedCache;
    if (hasInjectedCache) return null;
    return require('../../store/queryParsesStore');
  }

  function resolveLlmModelsStore() {
    if (hasInjectedModels && injectedModels) return injectedModels;
    if (hasInjectedModels) return null;
    return require('../../store/llmModelsStore');
  }

  function resolveProvisioner() {
    if (hasInjectedProvisioner && injectedProvisioner) return injectedProvisioner;
    if (hasInjectedProvisioner) return null;
    return require('../../infrastructure/adapters/llm/provision');
  }

  /**
   * §2.3 step 1: normalized form (NFKC, ASCII-case fold, whitespace collapse)
   * is the signature/cache key material. The SQL leg keeps the TRIMMED raw query — the
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

  /** Positive-integer cap from the resolver, else the shipped default. */
  async function resolveNumericCap(key, fallback) {
    try {
      const value = Number(await resolveConfigResolver().getConfig(key));
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    } catch {
      /* resolver unavailable → shipped default */
    }
    return fallback;
  }

  /** §2.3 step 3 kill switch: the stored value wins, absent/unset ⇒ enabled. */
  async function semanticSearchEnabled() {
    try {
      const value = await resolveConfigResolver().getConfig('AI_SEMANTIC_SEARCH_ENABLED');
      return !(value === false || value === 'false' || value === 0 || value === '0');
    } catch {
      return true;
    }
  }

  /**
   * §2.4 space identity — deterministic and provider-call-free: the ACTIVE
   * embed registry row id, else the embedded lock identity `repo@revision`,
   * else the empty P0 form. `registryId` is returned for the §2.3 step-4
   * mid-switch comparison.
   */
  async function resolveSpaceIdentity() {
    const modelsStore = resolveLlmModelsStore();
    if (modelsStore && typeof modelsStore.getActiveByRole === 'function') {
      try {
        const row = await modelsStore.getActiveByRole('embed');
        if (row && row.id != null) {
          const registryId = Number(row.id);
          return { space: `v1|model:${registryId}`, registryId };
        }
      } catch {
        /* registry unavailable → lock fallback */
      }
    }
    const provisioner = resolveProvisioner();
    if (provisioner && typeof provisioner.loadLock === 'function') {
      try {
        const lock = provisioner.loadLock();
        if (lock && lock.repo && lock.revision) {
          return { space: `v1|model:${lock.repo}@${lock.revision}`, registryId: null };
        }
      } catch {
        /* no lock → empty identity */
      }
    }
    return { space: SIGNATURE_SPACE, registryId: null };
  }

  /** The cached envelope: `{ space, dim, v }` — miss on any other shape. */
  function parseVectorEnvelope(text) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed.space === 'string' && Array.isArray(parsed.v)) return parsed;
    } catch {
      /* not an envelope → miss */
    }
    return null;
  }

  /**
   * §2.3 step 4 get-or-embed for ONE normalized text. A valid envelope
   * (parses ∧ same space) is a HIT: hit_count+1, zero provider calls.
   * Anything else is a MISS: provider embed, then a best-effort write.
   * Cache failures are transparent (read ⇒ miss, write ⇒ dropped) — the
   * cache is an optimization, never a correctness dependency.
   */
  async function embedViaCache(adapter, text, space, registryId) {
    const cache = resolveQueryParsesStore();
    if (cache && typeof cache.get === 'function') {
      let row = null;
      try {
        row = await cache.get(text);
      } catch {
        row = null;
      }
      if (row && row.vector) {
        const envelope = parseVectorEnvelope(row.vector);
        if (
          envelope &&
          envelope.space === space &&
          envelope.v.length > 0 &&
          envelope.v.every((x) => Number.isFinite(Number(x)))
        ) {
          try {
            await cache.incrementHitCount(text);
          } catch {
            /* accounting is best-effort */
          }
          return envelope.v.map(Number);
        }
      }
    }

    const result = await adapter.embedQuery(text);
    // The adapter may hand back typed vectors (Float32Array) — normalize to a
    // plain finite-number array here: it is the cache-envelope wire shape AND
    // the scorer seam's input contract.
    const raw = result && result.vectors && result.vectors[0];
    const vector = raw ? Array.from(raw, Number) : [];
    if (vector.length === 0 || !vector.every((x) => Number.isFinite(x))) {
      throw new Error('embed adapter returned no query vector');
    }
    if (registryId != null && result.modelId != null && Number(result.modelId) !== registryId) {
      // §2.3 step 4 mid-switch: the identity the signature was computed for
      // no longer matches the answering model — degrade, never mix spaces.
      throw new Error('embed model switched mid-request');
    }
    if (cache && typeof cache.recordEmbedding === 'function') {
      try {
        await cache.recordEmbedding({
          normalizedQuery: text,
          vector: JSON.stringify({
            space,
            dim: Number.isFinite(Number(result?.dim)) ? Number(result.dim) : vector.length,
            v: vector,
          }),
        });
      } catch {
        /* cache write is best-effort */
      }
    }
    return vector.map(Number);
  }

  /** Defensive shape filter for scorer rows — no score fabrication here. */
  function sanitizeScoredRows(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
      .map((row) => ({ nodeId: Number(row?.nodeId), score: Number(row?.score) }))
      .filter(
        (row) =>
          Number.isFinite(row.nodeId) &&
          row.nodeId > 0 &&
          Number.isFinite(row.score) &&
          row.score >= 0 &&
          row.score <= 1
      );
  }

  /**
   * §2.3 steps 3–6: the semantic leg up to (and including) the scorer seam.
   * Returns `{ ran, cappedSegments, scored, space }` — `ran:false` is the
   * step-3 omit shape; any embed/scorer failure degrades to `scored: []`
   * with the leg still marked as ran (honest empty, never a 5xx).
   */
  async function runSemanticLeg(userId, normalizedQuery) {
    const adapter = resolveLlmAdapter();
    let configured = false;
    if (adapter && typeof adapter.roleConfigured === 'function') {
      try {
        configured = (await adapter.roleConfigured('embed')) === true;
      } catch {
        configured = false;
      }
    }
    if (!configured || !(await semanticSearchEnabled())) {
      return { ran: false };
    }

    // The segment cap is a property of the QUERY (§2.3 step 5), known before
    // any IO — the flag stays truthful even when a later step degrades.
    const words = normalizedQuery.split(' ').filter(Boolean);
    const cappedSegments = words.length > MAX_SEGMENTS;
    const segmentTexts = cappedSegments ? words.slice(0, MAX_SEGMENTS) : words;

    const { space, registryId } = await resolveSpaceIdentity();
    const memo = new Map();
    const embedCached = (text) => {
      if (!memo.has(text)) memo.set(text, embedViaCache(adapter, text, space, registryId));
      return memo.get(text);
    };

    try {
      const queryVec = await embedCached(normalizedQuery);
      const segmentVecs = [];
      for (const text of segmentTexts) segmentVecs.push(await embedCached(text));

      let scored = [];
      if (typeof scorer === 'function') {
        scored = sanitizeScoredRows(
          await scorer({
            userId,
            queryVec,
            segmentVecs,
            sampleFn: async (n) =>
              resolveFileNodesStore().sampleVisibleNodeIds(
                userId,
                Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0
              ),
          })
        );
      }
      return { ran: true, cappedSegments, scored, space };
    } catch (err) {
      // §2.3 step 4 degrade: provider failure / timeout / mid-switch /
      // scorer failure ⇒ honestly empty section on a 200. The cause is
      // logged server-side — a silent degrade is unobservable.
      log.warn(`[searchService] semantic leg degraded: ${err?.message ?? err}`);
      return { ran: true, cappedSegments, scored: [], space };
    }
  }

  /**
   * §2.3 step 7: order score desc then node_id asc, dedup against the name
   * section, THEN cap (the cap counts displayed rows); names resolved per
   * returned row (bounded by the semantic cap) — a since-deleted node is
   * honestly dropped. Score rounded to 2 decimals.
   */
  async function assembleSemanticRows(scored, nameMatchedIds, semanticLimit) {
    const nameIdSet = new Set(nameMatchedIds);
    const seen = new Set();
    const sorted = [...scored].sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    const rows = [];
    for (const entry of sorted) {
      if (rows.length >= semanticLimit) break;
      if (nameIdSet.has(entry.nodeId) || seen.has(entry.nodeId)) continue;
      let node = null;
      try {
        node = await resolveFileNodesStore().getNode(entry.nodeId);
      } catch {
        node = null;
      }
      if (!node) continue;
      seen.add(entry.nodeId);
      rows.push({
        nodeId: entry.nodeId,
        name: node.name,
        score: Math.round(entry.score * 100) / 100,
      });
    }
    return rows;
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

    const normalizedQuery = normalizeQuery(trimmed);
    const [nameLimit, semanticLimit] = await Promise.all([
      resolveNumericCap('SEARCH_NAME_LIMIT', DEFAULT_NAME_LIMIT),
      resolveNumericCap('SEARCH_SEMANTIC_LIMIT', DEFAULT_SEMANTIC_LIMIT),
    ]);

    // §2.3 step 2 (`name_matches`, zero-LLM): fetch one extra row so the cap
    // flag is truthful — `name_truncated` is set only when the cap actually
    // cut the set, then the tail is dropped.
    const store = resolveFileNodesStore();
    const rows = await store.searchNodesByName(userId, trimmed, { limit: nameLimit + 1 });
    const truncated = rows.length > nameLimit;
    const capped = truncated ? rows.slice(0, nameLimit) : rows;

    const nameMatches = capped.map((row) => ({ nodeId: Number(row.id), name: row.name }));

    const leg = await runSemanticLeg(userId, normalizedQuery);

    let semanticRows = [];
    if (leg.ran) {
      try {
        semanticRows = await assembleSemanticRows(
          leg.scored,
          nameMatches.map((row) => row.nodeId),
          semanticLimit
        );
      } catch {
        semanticRows = [];
      }
    }

    const resultRefValue = leg.ran
      ? buildResultRef({ normalizedQuery, vectorQuery: normalizedQuery, space: leg.space })
      : buildResultRef({ normalizedQuery });

    scheduleSearchHitEvents(userId, [
      ...nameMatches.map((row) => row.nodeId),
      ...semanticRows.map((row) => row.nodeId),
    ]);

    return {
      nameMatches,
      ...(leg.ran ? { semantic: semanticRows } : {}),
      resultRef: resultRefValue,
      counts: {
        name: nameMatches.length,
        semantic: semanticRows.length,
        total: nameMatches.length + semanticRows.length,
        nameTruncated: truncated,
        ...(leg.ran ? { semanticCappedSegments: leg.cappedSegments } : {}),
      },
      semanticAvailable: leg.ran,
      ...(leg.ran ? {} : { semanticUnavailableReason: SEMANTIC_UNAVAILABLE_REASON }),
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
  MAX_SEGMENTS,
};
