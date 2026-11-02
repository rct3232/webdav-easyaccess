'use strict';

// vectorStore seam factory (vectorStore.md §2.1-§2.3): the ONE engine
// selection point. Exactly two implementation families behind one interface —
// Native adapters (PgVector / SqliteVec) and the JsFallback (TextVectorJs).
//
// Selection order (BOOT-FROZEN, §1/§3):
//   postgres ∧ pgvector ≥ 0.7   → PgVector
//   sqlite   ∧ sqlite-vec load  → SqliteVec
//   anything else / failure     → TextVectorJs
//
// Absent capability NEVER blocks the AI surface (§1 policy): the factory
// reports a degraded `vector` row through backendHealth with an install hint
// and returns the JS fallback. All features stay ON.
//
// Besides the §2.2 engine interface, the factory exposes `hooks` in the
// embed pipeline's tx-first shape ({ transaction, upsertPooled, replaceChunks })
// so the pooled half, chunk half and derived shadow sync commit in ONE
// transaction. The hooks write the canonical TEXT rows directly on the tx
// handle (the repository twins' exact statements) and delegate the shadow
// half to the selected engine.
//
// The derived artifacts themselves (pg shadow table / vec0 virtual table) are
// adapter-managed and never part of the tracked DDL chain (§2.4).

const { AsyncLocalStorage } = require('node:async_hooks');

const { serializeVector } = require('./vectorMath');
const { createTextVectorJs } = require('./TextVectorJs');
const { createPgVector, probePgVector } = require('./PgVector');
const { createSqliteVec } = require('./SqliteVec');

const VECTOR_HEALTH_KEY = 'vector';
const FALLBACK_HINT =
  'install pgvector ≥ 0.7 (CREATE EXTENSION vector) or the sqlite-vec loadable extension';

/**
 * Canonical write hooks in the pipeline's tx-first shape. The statement text
 * is mirrored bit-for-bit from the repository twins (sqlite/Embeddings
 * Repository.sqlite.js:35-45) so a degraded JsFallback sink stays a legal
 * write path. The executor is resolved once per factory (boot-frozen).
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 */
function createCanonicalHooks(executor) {
  const isPostgres = executor.dialect === 'postgres';
  const p = isPostgres ? (i) => `$${i + 1}` : () => '?';
  const POOLED_SQL = `INSERT INTO embeddings (node_id, model_id, dim, vector, source, content_hash, updated_at)
       VALUES (${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, CURRENT_TIMESTAMP)
       ON CONFLICT(node_id) DO UPDATE SET
         model_id = excluded.model_id,
         dim = excluded.dim,
         vector = excluded.vector,
         source = excluded.source,
         content_hash = excluded.content_hash,
         updated_at = CURRENT_TIMESTAMP`;
  const CHUNK_DELETE_SQL = isPostgres
    ? 'DELETE FROM embeddings_chunk WHERE node_id = $1 AND model_id = $2'
    : 'DELETE FROM embeddings_chunk WHERE node_id = ? AND model_id = ?';
  const CHUNK_INSERT_SQL = `INSERT INTO embeddings_chunk (node_id, chunk_idx, model_id, vector, updated_at)
       VALUES (${p(0)}, ${p(1)}, ${p(2)}, ${p(3)}, CURRENT_TIMESTAMP)
       ON CONFLICT (node_id, chunk_idx) DO UPDATE SET
         vector = excluded.vector,
         model_id = excluded.model_id,
         updated_at = CURRENT_TIMESTAMP`;

  return {
    transaction: (fn) => executor.transaction(fn),

    async upsertPooled(tx, row) {
      await tx.run(POOLED_SQL, [
        Number(row.nodeId),
        Number(row.modelId),
        Number(row.dim),
        row.vector,
        row.source,
        row.contentHash ?? null,
      ]);
    },

    async replaceChunks(tx, nodeId, modelId, vectorTexts) {
      await tx.run(CHUNK_DELETE_SQL, [Number(nodeId), Number(modelId)]);
      for (let chunkIdx = 0; chunkIdx < vectorTexts.length; chunkIdx++) {
        await tx.run(CHUNK_INSERT_SQL, [
          Number(nodeId),
          chunkIdx,
          Number(modelId),
          vectorTexts[chunkIdx],
        ]);
      }
    },
  };
}

/**
 * sqlite-vec availability probe (vec0 loadable on the open handle). Absent
 * binary/handle is the supported degrade path — never throws.
 */
function probeSqliteVec(db) {
  if (!db) {
    return {
      available: false,
      reason: 'sqliteConnectionUnavailable',
      hint: 'sqlite-vec requires the node:sqlite connection',
    };
  }
  try {
    // eslint-disable-next-line global-require
    const vecLoader = require('sqlite-vec');
    db.enableLoadExtension(true);
    vecLoader.load(db);
    return { available: true, reason: null, hint: null };
  } catch (error) {
    return {
      available: false,
      reason: error?.code || 'vec0Unavailable',
      hint: 'install the sqlite-vec loadable extension (≥ 0.1.9)',
    };
  }
}

