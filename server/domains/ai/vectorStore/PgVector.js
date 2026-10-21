'use strict';

// PgVector — the native PostgreSQL engine of the vectorStore seam
// (vectorStore.md §2.3): pgvector ≥ 0.7 with an HNSW index on the adapter-
// managed shadow table `vectorstore_shadow_pg` (§2.4 — a DERIVED ARTIFACT,
// never part of the tracked DDL chain). KNN is pushed into SQL with
// `SET LOCAL hnsw.ef_search = 400` per query — FIXED (§3), never the library
// default 100.
//
// Persistence is INJECTED like TextVectorJs: canonical TEXT reads/writes ride
// the same loader/upsert hooks, `executor` is the postgres DbExecutor for the
// shadow SQL, and `transaction(fn)` runs `fn` inside ONE transaction that
// covers the canonical halves AND the shadow sync — `fn` receives the
// tx-bound executor (a factory wires a client-scoped DbExecutor proxy).
// Absent capability never blocks AI: the boot factory probes with
// probePgVector() and degrades to TextVectorJs with an admin health hint
// (§1 policy — a PERFORMANCE warning, not a state gate).

const { parseVector, serializeVector } = require('./vectorMath');

const SHADOW_TABLE = 'vectorstore_shadow_pg'; // §2.4 — literal fixed for ops runbooks
const HNSW_INDEX = `${SHADOW_TABLE}_hnsw`;
const EF_SEARCH = 400; // §2.3/§3 — fixed in code, never a knob
const OVERSAMPLE_F = 4; // §2.5 default until aclFilter.js consolidation (A7)
const MAX_RETRY_ROUNDS = 3; // adaptive oversample bound — correctness over padding
const REBUILD_BATCH = 100;

/** Canonical comma TEXT → pgvector text literal (`[a,b,c]` — input syntax). */
function toVectorLiteral(text) {
  return `[${text}]`;
}

function isVersionAtLeast07(version) {
  const [major, minor] = String(version).split('.').map(Number);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  return major > 0 || (major === 0 && minor >= 7);
}

/**
 * Boot probe for the seam factory: reports pgvector availability and version
 * from the catalogs (read-only; never throws for "absent" — absence is the
 * supported degrade path). `available` is true only for pgvector ≥ 0.7.
 */
