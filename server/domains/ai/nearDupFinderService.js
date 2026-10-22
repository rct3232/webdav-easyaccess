'use strict';

/**
 * nearDupFinderService — the §4.17 vector near-dup variant
 * (docs/spec/server/services/nearDupFinderService.md). Read-only compute over
 * the canonical pooled embeddings of the ACTIVE embed model; feeds the
 * Storage-dashboard `near_duplicates` block and `near_dup` suggestion rows.
 *
 * HASH-FIRST PRECEDENCE (dupFinderService precedent): nodes already grouped
 * as exact dups (equal non-NULL `content_hash`) are removed from the vector
 * candidate set BEFORE grouping — cosine-1.0 detection of hash twins is
 * redundant, so an exact-dup member never appears in near-dup output.
 *
 * θ_dup is read from the ACTIVE model's manifest profile
 * (`presets.js` `profile.thetaDup` — EG2 0.955, llmPresets.md §2.2/§2.3),
 * never hardcoded here. Model absent / profile without a finite θ_dup /
 * fewer than 2 scoped pooled rows ⇒ `available: false` — AI absence is DATA,
 * never an error (§4.12).
 *
 * Scoring rides the vectorStore seam (vectorStore.md §2.2): a `TextVectorJs`
 * engine bound to the active model id runs one `neighbors(own vector)` query
 * per candidate node, with the self id and non-candidates excluded
 * ENGINE-side via the `candidates` predicate (a node never matches itself);
 * scores are f64 `vectorMath.cosineSimilarity` over canonical TEXT rows
 * (vectorStore.md §2.6 exact≡oracle convention). Pooled rows only — no chunk
 * rows. Personal scale: the per-query canonical reload is the sanctioned
 * no-cache-state behavior; ANN adapters swap in behind the same seam.
 */

const { createFileNodesStore } = require('../../store/fileNodesStore');
const { parseVector } = require('./vectorStore/vectorMath');
const { createTextVectorJs } = require('./vectorStore/TextVectorJs');

/** Operational cap of returned near-dup groups (routes/dashboard.md §2.4). */
const MAX_NEAR_DUP_GROUPS = 50;

function emptyResult() {
  return { available: false, groups: [], groupCount: 0, duplicateCount: 0 };
}

function buildDisplayPath(node, byId) {
  const segments = [];
  const seen = new Set();
  let current = node;
  while (current && !seen.has(Number(current.nodeId))) {
    seen.add(Number(current.nodeId));
    segments.unshift(String(current.name));
    current = byId.get(Number(current.parentId));
  }
  return `/${segments.join('/')}`;
}

/** Union-find over numeric node ids (connected components of the ≥θ graph). */
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

function pairKey(a, b) {
  return a < b ? `${a}:${b}` : `${b}:${a}`;
}

/**
 * Factory. All IO through DI seams — tests inject fakes; the default instance
 * resolves the shared seams lazily (searchService precedent).
 *
 * @param {Object} [opts]
 * @param {Object} [opts.fileNodesStore] - subtree/ACL seam (default: store/fileNodesStore).
 * @param {Object} [opts.embeddingsStore] - canonical pooled rows (default: store/embeddingsStore).
 * @param {Object} [opts.llmModelsStore] - active-model seam (default: store/llmModelsStore).
 * @param {Object} [opts.presets] - manifest seam exposing getPresetByFamilyRole
 *   (default: infrastructure/adapters/llm/presets).
 * @param {(modelId: number, loadRows: Function) => Object} [opts.engineFactory]
 *   - vectorStore seam factory (default: TextVectorJs bound to the model id).
 */
