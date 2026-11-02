'use strict';

/**
 * semanticScorer — the DEFAULT scorer behind the searchService §2.5a seam
 * (searchService.md §2.3 steps 5–6). Segment-AND (MIN across segments) +
 * per-node max-over-chunks + per-query dynamic baseline gate.
 *
 * Scoring rides the vectorStore seam (vectorStore.md §2.2): every per-segment
 * `neighbors` call is engine-side ranked over the requester's visible set
 * (ACL anchoring rides the `candidates` argument — a node the requester
 * cannot read never reaches a score). The default engine binds TextVectorJs
 * (the JsFallback); the `engineFactory` seam is the production swap point for
 * the boot factory (vectorStore.md §2.3).
 *
 * Per segment: `neighbors(segVec, k=50, visibleIds)` — per-node max-over-chunks
 * cosine (the seam contract: chunk rows rank the node, pooled row otherwise).
 * Document score = MIN across segments (segment-AND). Dynamic baseline gate:
 * the SAME segment vectors are scored against a sample of the requester's
 * visible corpus drawn EXCLUDING the candidate set; `spread` = the sample's max
 * min-across-segments score; keep results only if top candidate score ≥
 * `spread + δ_base` (the model profile `deltaBase` — read at gate time, never
 * hardcoded). The gate rejected ⇒ the section is returned HONESTLY EMPTY.
 */

const { createTextVectorJs } = require('./vectorStore/TextVectorJs');

/** Per-segment candidate cut cap (searchService.md §2.3 step 5 — k=50). */
const DEFAULT_K_PER_SEGMENT = 50;

/** Baseline sample size (searchService.md §2.3 step 6 — default 500). */
const DEFAULT_BASELINE_SAMPLE_DOCS = 500;

/**
 * Factory. All IO through DI seams — tests inject fakes; the default instance
 * resolves the shared seams lazily (searchService precedent).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - ACL seam (default: store/fileNodesStore).
 * @param {Object} [opts.embeddingsStore] - canonical pooled rows (default: store/embeddingsStore).
 * @param {Object} [opts.embeddingsChunkStore] - canonical chunk rows (default: store/embeddingsChunkStore).
 * @param {Object} [opts.llmModelsStore] - active-model seam (default: store/llmModelsStore).
 * @param {Object} [opts.presets] - manifest seam exposing getPresetByFamilyRole
 *   (default: infrastructure/adapters/llm/presets).
 * @param {(modelId: number, loadRows: Function) => Object} [opts.engineFactory]
 *   - vectorStore seam factory (default: TextVectorJs bound to the model id).
 * @param {Object} [opts.configResolver] - seam exposing getConfig(key);
 *   `BASELINE_SAMPLE_DOCS` is read per `score()` call so the T2/dbOnly knob is
 *   hot. Absent seam ⇒ the factory fallback applies.
 * @param {number} [opts.kPerSegment] - per-segment candidate cut cap (default 50).
 * @param {number} [opts.baselineSampleDocs] - baseline sample size fallback
 *   when the config value is missing/non-numeric (default 500).
 */