/**
 * Capability probe only (no engine construction). Used by the boot helper and
 * the factory; injectable probes keep the selection matrix hermetic.
 *
 * @returns {Promise<{ engine: 'pgvector'|'sqlite-vec'|'js', available: boolean, reason: string|null, hint: string|null, version?: string|null }>}
 */
async function probeVectorCapability({
  executor,
  sqliteDb,
  probePg = probePgVector,
  probeSqlite = probeSqliteVec,
} = {}) {
  if (!executor) {
    return {
      engine: 'js',
      available: false,
      reason: 'executorUnavailable',
      hint: FALLBACK_HINT,
    };
  }

  if (executor.dialect === 'postgres') {
    try {
      const probe = await probePg(executor);
      if (probe.available) {
        return {
          engine: 'pgvector',
          available: true,
          reason: null,
          hint: null,
          version: probe.version ?? null,
        };
      }
      return {
        engine: 'js',
        available: false,
        reason: 'pgvectorUnavailable',
        hint: probe.hint || FALLBACK_HINT,
        version: probe.version ?? null,
      };
    } catch (error) {
      return {
        engine: 'js',
        available: false,
        reason: error?.code || 'pgvectorProbeFailed',
        hint: FALLBACK_HINT,
      };
    }
  }

  if (executor.dialect === 'sqlite') {
    const probe = probeSqlite(sqliteDb);
    if (probe.available) {
      return { engine: 'sqlite-vec', available: true, reason: null, hint: null };
    }
    return {
      engine: 'js',
      available: false,
      reason: probe.reason || 'vec0Unavailable',
      hint: probe.hint || FALLBACK_HINT,
    };
  }

  return {
    engine: 'js',
    available: false,
    reason: 'unsupportedDialect',
    hint: FALLBACK_HINT,
  };
}

/**
 * Build the pipeline write hooks for the selected engine. Canonical halves run
 * on the caller's tx handle; the shadow half (PgVector) is synced on the SAME
 * handle after the chunk half, so a failure rolls back all three (§2.2).
 * SqliteVec's shadow is lazily re-synced from canonical TEXT (§2.4a), and the
 * JsFallback has no shadow (§2.4) — both are no-ops here.
 */
function createPipelineHooks({ engine, canonical }) {
  const txState = new WeakMap();

  async function transaction(fn) {
    return canonical.transaction(async (tx) => {
      txState.set(tx, {});
      try {
        return await fn(tx);
      } finally {
        txState.delete(tx);
      }
    });
  }

  async function upsertPooled(tx, row) {
    await canonical.upsertPooled(tx, row);
    const state = tx && typeof tx === 'object' ? txState.get(tx) : null;
    if (state) state.pooled = row;
  }

  async function replaceChunks(tx, nodeId, modelId, vectorTexts) {
    await canonical.replaceChunks(tx, nodeId, modelId, vectorTexts);
    if (!engine || typeof engine.syncShadow !== 'function') return;
    const state = tx && typeof tx === 'object' ? txState.get(tx) : null;
    const pooled = state && state.pooled;
    if (!pooled) return;
    if (Number(pooled.nodeId) !== Number(nodeId) || Number(pooled.modelId) !== Number(modelId)) {
      return;
    }
    await engine.syncShadow(tx, nodeId, pooled.vector, vectorTexts);
  }

  return { transaction, upsertPooled, replaceChunks };
}

/**
 * Seam factory. Selects the engine at boot, brings the derived artifact up
 * (PgVector), reports the `vector` health row and returns the §2.2 interface
 * plus the pipeline write hooks.
 *
 * @param {Object} opts
 * @param {import('../../infrastructure/db/executor').DbExecutor} opts.executor
 * @param {number|string} opts.modelId active embed space key
 * @param {number|null} opts.dim active model runtime dim (PgVector binds it)
 * @param {Object} [opts.health] backendHealth tracker (`report` seam)
 * @param {(modelId: number, userScope: unknown) => Promise<Array>} opts.loadRows
 * @param {Object} [opts.hooks] canonical write hooks override (pipeline shape)
 * @param {Object} [opts.sqliteDb] open node:sqlite handle (sqlite dialect)
 * @param {Function} [opts.probePg] probePgVector seam (tests)
 * @param {Function} [opts.probeSqlite] probeSqliteVec seam (tests)
 * @param {Function} [opts.createPg] PgVector factory seam (tests)
 * @param {Function} [opts.createSqlite] SqliteVec factory seam (tests)
 * @returns {Promise<{ impl: 'native'|'fallback_js', engine: string, upsert: Function, neighbors: Function, allVectors: Function, rebuildShadow: Function, hooks: Object, capability: Object }>}
 */