function createNearDupFinderService({
  fileNodesStore,
  embeddingsStore: embeddings,
  llmModelsStore: models,
  presets: presetsModule,
  engineFactory,
} = {}) {
  function resolveFileNodesStore() {
    if (fileNodesStore) return fileNodesStore;
    return createFileNodesStore();
  }

  function resolveEmbeddingsStore() {
    if (embeddings) return embeddings;
    return require('../../store/embeddingsStore');
  }

  function resolveModelsStore() {
    if (models) return models;
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
   * Near-dup groups of the requester's own subtree at the profile θ_dup.
   * @param {number|string} userId
   * @returns {Promise<{ available: boolean, groups: Array<{ score: number, nodeIds: number[], filePaths: string[], sizeBytes: number[] }>, groupCount: number, duplicateCount: number }>}
   */
  async function findNearDuplicateGroups(userId) {
    const model = await resolveModelsStore().getActiveByRole('embed');
    if (!model) return emptyResult();

    const profile = resolvePresets().getPresetByFamilyRole(model.provider, 'embed')?.profile;
    const thetaDup = Number(profile?.thetaDup);
    if (!Number.isFinite(thetaDup)) return emptyResult();

    const store = resolveFileNodesStore();
    const root = await store.getUserRootNode(Number(userId));
    if (!root) return emptyResult();

    const rows = await store.listSubtreeCacheRows(root.id);
    const byId = new Map(rows.map((row) => [Number(row.nodeId), row]));

    const fileRows = rows.filter((row) => row.type === 'file');
    const visibleIds = new Set(fileRows.map((row) => Number(row.nodeId)));

    // Hash-first precedence: exact-dup members (≥2 files sharing a non-NULL
    // hash) leave the vector candidate set — the hash pass owns them.
    const hashCounts = new Map();
    for (const row of fileRows) {
      if (row.contentHash === null || row.contentHash === undefined || row.contentHash === '') {
        continue;
      }
      const key = String(row.contentHash);
      hashCounts.set(key, (hashCounts.get(key) || 0) + 1);
    }
    const candidates = new Set(
      [...visibleIds].filter((nodeId) => {
        const row = byId.get(nodeId);
        const hash =
          row && row.contentHash !== null && row.contentHash !== undefined && row.contentHash !== ''
            ? String(row.contentHash)
            : null;
        return hash === null || hashCounts.get(hash) === 1;
      })
    );

    const canonicalRows = (await resolveEmbeddingsStore().listAll(model.id)).filter((row) =>
      candidates.has(Number(row.nodeId))
    );
    if (canonicalRows.length < 2) return emptyResult();

    // Canonical TEXT loader for the engine (pooled rows only — chunkIdx null;
    // max-over-chunks degenerates to the pooled score by construction).
    const loadRows = async (boundModelId /* userScope unused: ACL rides `candidates` */) => {
      const all = await resolveEmbeddingsStore().listAll(boundModelId);
      return all.map((row) => ({
        nodeId: Number(row.nodeId),
        chunkIdx: null,
        dim: row.dim,
        vector: row.vector,
      }));
    };
    const engine = resolveEngine(model.id, loadRows);

    // One neighbors query per candidate node: the engine excludes the self id
    // and non-candidates ENGINE-side (vectorStore.md §2.2) — returned scores
    // are f64 cosine over the canonical TEXT rows (vectorStore.md §2.6).
    const uf = makeUnionFind();
    const pairScores = new Map();
    for (const row of canonicalRows) {
      const selfId = Number(row.nodeId);
      const queryVec = parseVector(row.vector, row.dim);
      const neighbors = await engine.neighbors(
        queryVec,
        candidates.size,
        (nodeId) => Number(nodeId) !== selfId && candidates.has(Number(nodeId))
      );
      for (const { nodeId, score } of neighbors) {
        if (score < thetaDup) continue;
        const otherId = Number(nodeId);
        uf.union(selfId, otherId);
        const key = pairKey(selfId, otherId);
        const prev = pairScores.get(key) || 0;
        if (score > prev) pairScores.set(key, score);
      }
    }

    // Components of size ≥2 become groups; keep rule = smallest node id
    // (dashboard precedent — the rest are near-dup members).
    const components = new Map();
    for (const row of canonicalRows) {
      const nodeId = Number(row.nodeId);
      const rootId = uf.find(nodeId);
      if (!components.has(rootId)) components.set(rootId, []);
      components.get(rootId).push(nodeId);
    }

    const groups = [];
    for (const members of components.values()) {
      if (members.length < 2) continue;
      const nodeIds = members.sort((a, b) => a - b);
      let score = 0;
      for (let i = 0; i < nodeIds.length; i += 1) {
        for (let j = i + 1; j < nodeIds.length; j += 1) {
          const pairScore = pairScores.get(pairKey(nodeIds[i], nodeIds[j])) || 0;
          if (pairScore > score) score = pairScore;
        }
      }
      groups.push({
        score,
        nodeIds,
        filePaths: nodeIds.map((nodeId) => buildDisplayPath(byId.get(nodeId), byId)),
        sizeBytes: nodeIds.map((nodeId) => Number(byId.get(nodeId)?.size) || 0),
      });
    }
    groups.sort((a, b) => b.score - a.score || a.nodeIds[0] - b.nodeIds[0]);
    const capped = groups.slice(0, MAX_NEAR_DUP_GROUPS);

    return {
      available: true,
      groups: capped,
      groupCount: capped.length,
      duplicateCount: capped.reduce((total, group) => total + group.nodeIds.length, 0),
    };
  }

  return { findNearDuplicateGroups };
}

/** Shared default instance (production wiring seam). */
let shared = null;
function getNearDupFinderService() {
  if (!shared) shared = createNearDupFinderService();
  return shared;
}

module.exports = {
  createNearDupFinderService,
  getNearDupFinderService,
  MAX_NEAR_DUP_GROUPS,
};
