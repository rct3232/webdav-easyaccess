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
 * the leg runs at all — gate off ⇒ the response OMITS the section and emits
 * `semantic_unavailable_reason` (`not_configured | preparing |
 * provisioning_failed | probe_failed | non_conforming | disabled`; AI absence
 * is DATA, never an error). The section's PRESENCE is the availability signal:
 * absent = not run, `[]` = ran honestly empty, non-empty = scored rows. When
 * the gate opens, the query AND its ≤3 segments embed through
 * `llmAdapter.embedQuery` behind the `query_parses` get-or-embed cache
 * (§2.3 step 4 — normalized text is the primary key, the vector TEXT is a
 * JSON envelope validated against the current space identity) and the
 * scoring leg runs behind the ONE injectable `semanticScorer` seam (§2.5a).
 * No scorer injected ⇒ the section is returned HONESTLY EMPTY
 * (`semantic: []`, `counts.semantic:0`) — scores are never fabricated. Any
 * provider failure/timeout/mid-switch error degrades the same honest-empty
 * way — never a 5xx.
 *
 * The `parse.nl` leg (§2.8) runs ONE chat call MAX per submit behind the
 * `query_parses.predicates` cache; its canonical grammar atoms ride the SAME
 * response additively (`predicates`). The §4.22/§2.9 delta leg additionally
 * structures `add | replace | exclude | exclude_similar | $ref:"latest"` with
 * the pure rule table (`./deltaStructuring`) and replays a bound request
 * `result_ref` through the process-local execution-material registry
 * (`./resultRefRegistry`) under CURRENT ACL — no node-id snapshots.
 *
 * Thrown codes are bare strings translated by the route ERROR_MAP:
 * `queryRequired` / `queryTooLong` / `searchFail` (§2.7).
 */

const crypto = require('crypto');

const { createSemanticScorer } = require('./semanticScorer');
const { getVectorStoreOrFallback } = require('./vectorStoreRuntime');
const {
  createNlParser,
  normalizeQueryText,
  validateSessionState,
  readParseEnvelope,
} = require('./nlParser');
const { structureDelta, RESULT_REF_PATTERN } = require('./deltaStructuring');
const { getSharedResultRefRegistry } = require('./resultRefRegistry');
const { evaluateDefinition } = require('../collections/definitionEngine');
const { parseVector, cosineSimilarity } = require('./vectorStore/vectorMath');
const { foldTag } = require('./tagVocabulary');

const QUERY_MAX_LENGTH = 200;
const DEFAULT_NAME_LIMIT = 200;
const DEFAULT_SEMANTIC_LIMIT = 50;
const MAX_SEGMENTS = 3;
/** Restart replay-derivation scan bounds (searchService.md §2.4/§2.9). */
const DERIVE_SCAN_LIMIT = 1000;
const DERIVE_PAGE_SIZE = 500;
/** Readiness vocabulary for the absent-section diagnostic (not i18n error keys). */
const SEMANTIC_UNAVAILABLE_REASON = Object.freeze({
  NOT_CONFIGURED: 'not_configured',
  PREPARING: 'preparing',
  PROVISIONING_FAILED: 'provisioning_failed',
  PROBE_FAILED: 'probe_failed',
  NON_CONFORMING: 'non_conforming',
  DISABLED: 'disabled',
});

/**
 * Stable section-order+caps version of the signature `sort` component
 * (§2.4: the sort slot freezes which sections/caps produced the rows).
 */
const SORT_VERSION = 'v1:name_asc:cap200|semantic_score_desc:cap50';

/** E-space key of the signature `space` component (§2.4) in its leg-off /
 *  identity-unresolvable form. The embed identity joins it whenever the leg
 *  runs (a model change MUST change the signature). */
const SIGNATURE_SPACE = 'v1|model:';