async function createVectorStore({
  executor,
  modelId,
  dim,
  health,
  loadRows,
  hooks,
  sqliteDb,
  probePg = probePgVector,
  probeSqlite = probeSqliteVec,
  createPg = createPgVector,
  createSqlite = createSqliteVec,
} = {}) {
  if (!modelId) throw new Error('createVectorStore requires a bound modelId (space key)');
  if (typeof loadRows !== 'function') throw new Error('createVectorStore requires loadRows');

  const normalizedDim = Number(dim);
  const boundDim = Number.isInteger(normalizedDim) && normalizedDim > 0 ? normalizedDim : null;
  const canonical = hooks || createCanonicalHooks(executor);

  // Adapter write deps are non-tx-first (`{ row }`, `(nodeId, vectors)`); the
  // active transaction handle is carried per async context so the adapter's own
  // `upsert` stays usable while the writes still ride the caller's tx.
  const txContext = new AsyncLocalStorage();
  function currentTx() {
    const tx = txContext.getStore();
    if (!tx) throw new Error('vectorStore write outside a transaction');
    return tx;
  }
  const adapterWrites = {
    upsertPooled: (row) => canonical.upsertPooled(currentTx(), row),
    replaceChunks: (nodeId, vectorTexts) =>
      canonical.replaceChunks(currentTx(), nodeId, modelId, vectorTexts),
    transaction: (fn) => canonical.transaction((tx) => txContext.run(tx, () => fn(tx))),
  };

  const capability = await probeVectorCapability({
    executor,
    sqliteDb,
    probePg,
    probeSqlite,
  });

  let engine = null;
  let impl = 'fallback_js';
  let engineName = 'js';

  const report = (row) => {
    if (health && typeof health.report === 'function') {
      health.report(VECTOR_HEALTH_KEY, row);
    }
  };

  if (capability.available && capability.engine === 'pgvector' && !boundDim) {
    capability.reason = 'dimUnavailable';
    capability.hint = 'the active model profile has no runtime dim (llmPresets profile.dim)';
  }

  if (capability.available && capability.engine === 'pgvector' && boundDim) {
    try {
      engine = createPg({
        modelId,
        dim: boundDim,
        executor,
        loadRows,
        ...adapterWrites,
      });
      if (typeof engine.init === 'function') await engine.init();
      impl = 'native';
      engineName = 'pgvector';
    } catch (error) {
      engine = null;
      capability.reason = error?.code || 'pgvectorInitFailed';
      capability.hint = capability.hint || FALLBACK_HINT;
    }
  } else if (capability.available && capability.engine === 'sqlite-vec') {
    try {
      engine = createSqlite({
        modelId,
        db: sqliteDb,
        loadRows,
        ...adapterWrites,
      });
      impl = 'native';
      engineName = 'sqlite-vec';
    } catch (error) {
      engine = null;
      capability.reason = error?.code || 'vec0Unavailable';
      capability.hint = capability.hint || FALLBACK_HINT;
    }
  }

  if (!engine) {
    engine = createTextVectorJs({
      modelId,
      loadRows,
      ...adapterWrites,
    });
    impl = 'fallback_js';
    engineName = 'js';
    report({
      ok: false,
      reason: capability.reason || 'fallback_js',
      hint: capability.hint || FALLBACK_HINT,
    });
  } else {
    report({ ok: true });
  }

  const pipelineHooks = createPipelineHooks({ engine, canonical });

  /**
   * §2.2 write: pooled = vecs[0], chunks = vecs.slice(1), canonical + shadow
   * in ONE transaction.
   */
  async function upsert(nodeId, vecs, upsertDim) {
    if (!Array.isArray(vecs) || vecs.length === 0) {
      throw new Error('upsert requires at least the pooled vector');
    }
    const [pooled, ...chunks] = vecs;
    const writeDim =
      Number.isInteger(Number(upsertDim)) && Number(upsertDim) > 0 ? Number(upsertDim) : boundDim;
    await pipelineHooks.transaction(async (tx) => {
      await pipelineHooks.upsertPooled(tx, {
        nodeId,
        modelId,
        dim: writeDim,
        vector: serializeVector(pooled),
        source: 'chunk_pool',
        contentHash: null,
      });
      await pipelineHooks.replaceChunks(
        tx,
        nodeId,
        modelId,
        chunks.map((vector) => serializeVector(vector))
      );
    });
  }

  return {
    impl,
    engine: engineName,
    upsert,
    neighbors: (vec, k, candidates) => engine.neighbors(vec, k, candidates),
    allVectors: (userScope) => engine.allVectors(userScope),
    rebuildShadow: () => engine.rebuildShadow(),
    hooks: pipelineHooks,
    capability,
  };
}

/**
 * Boot helper: probe + construct in one call. Any probe error degrades to the
 * JsFallback (never throws — boot is never blocked).
 */
async function createVectorStoreForBoot(opts = {}) {
  try {
    return await createVectorStore(opts);
  } catch (error) {
    if (opts.health && typeof opts.health.report === 'function') {
      opts.health.report(VECTOR_HEALTH_KEY, {
        ok: false,
        reason: error?.code || error?.message || 'vectorStoreInitFailed',
        hint: FALLBACK_HINT,
      });
    }
    return null;
  }
}

module.exports = {
  VECTOR_HEALTH_KEY,
  FALLBACK_HINT,
  createCanonicalHooks,
  probeSqliteVec,
  probeVectorCapability,
  createVectorStore,
  createVectorStoreForBoot,
};