async function probePgVector(executor) {
  const installed = await executor.query(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`
  );
  if (installed.rows.length > 0) {
    const version = String(installed.rows[0].extversion);
    return {
      installed: true,
      available: isVersionAtLeast07(version),
      version,
      hint: isVersionAtLeast07(version) ? null : 'upgrade pgvector to ≥ 0.7',
    };
  }
  const installable = await executor.query(
    `SELECT default_version FROM pg_available_extensions WHERE name = 'vector'`
  );
  if (installable.rows.length > 0) {
    return {
      installed: false,
      available: false,
      version: String(installable.rows[0].default_version),
      hint: 'CREATE EXTENSION vector (pgvector ≥ 0.7 required)',
    };
  }
  return {
    installed: false,
    available: false,
    version: null,
    hint: 'install the pgvector extension (pgvector ≥ 0.7) on this PostgreSQL server',
  };
}

/**
 * @param {Object} deps
 * @param {number} deps.modelId embeddings space key (llm_models row)
 * @param {number} deps.dim ACTIVE model dim — the HNSW shadow is bound to it
 * @param {import('../../../infrastructure/db/executor').DbExecutor} deps.executor
 *   postgres DbExecutor owning the shadow-table SQL
 * @param {(modelId: number, userScope: unknown) => Promise<Array<{nodeId: number, chunkIdx: number|null, vector: string, dim: number}>>} deps.loadRows
 *   canonical TEXT rows (pooled + chunks) — same contract as TextVectorJs
 * @param {(row: {nodeId: number, modelId: number, dim: number, vector: string}) => Promise<void>} deps.upsertPooled
 * @param {(nodeId: number, vectors: string[]) => Promise<void>} deps.replaceChunks
 * @param {(fn: (tx: DbExecutor) => Promise<void>) => Promise<void>} [deps.transaction]
 *   ONE transaction around canonical halves + shadow sync; fn receives the
 *   tx-bound executor. Defaults to executor.transaction.
 */
function createPgVector({
  modelId,
  dim,
  executor,
  loadRows,
  upsertPooled,
  replaceChunks,
  transaction,
}) {
  if (!modelId) throw new Error('PgVector requires a bound modelId (space key)');
  if (!Number.isInteger(dim) || dim <= 0) {
    throw new Error('PgVector requires the ACTIVE model dim (positive integer)');
  }
  if (!executor || executor.dialect !== 'postgres') {
    throw new Error('PgVector requires a postgres DbExecutor');
  }
  if (typeof loadRows !== 'function') throw new Error('PgVector requires loadRows');
  if (typeof upsertPooled !== 'function') throw new Error('PgVector requires upsertPooled');
  if (typeof replaceChunks !== 'function') throw new Error('PgVector requires replaceChunks');
  const inTransaction = transaction || ((fn) => executor.transaction(fn));

  async function createShadow() {
    await executor.run(
      `CREATE TABLE IF NOT EXISTS ${SHADOW_TABLE} (
         node_id   BIGINT NOT NULL,
         chunk_idx INT NULL,
         model_id  BIGINT NOT NULL,
         vector    vector(${dim})
       )`
    );
    await executor.run(
      `CREATE INDEX IF NOT EXISTS ${HNSW_INDEX}
         ON ${SHADOW_TABLE} USING hnsw (vector vector_cosine_ops)`
    );
  }

  /**
   * Absent-checked shadow bring-up. The bound dim rides the `vector`
   * column's atttypmod (numeric dim; -1 = untyped), so a stale-dim table —
   * model changed — is detected from the catalog and drop-rebuilt.
   * @returns {'created'|'ok'|'rebuilt'} 'rebuilt' ⇒ caller must repopulate
   *   (rebuildShadow) — the drop erased the derived rows, canonical untouched.
   */
  async function ensureShadow() {
    const { rows } = await executor.query(
      `SELECT a.atttypmod FROM pg_attribute a
       WHERE a.attrelid = to_regclass('${SHADOW_TABLE}')
         AND a.attname = 'vector' AND NOT a.attisdropped`
    );
    if (rows.length === 0) {
      await createShadow();
      return 'created';
    }
    if (Number(rows[0].atttypmod) !== dim) {
      await executor.run(`DROP TABLE IF EXISTS ${SHADOW_TABLE}`);
      await createShadow();
      return 'rebuilt';
    }
    return 'ok';
  }

  /**
   * Boot bring-up (§2.4): create/absent-check the shadow; on a stale dim the
   * derived index is drop-rebuilt AT THE NEW DIM and repopulated from
   * canonical TEXT — stale-space shadow data never coexists.
   */
  async function init() {
    const state = await ensureShadow();
    if (state === 'rebuilt') await rebuildShadow();
    return state;
  }

  /**
   * Admin-triggered rebuild (§2.4): drop-and-recreate the shadow idempotently
   * from the canonical TEXT rows (`loadRows`); canonical rows untouched.
   */
  async function rebuildShadow() {
    await executor.run(`DROP TABLE IF EXISTS ${SHADOW_TABLE}`);
    await createShadow();
    const rows = await loadRows(modelId, null);
    let inserted = 0;
    for (let i = 0; i < rows.length; i += REBUILD_BATCH) {
      const batch = [];
      for (const row of rows.slice(i, i + REBUILD_BATCH)) {
        if (row.dim !== dim) continue; // space-key discipline: cross-dim never lands
        batch.push([row.nodeId, row.chunkIdx, modelId, toVectorLiteral(row.vector)]);
      }
      if (batch.length === 0) continue;
      const placeholders = batch
        .map((_, r) => `($${r * 4 + 1}, $${r * 4 + 2}, $${r * 4 + 3}, $${r * 4 + 4}::vector)`)
        .join(', ');
      await executor.run(
        `INSERT INTO ${SHADOW_TABLE} (node_id, chunk_idx, model_id, vector)
         VALUES ${placeholders}`,
        batch.flat()
      );
      inserted += batch.length;
    }
    return { rowsInserted: inserted };
  }

  /**
   * Parsed pooled + chunk rows for the bound model (§2.2 canonical load path —
   * evolution clustering input; JsFallback's per-query path). No resident state.
   */
  async function allVectors(userScope) {
    const rows = await loadRows(modelId, userScope ?? null);
    return rows.map((row) => ({
      nodeId: row.nodeId,
      chunkIdx: row.chunkIdx,
      dim: row.dim,
      vector: parseVector(row.vector, row.dim),
    }));
  }

  /**
   * Pooled half = vecs[0], chunk half = vecs.slice(1) (chunkIdx dense from 0).
   * Canonical halves + shadow sync — ALL in ONE transaction (§2.2): the shadow
   * mirrors exactly what the canonical write produced, so a failure anywhere
   * rolls back everywhere.
   */
  async function upsert(nodeId, vecs, upsertDim) {
    if (!Array.isArray(vecs) || vecs.length === 0) {
      throw new Error('upsert requires at least the pooled vector');
    }
    const [pooled, ...chunks] = vecs;
    await inTransaction(async (tx) => {
      await upsertPooled({ nodeId, modelId, dim: upsertDim, vector: serializeVector(pooled) });
      await replaceChunks(
        nodeId,
        chunks.map((v) => serializeVector(v))
      );
      // shadow sync: replace this node's derived rows to match the canonical write
      await tx.run(`DELETE FROM ${SHADOW_TABLE} WHERE node_id = $1 AND model_id = $2`, [
        nodeId,
        modelId,
      ]);
      const rows = [
        [nodeId, null, modelId, toVectorLiteral(serializeVector(pooled))],
        ...chunks.map((v, chunkIdx) => [
          nodeId,
          chunkIdx,
          modelId,
          toVectorLiteral(serializeVector(v)),
        ]),
      ];
      const placeholders = rows
        .map((_, r) => `($${r * 4 + 1}, $${r * 4 + 2}, $${r * 4 + 3}, $${r * 4 + 4}::vector)`)
        .join(', ');
      await tx.run(
        `INSERT INTO ${SHADOW_TABLE} (node_id, chunk_idx, model_id, vector)
         VALUES ${placeholders}`,
        rows.flat()
      );
    });
  }

  function isVisible(nodeId, candidates) {
    if (!candidates) return true;
    if (candidates instanceof Set) return candidates.has(nodeId);
    return Boolean(candidates(nodeId));
  }

  /**
   * One ANN scan: ef_search is SET LOCAL inside the same transaction as the
   * KNN (§2.3 — FIXED 400, never the library default 100); score is cosine
   * similarity via pgvector's `<=>` distance.
   */
  async function knnScan(tx, queryVec, limit) {
    await tx.run(`SET LOCAL hnsw.ef_search = ${EF_SEARCH}`);
    const { rows } = await tx.query(
      `SELECT node_id, 1 - (vector <=> $1::vector) AS score
       FROM ${SHADOW_TABLE}
       WHERE model_id = $2
       ORDER BY vector <=> $1::vector
       LIMIT $3`,
      [toVectorLiteral(serializeVector(queryVec)), modelId, limit]
    );
    return rows;
  }

  /** Per-node MAX over that node's scanned rows; dedup; score desc, node_id asc. */
  function collectByNode(rows, candidates) {
    const byNode = new Map();
    for (const row of rows) {
      const nodeId = Number(row.node_id);
      if (!isVisible(nodeId, candidates)) continue;
      const score = Number(row.score);
      const cur = byNode.get(nodeId);
      if (cur === undefined || score > cur) byNode.set(nodeId, score);
    }
    const out = [...byNode]
      .map(([nodeId, score]) => ({ nodeId, score }))
      .sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    return out;
  }

  /**
   * ANN KNN over the shadow (§2.2): per-node max-over-chunks with node ids
   * DEDUPED before k is cut; `candidates` (Set or predicate) is enforced
   * engine-side with the §2.5 oversample→filter→adaptive-retry discipline
   * (f=4, bounded doubling rounds, short-list terminal). A query of a
   * mismatched dim never scores (space-key discipline).
   */
  async function neighbors(queryVec, k, candidates) {
    if (!Array.isArray(queryVec) || !Number.isFinite(k) || k <= 0) return [];
    if (queryVec.length !== dim) return [];
    const { rows: countRows } = await executor.query(
      `SELECT COUNT(*) AS cnt FROM ${SHADOW_TABLE} WHERE model_id = $1`,
      [modelId]
    );
    const total = Number(countRows[0].cnt);
    if (total === 0) return [];
    let limit = Math.min(k * OVERSAMPLE_F, total);
    for (let round = 0; ; round++) {
      const merged = await executor.transaction(async (tx) =>
        collectByNode(await knnScan(tx, queryVec, limit), candidates)
      );
      if (merged.length >= k) return merged.slice(0, k);
      // terminal short list: the scan already covers the whole model space, or
      // the bounded retry rounds are spent (correctness over padding, §2.5)
      if (limit >= total || round >= MAX_RETRY_ROUNDS) return merged;
      limit = Math.min(limit * 2, total);
    }
  }

  return { allVectors, neighbors, upsert, rebuildShadow, init };
}

module.exports = { createPgVector, probePgVector };