/** Union-find over numeric node ids (exclude_similar connected components). */
function makeUnionFind() {
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root) root = parent.get(root);
    let current = x;
    while (parent.get(current) !== root) {
      const next = parent.get(current);
      parent.set(current, root);
      current = next;
    }
    return root;
  };
  return {
    union(a, b) {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(Math.min(ra, rb), Math.max(ra, rb));
    },
    find,
  };
}

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
 *   `embedQuery`, `chat`); default: the llmAdapterRuntime singleton (null
 *   before boot init ⇒ the role is unconfigured).
 * @param {Object} [opts.queryParsesStore] - query-embed cache facade
 *   (default: store/queryParsesStore).
 * @param {Object} [opts.llmModelsStore] - model registry facade for the
 *   §2.4 space identity and `exclude_similar` profile θ (default:
 *   store/llmModelsStore).
 * @param {Object} [opts.provisioner] - `loadLock()` seam for the space
 *   identity fallback (default: the llm provision module).
 * @param {Object} [opts.embeddingsStore] - pooled-row seam used by
 *   `exclude_similar` (default: store/embeddingsStore).
 * @param {Object} [opts.presets] - manifest seam for `thetaDup`
 *   (default: infrastructure/adapters/llm/presets).
 * @param {Object} [opts.resultRefRegistry] - replay-material registry
 *   (default: the shared bounded process-local registry).
 * @param {Function} [opts.semanticScorer] - the §2.5a scoring seam
 *   `({ userId, queryVec, segmentVecs, sampleFn, candidateIds }) =>
 *   [{ nodeId, score }]`; default: the production scorer
 *   (`./semanticScorer` — C2). Inject a non-function (tests) to disable the
 *   seam ⇒ the semantic section is honestly empty.
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
  const hasInjectedRegistry = 'resultRefRegistry' in opts;
  const injectedRegistry = opts.resultRefRegistry;
  const hasInjectedEmbeddings = 'embeddingsStore' in opts;
  const injectedEmbeddings = opts.embeddingsStore;
  const hasInjectedPresets = 'presets' in opts;
  const injectedPresets = opts.presets;
  const hasInjectedLikes = 'fileLikesStore' in opts;
  const injectedLikes = opts.fileLikesStore;
  const hasInjectedTags = 'aiTagStore' in opts;
  const injectedTags = opts.aiTagStore;
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
        // C6: the production scorer reads the boot-selected vectorStore engine
        // (native when available, JsFallback otherwise — vectorStore.md §2.3).
        engineFactory: (modelId, loadRows) => getVectorStoreOrFallback(modelId, loadRows),
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

  function resolveEmbeddingsStore() {
    if (hasInjectedEmbeddings) return injectedEmbeddings;
    return require('../../store/embeddingsStore');
  }

  function resolvePresets() {
    if (hasInjectedPresets) return injectedPresets;
    return require('../../infrastructure/adapters/llm/presets');
  }

  function resolveFileLikesStore() {
    if (hasInjectedLikes) return injectedLikes;
    return require('../../store/fileLikesStore');
  }

  function resolveAiTagStore() {
    if (hasInjectedTags) return injectedTags;
    return require('../../store/aiTagStore');
  }

  function resolveResultRefRegistry() {
    if (hasInjectedRegistry) return injectedRegistry;
    return getSharedResultRefRegistry();
  }

  /**
   * §2.3 step 1: normalized form (NFKC, ASCII-case fold, whitespace collapse)
   * is the signature/cache key material. The SQL leg keeps the TRIMMED raw query — the
   * server-side `lower()` folding owns matching semantics. The parse leg refines the
   * vector-query text through the SAME normalizer (searchService.md §2.8 — single source).
   */
  function normalizeQuery(rawQuery) {
    return normalizeQueryText(rawQuery);
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

  /**
   * §2.4/§2.9 delta signature: fresh deterministic material over the bound
   * base ref + merged atoms/exclusions + effective vector text + space + sort.
   * Different delta bases never collide; identical inputs reproduce the ref.
   */
  function buildDeltaResultRef({
    baseRef = '',
    normalizedQuery,
    vectorQuery = '',
    atoms = [],
    excludes = [],
    excludeSimilar = false,
    space = SIGNATURE_SPACE,
    sort = SORT_VERSION,
  }) {
    const material = [
      'delta1',
      baseRef,
      normalizedQuery,
      vectorQuery,
      JSON.stringify(atoms),
      JSON.stringify(excludes),
      excludeSimilar ? '1' : '0',
      space,
      sort,
    ].join('\u0000');
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

  /** §2.8 kill switch (`parse.nl`, same exception family): absent/unset ⇒ enabled. */
  async function nlParseEnabled() {
    try {
      const value = await resolveConfigResolver().getConfig('AI_NL_PARSE_ENABLED');
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
   * §2.3 step 3a / §2.8: the NL-parse leg. Gate first (`roleConfigured('chat')`
   * ∧ kill switch — embed-only or chat-less configs never reach `chat`, ZERO
   * provider calls), then the parse.nl parser behind the `query_parses.predicates`
   * cache. ANY failure path resolves null — the SILENT vector+name fallback
   * (the response stays the parser-free shape, never an error to the user).
   * The request-side session state is canonicalized grammar-first: malformed
   * state is discarded (parse runs stateless, never a 4xx).
   */
  async function runParseLeg(adapter, normalizedQuery, requestPredicates) {
    let chatReady = false;
    if (adapter && typeof adapter.roleConfigured === 'function') {
      try {
        chatReady = (await adapter.roleConfigured('chat')) === true;
      } catch {
        chatReady = false;
      }
    }
    if (!chatReady || !(await nlParseEnabled())) return null;

    const sessionAtoms = validateSessionState(requestPredicates);
    const parser = createNlParser({
      adapter,
      cache: resolveQueryParsesStore(),
      log,
    });
    try {
      return await parser.parse(normalizedQuery, { sessionAtoms });
    } catch (err) {
      // The parser never throws by contract; this guards seam surprises
      // (fake adapters, injected caches) — same silent fallback posture.
      log.warn(`[searchService] parse.nl leg degraded: ${err?.message ?? err}`);
      return null;
    }
  }

  /**
   * Readiness of the embed role for the semantic leg. Prefers the adapter's
   * reason-bearing `getRoleReadiness`; falls back to the boolean
   * `roleConfigured` (test doubles / older seams) with `not_configured`.
   */
  async function resolveEmbedReadiness(adapter) {
    if (!adapter) {
      return { configured: false, reason: SEMANTIC_UNAVAILABLE_REASON.NOT_CONFIGURED };
    }
    if (typeof adapter.getRoleReadiness === 'function') {
      try {
        const readiness = await adapter.getRoleReadiness('embed');
        if (readiness && typeof readiness.configured === 'boolean') {
          return {
            configured: readiness.configured,
            reason:
              readiness.configured === true
                ? null
                : readiness.reason || SEMANTIC_UNAVAILABLE_REASON.NOT_CONFIGURED,
          };
        }
      } catch {
        /* fall through to the boolean seam */
      }
    }
    if (typeof adapter.roleConfigured === 'function') {
      try {
        const configured = (await adapter.roleConfigured('embed')) === true;
        return {
          configured,
          reason: configured ? null : SEMANTIC_UNAVAILABLE_REASON.NOT_CONFIGURED,
        };
      } catch {
        /* fall through */
      }
    }
    return { configured: false, reason: SEMANTIC_UNAVAILABLE_REASON.NOT_CONFIGURED };
  }

  /**
   * §2.3 step 3 gate + §2.4 space identity resolved ONCE per request so the
   * parse, replay binding and execution all agree on the E-space.
   */
  async function resolveSemanticGate(adapter) {
    const readiness = await resolveEmbedReadiness(adapter);
    let enabled = true;
    try {
      enabled = await semanticSearchEnabled();
    } catch {
      enabled = true;
    }
    if (!readiness.configured || !enabled) {
      return {
        run: false,
        reason: readiness.configured ? SEMANTIC_UNAVAILABLE_REASON.DISABLED : readiness.reason,
        space: SIGNATURE_SPACE,
        registryId: null,
      };
    }
    const { space, registryId } = await resolveSpaceIdentity();
    return { run: true, reason: null, space, registryId };
  }

  /**
   * §2.3 steps 4–6 behind one executor. The caller has already resolved the
   * gate; `restrictIds` is the §2.9 base-candidate restriction for a refined
   * delta re-score. Any embed/scorer failure degrades to `scored: []` with
   * the leg still marked as ran (honest empty, never a 5xx).
   */
  async function executeSemanticSection(
    userId,
    { normalizedQuery, embedText, segmentSource = normalizedQuery, gate, restrictIds = null }
  ) {
    if (!gate.run) {
      return { ran: false, reason: gate.reason || SEMANTIC_UNAVAILABLE_REASON.NOT_CONFIGURED };
    }
    const adapter = resolveLlmAdapter();
    const source = String(segmentSource || normalizedQuery);
    const words = source.split(' ').filter(Boolean);
    const cappedSegments = words.length > MAX_SEGMENTS;
    const segmentTexts = cappedSegments ? words.slice(0, MAX_SEGMENTS) : words;

    const memo = new Map();
    const embedCached = (text) => {
      if (!memo.has(text))
        memo.set(text, embedViaCache(adapter, text, gate.space, gate.registryId));
      return memo.get(text);
    };

    try {
      const queryVec = await embedCached(embedText || normalizedQuery);
      const segmentVecs = [];
      for (const text of segmentTexts) segmentVecs.push(await embedCached(text));

      let scored = [];
      if (typeof scorer === 'function') {
        scored = sanitizeScoredRows(
          await scorer({
            userId,
            queryVec,
            segmentVecs,
            candidateIds: restrictIds || null,
            sampleFn: async (n) =>
              resolveFileNodesStore().sampleVisibleNodeIds(
                userId,
                Number.isFinite(Number(n)) && Number(n) > 0 ? Math.floor(Number(n)) : 0
              ),
          })
        );
      }
      return { ran: true, cappedSegments, scored, space: gate.space };
    } catch (err) {
      // §2.3 step 4 degrade: provider failure / timeout / mid-switch /
      // scorer failure ⇒ honestly empty section on a 200. The cause is
      // logged server-side — a silent degrade is unobservable.
      log.warn(`[searchService] semantic leg degraded: ${err?.message ?? err}`);
      return { ran: true, cappedSegments, scored: [], space: gate.space };
    }
  }

  /** §2.3 step 2: the ACL-scoped name section (+ truthful truncation flag). */
  async function executeNameSection(userId, queryText, nameLimit) {
    const store = resolveFileNodesStore();
    const rows = await store.searchNodesByName(userId, queryText, { limit: nameLimit + 1 });
    const truncated = rows.length > nameLimit;
    const capped = truncated ? rows.slice(0, nameLimit) : rows;
    return {
      nameMatches: capped.map((row) => ({ nodeId: Number(row.id), name: row.name })),
      truncated,
    };
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

  /** §2.9: requester root display path (`/<username>`) — path-atom anchor. */
  async function resolveUserRootPath(userId) {
    try {
      const root = await resolveFileNodesStore().getUserRootNode(Number(userId));
      return root && root.name ? `/${String(root.name)}` : null;
    } catch {
      return null;
    }
  }

  /** §2.9 filter providers — the same shared-grammar evaluators as collections. */
  async function buildFilterProviders(userId) {
    const store = resolveFileNodesStore();
    const likes = resolveFileLikesStore();
    const tags = resolveAiTagStore();
    return {
      likedNodeIds: new Set(await likes.listLikedNodeIds(userId)),
      getSize: async (nodeId) => {
        const cache = await store.getCache(nodeId);
        return cache && cache.size != null ? Number(cache.size) : null;
      },
      listNodesByTag: async (value) => {
        const folded = foldTag(value);
        if (!folded) return [];
        return tags.listNodeIdsByRawTag(folded);
      },
    };
  }

  /** Candidate rows + ancestor chain for definition-engine path resolution. */
  async function loadNodesWithAncestors(nodeIds) {
    const store = resolveFileNodesStore();
    const byId = new Map();
    for (const rawId of nodeIds) {
      let current = byId.get(Number(rawId));
      if (!current) {
        try {
          current = await store.getNode(Number(rawId));
        } catch {
          current = null;
        }
      }
      let guard = 0;
      while (current && guard < 1000) {
        const currentId = Number(current.id);
        if (byId.has(currentId)) break;
        byId.set(currentId, current);
        if (current.parentId == null) break;
        const parentId = Number(current.parentId);
        current = byId.get(parentId);
        if (!current) {
          try {
            current = await store.getNode(parentId);
          } catch {
            current = null;
          }
        }
        guard += 1;
      }
    }
    return byId;
  }

  /**
   * §2.9 filter execution: all_of atoms admit, then the exclusion list (an
   * OR-subtraction set) removes. Failures keep the pre-filter candidates —
   * availability over a hard 5xx; atoms are grammar-validated before this.
   */
  async function filterNodeIds(userId, nodeIds, atoms, excludes) {
    const unique = [...new Set(nodeIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
    if (atoms.length === 0 && excludes.length === 0) return new Set(unique);
    if (unique.length === 0) return new Set();

    try {
      const nodesById = await loadNodesWithAncestors(unique);
      const candidateNodes = unique.map((id) => nodesById.get(id)).filter(Boolean);
      const providers = await buildFilterProviders(userId);
      let kept = new Set(unique);
      if (atoms.length > 0) {
        const admitted = await evaluateDefinition({
          definition: { kind: 'predicate', all_of: atoms },
          candidateNodes,
          nodesById,
          providers,
        });
        kept = new Set([...admitted.keys()].map(Number));
      }
      if (excludes.length > 0) {
        const excluded = await evaluateDefinition({
          definition: { kind: 'predicate', any_of: excludes },
          candidateNodes,
          nodesById,
          providers,
        });
        for (const nodeId of excluded.keys()) kept.delete(Number(nodeId));
      }
      return kept;
    } catch (err) {
      log.warn(`[searchService] delta filter degraded: ${err?.message ?? err}`);
      return new Set(unique);
    }
  }

  /** Apply the merged AND atoms + exclusion subtraction to both sections. */
  async function applyStructuredFilters(userId, { nameMatches, scored }, atoms, excludes) {
    const ids = [...nameMatches.map((row) => row.nodeId), ...scored.map((row) => row.nodeId)];
    const kept = await filterNodeIds(userId, ids, atoms, excludes);
    return {
      nameMatches: nameMatches.filter((row) => kept.has(Number(row.nodeId))),
      scored: scored.filter((row) => kept.has(Number(row.nodeId))),
    };
  }

  /**
   * §2.9 final ACL intersection: the visible set is the last stage for a
   * delta/replay turn (SQL/scorer already scope, but a replay must re-check
   * revocation/purge at assembly time). Missing seam ⇒ no extra restriction.
   */
  async function intersectVisible(userId, { nameMatches, scored }) {
    const store = resolveFileNodesStore();
    if (typeof store.listVisibleFileNodeIds !== 'function') return { nameMatches, scored };
    let visibleIds;
    try {
      visibleIds = await store.listVisibleFileNodeIds(Number(userId));
    } catch {
      return { nameMatches, scored };
    }
    const visible = new Set((visibleIds || []).map(Number));
    return {
      nameMatches: nameMatches.filter((row) => visible.has(Number(row.nodeId))),
      scored: scored.filter((row) => visible.has(Number(row.nodeId))),
    };
  }

  /**
   * §2.9 exclude_similar: pooled ACTIVE-model vectors for the final candidate
   * set, pairwise cosine at the profile θ_dup (non-finite skipped), union-find
   * components, keep the best-ranked/earliest row per component. No active
   * model / θ ⇒ no-op (never fabricated similarity).
   */
  async function applyExcludeSimilar(userId, { nameMatches, scored }) {
    const rank = new Map();
    nameMatches.forEach((row, index) => rank.set(Number(row.nodeId), index));
    const ordered = [...scored].sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    ordered.forEach((row, index) => {
      if (!rank.has(Number(row.nodeId))) rank.set(Number(row.nodeId), nameMatches.length + index);
    });
    if (rank.size < 2) return { nameMatches, scored };

    let model = null;
    try {
      model = await resolveLlmModelsStore().getActiveByRole('embed');
    } catch {
      model = null;
    }
    if (!model) return { nameMatches, scored };
    const presets = resolvePresets();
    const profile =
      presets && typeof presets.getPresetByFamilyRole === 'function'
        ? presets.getPresetByFamilyRole(model.provider, 'embed')?.profile
        : null;
    const thetaDup = Number(profile?.thetaDup);
    if (!Number.isFinite(thetaDup)) return { nameMatches, scored };

    const embeddings = resolveEmbeddingsStore();
    if (!embeddings || typeof embeddings.getByNodeIds !== 'function') {
      return { nameMatches, scored };
    }
    let rows;
    try {
      rows = await embeddings.getByNodeIds([...rank.keys()]);
    } catch {
      return { nameMatches, scored };
    }

    const vectors = new Map();
    for (const row of rows || []) {
      if (Number(row.modelId) !== Number(model.id)) continue;
      try {
        vectors.set(Number(row.nodeId), parseVector(row.vector, Number(row.dim)));
      } catch {
        /* non-finite/malformed row never forms an edge */
      }
    }
    if (vectors.size < 2) return { nameMatches, scored };

    const uf = makeUnionFind();
    const ids = [...vectors.keys()];
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        let similarity;
        try {
          similarity = cosineSimilarity(vectors.get(ids[i]), vectors.get(ids[j]));
        } catch {
          continue;
        }
        if (Number.isFinite(similarity) && similarity >= thetaDup) uf.union(ids[i], ids[j]);
      }
    }

    const components = new Map();
    for (const nodeId of rank.keys()) {
      const root = uf.find(nodeId);
      if (!components.has(root)) components.set(root, []);
      components.get(root).push(nodeId);
    }
    const keep = new Set();
    for (const members of components.values()) {
      members.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
      keep.add(members[0]);
    }
    return {
      nameMatches: nameMatches.filter((row) => keep.has(Number(row.nodeId))),
      scored: scored.filter((row) => keep.has(Number(row.nodeId))),
    };
  }

  /**
   * §2.4 restart fallback: bounded `query_parses.listAll` scan re-derives a
   * plain v1 signature's execution material. Delta signatures are not
   * durable (merged atoms/excludes are not persisted) — they degrade.
   */
  async function deriveBaseMaterial(userId, ref, space) {
    const cache = resolveQueryParsesStore();
    if (!cache || typeof cache.listAll !== 'function') return null;
    let after = null;
    let scanned = 0;
    while (scanned < DERIVE_SCAN_LIMIT) {
      let rows;
      try {
        rows = await cache.listAll({ afterNormalizedQuery: after, limit: DERIVE_PAGE_SIZE });
      } catch {
        return null;
      }
      if (!Array.isArray(rows) || rows.length === 0) break;
      for (const row of rows) {
        const normalizedQuery = row.normalizedQuery;
        if (space === SIGNATURE_SPACE) {
          if (buildResultRef({ normalizedQuery }) === ref) {
            return {
              normalizedQuery,
              queryText: normalizedQuery,
              embedText: normalizedQuery,
              segmentSource: normalizedQuery,
              atoms: [],
              excludes: [],
              excludeSimilar: false,
              space: SIGNATURE_SPACE,
              sort: SORT_VERSION,
              parentRef: null,
            };
          }
          continue;
        }
        if (!row.vector) continue;
        const envelope = parseVectorEnvelope(row.vector);
        if (!envelope || envelope.space !== space) continue;
        const parseEnvelope = readParseEnvelope(row.predicates);
        if (parseEnvelope && parseEnvelope.delta) continue;
        const embedText = parseEnvelope?.vectorQuery || normalizedQuery;
        const candidate = buildResultRef({ normalizedQuery, vectorQuery: embedText, space });
        if (candidate !== ref) continue;
        return {
          normalizedQuery,
          queryText: normalizedQuery,
          embedText,
          segmentSource: normalizedQuery,
          atoms: [],
          excludes: [],
          excludeSimilar: false,
          space,
          sort: SORT_VERSION,
          parentRef: null,
        };
      }
      after = rows[rows.length - 1].normalizedQuery;
      scanned += rows.length;
      if (rows.length < DERIVE_PAGE_SIZE) break;
    }
    return null;
  }

  /**
   * Resolve the §2.4 replay material for a `$ref` turn. The process-local
   * registry is authoritative; a miss falls back to the bounded query_parses
   * derivation. Space/sort mismatch is NEVER replayed (silent fallback).
   */
  async function resolveBaseMaterial(userId, ref, space) {
    const registry = resolveResultRefRegistry();
    const entry =
      registry && typeof registry.resolve === 'function' ? registry.resolve(userId, ref) : null;
    if (entry) {
      if (entry.space !== space || entry.sort !== SORT_VERSION) return null;
      return entry;
    }
    return deriveBaseMaterial(userId, ref, space);
  }

  function registerExecutionRef(userId, ref, material) {
    const registry = resolveResultRefRegistry();
    if (registry && typeof registry.register === 'function')
      registry.register(userId, ref, material);
  }

  function hasPathAtoms(atomLists) {
    return atomLists.some(
      (list) =>
        Array.isArray(list) &&
        list.some((atom) => atom && typeof atom === 'object' && atom.type === 'path')
    );
  }

  async function search(userId, { query, resultRef, predicates } = {}) {
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

    const adapter = resolveLlmAdapter();
    const gate = await resolveSemanticGate(adapter);

    // §2.3 step 3a — NL parse (ONE chat call MAX, cached; silent fallback).
    const parsed = await runParseLeg(adapter, normalizedQuery, predicates);
    const recognizedDelta = parsed && parsed.delta ? parsed.delta : null;

    // §2.3 step 3b — structure + replay binding. Any structural failure
    // discards the WHOLE parse output (parser-free shape, never a 4xx).
    let structured = null;
    let baseEntry = null;
    let structuralFallback = false;
    if (recognizedDelta) {
      let baseRef = null;
      if (recognizedDelta.ref === 'latest') {
        if (typeof resultRef !== 'string' || !RESULT_REF_PATTERN.test(resultRef)) {
          structuralFallback = true;
        } else {
          baseRef = resultRef;
          baseEntry = await resolveBaseMaterial(userId, baseRef, gate.space);
          if (!baseEntry) structuralFallback = true;
        }
      }
      if (!structuralFallback) {
        const baseAtoms = baseEntry ? baseEntry.atoms : validateSessionState(predicates);
        const baseExcludes = baseEntry ? baseEntry.excludes : [];
        const baseExcludeSimilar = baseEntry ? baseEntry.excludeSimilar === true : false;
        const rootPath = hasPathAtoms([
          recognizedDelta.add,
          recognizedDelta.replace,
          recognizedDelta.exclude,
          baseAtoms,
          baseExcludes,
        ])
          ? await resolveUserRootPath(userId)
          : null;
        structured = structureDelta({
          delta: recognizedDelta,
          baseAtoms,
          baseExcludes,
          baseExcludeSimilar,
          requestRef: baseRef,
          rootPath,
        });
        if (structured.degraded) structuralFallback = true;
      }
    }

    const appliedParse = parsed && !structuralFallback ? parsed : null;
    const appliedDelta = appliedParse && recognizedDelta ? recognizedDelta : null;
    const appliedStructured = appliedDelta ? structured : null;

    let nameMatches;
    let nameTruncated;
    let leg;
    let effectiveEmbedText;
    let segmentSource;
    let scored = [];

    if (appliedStructured && appliedStructured.baseRef) {
      // §2.9 `$ref` replay: re-execute the base query (both sections) under
      // CURRENT ACL, then merge/filter. A refined delta vector re-scores only
      // inside the base semantic candidate set.
      const baseName = await executeNameSection(
        userId,
        baseEntry.queryText || baseEntry.normalizedQuery,
        nameLimit
      );
      let baseLeg = await executeSemanticSection(userId, {
        normalizedQuery: baseEntry.normalizedQuery,
        embedText: baseEntry.embedText,
        segmentSource: baseEntry.segmentSource || baseEntry.normalizedQuery,
        gate,
      });
      scored = baseLeg.ran ? baseLeg.scored : [];
      effectiveEmbedText = baseEntry.embedText;
      segmentSource = baseEntry.segmentSource || baseEntry.normalizedQuery;

      if (appliedParse.vectorQuery && baseLeg.ran) {
        const restrictIds = new Set(scored.map((row) => row.nodeId));
        baseLeg = await executeSemanticSection(userId, {
          normalizedQuery: baseEntry.normalizedQuery,
          embedText: appliedParse.vectorQuery,
          segmentSource: appliedParse.vectorQuery,
          gate,
          restrictIds,
        });
        scored = baseLeg.scored;
        effectiveEmbedText = appliedParse.vectorQuery;
        segmentSource = appliedParse.vectorQuery;
      }

      let filtered = await applyStructuredFilters(
        userId,
        { nameMatches: baseName.nameMatches, scored },
        appliedStructured.atoms,
        appliedStructured.excludes
      );
      if (appliedStructured.excludeSimilar) {
        filtered = await applyExcludeSimilar(userId, filtered);
      }
      filtered = await intersectVisible(userId, filtered);

      nameMatches = filtered.nameMatches;
      scored = filtered.scored;
      nameTruncated = baseName.truncated;
      leg = baseLeg;
    } else if (appliedStructured) {
      // §2.9 non-reference delta: normal execution of the utterance, then the
      // same merged filters/subtraction/similarity pass.
      const nameResult = await executeNameSection(userId, trimmed, nameLimit);
      const embedText = appliedParse.vectorQuery || normalizedQuery;
      const semanticLeg = await executeSemanticSection(userId, {
        normalizedQuery,
        embedText,
        segmentSource: normalizedQuery,
        gate,
      });
      let filtered = await applyStructuredFilters(
        userId,
        { nameMatches: nameResult.nameMatches, scored: semanticLeg.ran ? semanticLeg.scored : [] },
        appliedStructured.atoms,
        appliedStructured.excludes
      );
      if (appliedStructured.excludeSimilar) {
        filtered = await applyExcludeSimilar(userId, filtered);
      }
      filtered = await intersectVisible(userId, filtered);

      nameMatches = filtered.nameMatches;
      scored = filtered.scored;
      nameTruncated = nameResult.truncated;
      leg = semanticLeg;
      effectiveEmbedText = semanticLeg.ran ? embedText : normalizedQuery;
      segmentSource = normalizedQuery;
    } else {
      // v1 path (parser-off, plain parse, or structural fallback): byte-shape
      // compatibility is the contract — no delta filters, no extra ACL read.
      const nameResult = await executeNameSection(userId, trimmed, nameLimit);
      const embedText = appliedParse?.vectorQuery || normalizedQuery;
      const semanticLeg = await executeSemanticSection(userId, {
        normalizedQuery,
        embedText,
        segmentSource: normalizedQuery,
        gate,
      });
      nameMatches = nameResult.nameMatches;
      nameTruncated = nameResult.truncated;
      leg = semanticLeg;
      scored = semanticLeg.ran ? semanticLeg.scored : [];
      effectiveEmbedText = semanticLeg.ran ? embedText : '';
      segmentSource = normalizedQuery;
    }

    let semanticRows = [];
    if (leg.ran) {
      try {
        semanticRows = await assembleSemanticRows(
          scored,
          nameMatches.map((row) => row.nodeId),
          semanticLimit
        );
      } catch {
        semanticRows = [];
      }
    }

    const currentSpace = leg.ran ? gate.space : SIGNATURE_SPACE;
    const resultRefValue =
      appliedDelta && appliedStructured
        ? buildDeltaResultRef({
            baseRef: appliedStructured.baseRef || '',
            normalizedQuery,
            vectorQuery: leg.ran ? effectiveEmbedText : '',
            atoms: appliedStructured.atoms,
            excludes: appliedStructured.excludes,
            excludeSimilar: appliedStructured.excludeSimilar,
            space: currentSpace,
            sort: SORT_VERSION,
          })
        : leg.ran
          ? buildResultRef({ normalizedQuery, vectorQuery: effectiveEmbedText, space: gate.space })
          : buildResultRef({ normalizedQuery });

    const registryMaterial = appliedDelta
      ? {
          userId,
          normalizedQuery: appliedStructured.baseRef ? baseEntry.normalizedQuery : normalizedQuery,
          queryText: appliedStructured.baseRef
            ? baseEntry.queryText || baseEntry.normalizedQuery
            : trimmed,
          embedText: leg.ran
            ? effectiveEmbedText
            : appliedStructured.baseRef
              ? baseEntry.embedText
              : normalizedQuery,
          segmentSource: appliedStructured.baseRef ? segmentSource : normalizedQuery,
          atoms: appliedStructured.atoms,
          excludes: appliedStructured.excludes,
          excludeSimilar: appliedStructured.excludeSimilar,
          space: currentSpace,
          sort: SORT_VERSION,
          parentRef: appliedStructured.baseRef || null,
        }
      : {
          userId,
          normalizedQuery,
          queryText: trimmed,
          embedText: leg.ran ? effectiveEmbedText : normalizedQuery,
          segmentSource,
          atoms: [],
          excludes: [],
          excludeSimilar: false,
          space: currentSpace,
          sort: SORT_VERSION,
          parentRef: null,
        };
    registerExecutionRef(userId, resultRefValue, registryMaterial);

    scheduleSearchHitEvents(userId, [
      ...nameMatches.map((row) => row.nodeId),
      ...semanticRows.map((row) => row.nodeId),
    ]);

    return {
      nameMatches,
      ...(leg.ran ? { semantic: semanticRows } : {}),
      // §2.8: present EXACTLY when the parse applied (possibly empty atoms);
      // absent keeps the response byte-identical to the parser-free contract.
      ...(appliedParse ? { predicates: appliedParse.atoms } : {}),
      // §2.9: additive delta header — only when a parsed delta was applied.
      ...(appliedDelta ? { delta: appliedDelta, sessionPredicates: appliedStructured.atoms } : {}),
      resultRef: resultRefValue,
      counts: {
        name: nameMatches.length,
        semantic: semanticRows.length,
        total: nameMatches.length + semanticRows.length,
        nameTruncated,
        ...(leg.ran ? { semanticCappedSegments: leg.cappedSegments } : {}),
      },
      ...(leg.ran
        ? {}
        : {
            semanticUnavailableReason: leg.reason || SEMANTIC_UNAVAILABLE_REASON.NOT_CONFIGURED,
          }),
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
  DERIVE_SCAN_LIMIT,
};