function createSemanticScorer({
  fileNodesStore,
  embeddingsStore: pooledStore,
  embeddingsChunkStore: chunkStore,
  llmModelsStore: modelsStore,
  presets: presetsModule,
  engineFactory,
  configResolver,
  kPerSegment = DEFAULT_K_PER_SEGMENT,
  baselineSampleDocs = DEFAULT_BASELINE_SAMPLE_DOCS,
} = {}) {
  function resolveFileNodesStore() {
    if (fileNodesStore) return fileNodesStore;
    return require('../../store/fileNodesStore').createFileNodesStore();
  }

  function resolvePooledStore() {
    if (pooledStore) return pooledStore;
    return require('../../store/embeddingsStore');
  }

  function resolveChunkStore() {
    if (chunkStore) return chunkStore;
    return require('../../store/embeddingsChunkStore');
  }

  function resolveModelsStore() {
    if (modelsStore) return modelsStore;
    return require('../../store/llmModelsStore');
  }

  function resolvePresets() {
    if (presetsModule) return presetsModule;
    return require('../../infrastructure/adapters/llm/presets');
  }

  function resolveEngine(modelId, loadRows) {
    if (engineFactory) return engineFactory(modelId, loadRows);
    return createTextVectorJs({ modelId, loadRows });
  }

  /**
   * Per-call `BASELINE_SAMPLE_DOCS` read (searchService.md §3): the T2/dbOnly
   * value is hot — an operator change applies to the next score() without a
   * restart. Missing/non-numeric/≤0 config falls back to the factory default
   * (500).
   */
  async function resolveBaselineSampleDocs() {
    if (!configResolver || typeof configResolver.getConfig !== 'function') {
      return baselineSampleDocs;
    }
    let raw;
    try {
      raw = await configResolver.getConfig('BASELINE_SAMPLE_DOCS');
    } catch {
      return baselineSampleDocs;
    }
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return baselineSampleDocs;
    return Math.floor(value);
  }

  /**
   * Canonical TEXT loader for the engine (vectorStore.md §2.2): pooled rows
   * + chunk rows for the bound model space, each row shaped
   * `{ nodeId, chunkIdx, dim, vector }` — `vector` is the canonical TEXT
   * (deserialize happens at the repository boundary), `dim` rides the POOLED
   * row (chunk rows carry no dim; the space dim is uniform per space).
   * `userScope` is unused — ACL rides the `candidates` argument of every
   * `neighbors` call (the §2.5a seam contract), never post-filtering.
   */
  function buildLoadRows(modelId) {
    return async function loadRows(boundModelId) {
      if (Number(boundModelId) !== Number(modelId)) return [];
      const [pooledRows, chunkRows] = await Promise.all([
        resolvePooledStore().listAll(modelId),
        resolveChunkStore().listAllByModel(modelId),
      ]);
      const dimByNode = new Map(pooledRows.map((row) => [Number(row.nodeId), Number(row.dim)]));
      const rows = [];
      for (const row of pooledRows) {
        rows.push({
          nodeId: Number(row.nodeId),
          chunkIdx: null,
          dim: Number(row.dim),
          vector: row.vector,
        });
      }
      for (const row of chunkRows) {
        const dim = dimByNode.get(Number(row.nodeId));
        if (dim === undefined) continue; // orphan chunk rows never score
        rows.push({
          nodeId: Number(row.nodeId),
          chunkIdx: Number(row.chunkIdx),
          dim,
          vector: row.vector,
        });
      }
      return rows;
    };
  }

  /**
   * §2.5a scoring seam: `{ userId, queryVec, segmentVecs, sampleFn, candidateIds? }`
   * → `[{ nodeId, score }]` sorted score desc then nodeId asc.
   *
   * `candidateIds` is the §2.9 replay restriction: when present, the candidate
   * cut/scoring universe is the intersection of that set with the requester's
   * CURRENT visible set (ACL still wins). The dynamic baseline sample remains
   * drawn from the full visible corpus, excluding the candidate set.
   */
  async function score({ userId, segmentVecs, sampleFn, candidateIds = null }) {
    if (!Array.isArray(segmentVecs) || segmentVecs.length === 0) return [];

    // Cheap in-memory early-outs first (model identity + the gate's δ_base are
    // config, not corpus state): an ungated result is a spec violation, so a
    // missing profile field degrades to honestly empty before any DB read.
    const model = await resolveModelsStore().getActiveByRole('embed');
    if (!model) return [];

    const profile = resolvePresets().getPresetByFamilyRole(model.provider, 'embed')?.profile;
    const deltaBase = Number(profile?.deltaBase);
    if (!Number.isFinite(deltaBase)) return []; // ungated results are a spec violation

    const store = resolveFileNodesStore();
    const root = await store.getUserRootNode(Number(userId));
    if (!root) return [];

    const visibleIds = await store.listVisibleFileNodeIds(Number(userId));
    const visibleSet = new Set(visibleIds.map(Number));
    if (visibleSet.size === 0) return [];

    // §2.9 replay restriction: ACL wins first, then the base-candidate universe.
    let universe = visibleSet;
    if (candidateIds) {
      const restrict = candidateIds instanceof Set ? candidateIds : new Set(candidateIds);
      universe = new Set(
        [...restrict].map(Number).filter((id) => Number.isFinite(id) && visibleSet.has(id))
      );
      if (universe.size === 0) return [];
    }

    const engine = resolveEngine(model.id, buildLoadRows(model.id));

    // Step 1 — per-segment candidate cut: top-k per segment over the universe.
    const candidateIdsFound = new Set();
    for (const segVec of segmentVecs) {
      const rows = await engine.neighbors(segVec, kPerSegment, universe);
      for (const row of rows) candidateIdsFound.add(Number(row.nodeId));
    }
    if (candidateIdsFound.size === 0) return [];

    // Step 2 — baseline sample: random visible ids, EXCLUDING the candidate set
    // (§2.3 step 6: an unrestricted sample contains the true top candidate often
    // enough to pin the margin to zero). sampleFn failure ⇒ no baseline evidence
    // ⇒ the gate cannot pass honestly ⇒ return [] (§2.5a: never ungated).
    let sampleIds = [];
    try {
      const raw = await sampleFn(await resolveBaselineSampleDocs());
      sampleIds = (Array.isArray(raw) ? raw : [])
        .map(Number)
        .filter((id) => Number.isFinite(id) && !candidateIdsFound.has(id) && visibleSet.has(id));
    } catch {
      return [];
    }
    const sampleSet = new Set(sampleIds);

    // Step 3 — exact score pass over candidates ∪ sample (one call per segment,
    // k = the set size, so every scored node's exact per-segment score is known).
    const scoreSet = new Set([...candidateIdsFound, ...sampleSet]);
    const segmentScoreMaps = [];
    for (const segVec of segmentVecs) {
      const rows = await engine.neighbors(segVec, scoreSet.size, scoreSet);
      const map = new Map();
      for (const row of rows) map.set(Number(row.nodeId), Number(row.score));
      segmentScoreMaps.push(map);
    }

    // Step 4 — document score = MIN across segments (segment-AND). A node
    // missing from ANY segment's exact pass cannot be scored honestly — it is
    // dropped (its per-segment evidence is incomplete).
    const docScores = new Map();
    for (const nodeId of scoreSet) {
      if (!segmentScoreMaps.every((map) => map.has(nodeId))) continue;
      docScores.set(nodeId, Math.min(...segmentScoreMaps.map((map) => map.get(nodeId))));
    }

    const candidateScores = [...candidateIdsFound]
      .map((nodeId) => ({ nodeId, score: docScores.get(nodeId) }))
      .filter((row) => Number.isFinite(row.score));
    if (candidateScores.length === 0) return [];

    // Step 5 — dynamic baseline gate: spread = the sample's max
    // min-across-segments score (0 when the sample is empty — the gate
    // degenerates to `top ≥ δ_base`, the ONLY absolute-floor case).
    let spread = 0;
    for (const nodeId of sampleSet) {
      const score = docScores.get(nodeId);
      if (Number.isFinite(score) && score > spread) spread = score;
    }
    const topScore = Math.max(...candidateScores.map((row) => row.score));
    if (topScore < spread + deltaBase) return []; // honestly empty

    candidateScores.sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    return candidateScores;
  }

  return score;
}

module.exports = { createSemanticScorer, DEFAULT_K_PER_SEGMENT, DEFAULT_BASELINE_SAMPLE_DOCS };
