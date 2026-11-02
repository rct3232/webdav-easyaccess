'use strict';

/**
 * Process-wide vectorStore singleton (vectorStore.md §2.1, PLAN §28.2.1).
 * Same instance idiom as infrastructure/llmAdapterRuntime: boot initializes,
 * consumers read, tests reset.
 *
 * The active embed model + runtime dim are derived at init time exactly like
 * semanticScorer/nearDupFinderService derive their profile constants: the
 * registry row (`llmModelsStore.getActiveByRole('embed')`) keys the manifest
 * preset (`getPresetByFamilyRole(model.provider, 'embed')`) and the preset
 * profile owns the dim (llm_models has NO dim column — DDL 001; per-row dim
 * lives on `embeddings.dim`).
 *
 * No lazy construction: getVectorStore() returns null before boot init (or
 * after a failed init / no active embed model). Readers treat null as "use
 * the JsFallback" — AI absence is data, never an error.
 */

const { createVectorStoreForBoot } = require('./vectorStore');
const { createTextVectorJs } = require('./vectorStore/TextVectorJs');

let instance = null;

function defaultModelsStore() {
  return require('../../store/llmModelsStore');
}

function defaultPresets() {
  return require('../../infrastructure/adapters/llm/presets');
}

function defaultStorage() {
  return require('../../store/storage');
}

function defaultHealth() {
  return require('../../infrastructure/backendHealth').getBackendHealth();
}

/**
 * Canonical TEXT loader for the engine (vectorStore.md §2.2): pooled rows +
 * chunk rows for the bound model space, each row `{ nodeId, chunkIdx, dim,
 * vector }` (dim rides the POOLED row — chunk rows carry no dim; the space dim
 * is uniform per space). Mirrors semanticScorer.buildLoadRows: ACL rides the
 * `candidates` argument of every neighbors call, never post-filtering.
 */
function createLoadRows({ embeddingsStore, embeddingsChunkStore, modelId }) {
  const pooledStore = embeddingsStore || require('../../store/embeddingsStore');
  const chunkStore = embeddingsChunkStore || require('../../store/embeddingsChunkStore');

  return async function loadRows(boundModelId) {
    if (Number(boundModelId) !== Number(modelId)) return [];
    const [pooledRows, chunkRows] = await Promise.all([
      pooledStore.listAll(modelId),
      chunkStore.listAllByModel(modelId),
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
 * Init the singleton from the active embed model. Safe to call at boot and on
 * an active-model change (the caller resets first — stale-dim rebuild is the
 * adapter's init(): atttypmod for PG, user_version for vec0).
 *
 * @param {Object} [deps]
 * @param {Object} [deps.llmModelsStore] active-model registry seam
 * @param {Object} [deps.presets] manifest seam (`getPresetByFamilyRole`)
 * @param {Object} [deps.storage] storage seam (`getExecutor`/`getSqliteConnection`)
 * @param {Object} [deps.health] backendHealth tracker (`report` seam)
 * @param {Object} [deps.embeddingsStore] canonical pooled rows
 * @param {Object} [deps.embeddingsChunkStore] canonical chunk rows
 * @param {Function} [deps.createStore] factory seam (`createVectorStore`)
 * @returns {Promise<Object|null>} the installed store, or null (no model/failure)
 */
async function initVectorStore(deps = {}) {
  const models = deps.llmModelsStore || defaultModelsStore();
  const presets = deps.presets || defaultPresets();
  const storage = deps.storage || defaultStorage();
  const health = deps.health || defaultHealth();
  const createStore = deps.createStore || createVectorStoreForBoot;

  const model = await models.getActiveByRole('embed');
  if (!model || model.id == null) {
    instance = null;
    return null;
  }

  const modelId = Number(model.id);
  const preset = presets.getPresetByFamilyRole(model.provider, 'embed');
  const profileDim = Number(preset?.profile?.dim);
  const dim = Number.isInteger(profileDim) && profileDim > 0 ? profileDim : null;

  const executor = storage.getExecutor();
  const sqliteDb =
    executor && executor.dialect === 'sqlite' && typeof storage.getSqliteConnection === 'function'
      ? storage.getSqliteConnection()
      : null;

  const loadRows = createLoadRows({
    embeddingsStore: deps.embeddingsStore,
    embeddingsChunkStore: deps.embeddingsChunkStore,
    modelId,
  });

  const store = await createStore({
    executor,
    modelId,
    dim,
    health,
    loadRows,
    sqliteDb,
  });

  instance = store || null;
  return instance;
}

/** The installed store, or null before boot init / when no embed model is active. */
function getVectorStore() {
  return instance;
}

/**
 * Engine resolution for reader seams: the installed native store when present,
 * else the JsFallback bound to the caller's model/loader (the pre-C6 behavior,
 * kept for tests and pre-boot calls).
 */
function getVectorStoreOrFallback(modelId, loadRows) {
  if (instance) return instance;
  return createTextVectorJs({ modelId, loadRows });
}

/** Test seam: drop the installed store (the next init rebuilds it). */
function resetVectorStore() {
  instance = null;
}

module.exports = {
  initVectorStore,
  getVectorStore,
  getVectorStoreOrFallback,
  resetVectorStore,
  createLoadRows,
};
