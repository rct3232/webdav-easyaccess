'use strict';

// SqliteVec — the native sqlite engine of the vectorStore seam
// (vectorStore.md §2.3/§2.4a) on the node:sqlite driver + the sqlite-vec vec0
// loadable extension (product Node floor ≥24; the experimental warning is
// tolerated).
//
// The vec0 virtual table is a DERIVED artifact created/managed HERE — never
// part of the tracked DDL chain (§2.4). Canonical truth stays
// `embeddings.vector` TEXT; the shadow is re-synced from canonical rows
// whenever stale — the same per-query freshness as the JsFallback (no
// resident state).
//
// vec0 distances are FLOAT32 approximations of 1 − cosine; they rank
// CANDIDATES ONLY and are never returned to callers. Returned scores are
// recomputed in f64 over the canonical TEXT rows — with the SAME arithmetic
// (vectorMath.cosineSimilarity) and the SAME ranking (per-node max-over-chunks,
// dedup before k, score desc / node_id asc) as TextVectorJs — so output stays
// exact≡oracle bit-for-bit (vectorStore.md §2.6).
//
// vec0 + JOIN has a planner bug ⇒ NO join-KNN anywhere in this file (the
// no-JOIN grep gate pins it); ACL enforcement rides the shared
// oversample→filter→retry helper (§2.5).

const vecLoader = (() => {
  try {
    return require('sqlite-vec');
  } catch {
    return null; // missing/broken binary ⇒ construction fails with vec0Unavailable
  }
})();

const { parseVector, serializeVector, cosineSimilarity } = require('./vectorMath');
const { neighborsFiltered, isVisibleNode } = require('./aclFilter');

/**
 * Canonical TEXT → float32 blob for the vec0 shadow. The shadow is DERIVED:
 * its f32 quantization is the artifact's own storage format (vec0 float[D]
 * column), while the canonical TEXT rows keep full f64 — the f64 rescore reads
 * the canonical rows, never the blob.
 */
function toFloat32Blob(vec) {
  const f32 = new Float32Array(vec);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

const SHADOW_TABLE = 'vectorstore_shadow_vec0';
// vec0 supports float[N] far beyond product needs; the adapter caps the shadow
// dim defensively — larger spaces must use the pg tier (AI profile dims ship
// ≤ 768, MRL floor 128).
const MAX_SHADOW_DIM = 2048;
// vec0 hard limit on the KNN k value (probed on sqlite-vec 0.1.9: "k value in
// knn query too large ... the limit is 4096").
const VEC0_K_LIMIT = 4096;
// Shadow freshness stamp: stored in the shadow db's user_version as
// SHADOW_USER_VERSION + <generation>. A generation is (row count ‖ dim) of the
// canonical space — cheap, deterministic, and any canonical change (insert,
// delete, re-embed, dim change) bumps it.
const SHADOW_USER_VERSION = 1;

function codeError(code, message) {
  const err = new Error(message);
  err.code = code;
  return err;
}

/**
 * Loads the vec0 extension onto an open node:sqlite handle. The handle MUST
 * have been opened with `{ allowExtension: true }` — `enableLoadExtension`
 * throws ERR_INVALID_STATE otherwise (vectorStore.md §2.4a). Re-loading an
 * already-loaded handle is a no-op (sqlite-vec is idempotent per connection).
 */
function loadExtension(db) {
  db.enableLoadExtension(true);
  vecLoader.load(db);
}

function readUserVersion(db) {
  const row = db.prepare('PRAGMA user_version').get();
  return row ? Number(row.user_version) : 0;
}

function writeUserVersion(db, value) {
  db.exec(`PRAGMA user_version = ${Number(value)}`);
}

function isShadowCurrent(db, generation) {
  return readUserVersion(db) === SHADOW_USER_VERSION + generation;
}

/**
 * Drops and recreates the shadow at `dim`, then repopulates it from canonical
 * TEXT rows. Idempotent (drop-first ⇒ stale-model rows never coexist,
 * vectorStore.md §2.4).
 */
function rebuildShadowAt(db, dim, canonicalRows) {
  db.exec(`DROP TABLE IF EXISTS ${SHADOW_TABLE}`);
  db.exec(
    `CREATE VIRTUAL TABLE ${SHADOW_TABLE} USING vec0(
       embedding float[${dim}] distance_metric=cosine,
       +node_id INTEGER,
       +chunk_idx INTEGER,
       +model_id INTEGER
     )`
  );
  const insert = db.prepare(
    `INSERT INTO ${SHADOW_TABLE}(embedding, node_id, chunk_idx, model_id)
     VALUES (?, ?, ?, ?)`
  );
  let skipped = 0;
  for (const r of canonicalRows) {
    if (r.dim !== dim) continue; // space-key discipline: only active-dim rows
    // vec0 INTEGER aux columns MUST bind as BigInt (node:sqlite binds JS
    // numbers as f64, which vec0 aux columns reject outright) — and the f64
    // return path cannot round-trip ids above 2^53, so unsafe ids are
    // sentinel-skipped with a warning (product ids are sequences far below).
    if (
      !Number.isSafeInteger(r.nodeId) ||
      !Number.isSafeInteger(r.chunkIdx === null ? -1 : r.chunkIdx)
    ) {
      skipped += 1;
      // eslint-disable-next-line no-console
      console.warn(
        `SqliteVec: shadow row for node ${r.nodeId} chunk ${r.chunkIdx} skipped — id beyond Number.MAX_SAFE_INTEGER`
      );
      continue;
    }
    const chunkIdx = r.chunkIdx === null ? -1 : r.chunkIdx;
    insert.run(toFloat32Blob(parseVector(r.vector, dim)), BigInt(r.nodeId), BigInt(chunkIdx), 0n);
  }
  return skipped;
}

function createSqliteVec({ modelId, db, loadRows, upsertPooled, replaceChunks, transaction }) {
  if (!modelId) throw new Error('SqliteVec requires a bound modelId (space key)');
  if (!db) throw new Error('SqliteVec requires an open node:sqlite DatabaseSync handle');
  if (typeof loadRows !== 'function') throw new Error('SqliteVec requires loadRows');
  if (!vecLoader) throw codeError('vec0Unavailable', 'sqlite-vec loadable extension absent');

  loadExtension(db);

  /**
   * One canonical load per call (no-resident-state gate) + shadow re-sync when
   * the generation changed. Returns the canonical rows and the space dim.
   */
  async function syncedCanonical() {
    const rows = await loadRows(modelId, null);
    const dims = new Set(rows.map((r) => r.dim));
    if (dims.size > 1) {
      throw codeError('dimMismatch', 'canonical rows carry multiple dims in one model space');
    }
    if (rows.length === 0) {
      // Empty space: drop any stale shadow so nothing survives a model switch.
      if (!isShadowCurrent(db, 0)) {
        rebuildShadowAt(db, 1, []);
        writeUserVersion(db, SHADOW_USER_VERSION);
      }
      return { rows, dim: null };
    }
    const dim = rows[0].dim;
    if (dim > MAX_SHADOW_DIM) {
      throw codeError(
        'dimMismatch',
        `vector dim ${dim} exceeds the vec0 shadow cap ${MAX_SHADOW_DIM}`
      );
    }
    const generation = rows.length * 1_000_003 + dim; // count ‖ dim, cheap + injective enough
    if (!isShadowCurrent(db, generation)) {
      rebuildShadowAt(db, dim, rows);
      writeUserVersion(db, SHADOW_USER_VERSION + generation);
    }
    return { rows, dim };
  }

  /**
   * vec0 KNN as candidate prefilter: `SELECT node_id, chunk_idx, distance FROM
   * vectorstore_shadow_vec0 WHERE embedding MATCH ? AND k = ?` — the query
   * vector JSON-stringified (vec0 accepts json/blob/float32-text), ids back as
   * JS numbers. Ordered by vec0's f32 distance ascending (best-first); zero
   * rows carry distance NULL and vec0's raw order sinks them last, which the
   * f64 rescore re-ranks correctly anyway.
   */
  function knn(dim, queryVec, limit) {
    return db
      .prepare(
        `SELECT node_id, chunk_idx, distance FROM ${SHADOW_TABLE}
         WHERE embedding MATCH ? AND k = ?`
      )
      .all(JSON.stringify(queryVec), limit);
  }

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
   * Per-node max-over-chunks cosine; node ids deduped BEFORE k is cut; score
   * desc, then node_id asc. Ranking arithmetic is IDENTICAL to TextVectorJs
   * (same parse, same cosineSimilarity) so the exact≡oracle harness holds
   * bit-for-bit; vec0's KNN only decides WHICH canonical rows get rescored.
   */
  async function neighbors(queryVec, k, candidates) {
    if (!Array.isArray(queryVec) || queryVec.length === 0) return [];
    const { rows, dim } = await syncedCanonical();
    if (dim === null || dim !== queryVec.length) return []; // space-key discipline

    const rankRows = (visibleFilter) => {
      // Per-node max-over-chunks over the canonical rows — the exact
      // TextVectorJs ranking (same parse, same cosineSimilarity, same order),
      // optionally restricted to visible nodes.
      const scores = new Map();
      for (const row of rows) {
        if (row.dim !== queryVec.length) continue;
        if (visibleFilter && !visibleFilter(row.nodeId)) continue;
        const c = cosineSimilarity(queryVec, parseVector(row.vector, row.dim));
        const cur = scores.get(row.nodeId);
        if (cur === undefined || c > cur) scores.set(row.nodeId, c);
      }
      return scores;
    };

    let byNode;
    if (candidates) {
      // ACL scoping (§2.5): vec0 KNN cannot enforce ACL in the MATCH query and
      // a candidate pool truncated at k·f would under-rank visible nodes
      // (invisible peers crowd them out) — so the filtered path ranks the
      // FULL canonical space in f64 through the oversample→filter helper's
      // contract (adaptive retry degenerates to one pass: the pool already
      // covers every visible node).
      byNode = rankRows((nodeId) => isVisibleNode(nodeId, candidates));
    } else {
      // Unscoped: vec0 KNN as candidate prefilter, then exact f64 rescoring of
      // the candidate nodes (k·f pool, adaptive doubling on shortfall).
      byNode = await neighborsFiltered({
        k,
        candidates: null,
        loadCandidates: (limit) => knn(dim, queryVec, Math.min(limit, VEC0_K_LIMIT)),
        rescore: (raw) => {
          const wanted = new Set(raw.map((r) => Number(r.node_id)));
          const scores = new Map();
          for (const row of rows) {
            if (!wanted.has(row.nodeId)) continue;
            if (row.dim !== queryVec.length) continue;
            const c = cosineSimilarity(queryVec, parseVector(row.vector, row.dim));
            const cur = scores.get(row.nodeId);
            if (cur === undefined || c > cur) scores.set(row.nodeId, c);
          }
          return scores;
        },
      });
    }

    const scored = [...byNode].map(([nodeId, score]) => ({ nodeId, score }));
    scored.sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
    return scored.slice(0, k);
  }

  /**
   * Pooled half = vecs[0], chunk half = vecs.slice(1) (chunkIdx dense from 0),
   * both inside ONE injected transaction (vectorStore.md §2.2). A pooled-only
   * call replaces prior chunk rows with an empty set. The shadow syncs lazily
   * on the next read (generation bump via canonical change).
   */
  async function upsert(nodeId, vecs, dim) {
    if (!Array.isArray(vecs) || vecs.length === 0) {
      throw new Error('upsert requires at least the pooled vector');
    }
    const [pooled, ...chunks] = vecs;
    await transaction(async () => {
      await upsertPooled({ nodeId, modelId, dim, vector: serializeVector(pooled) });
      await replaceChunks(
        nodeId,
        chunks.map((v) => serializeVector(v))
      );
    });
  }

  /**
   * Admin-triggered rebuild: force a drop + repopulate from canonical TEXT on
   * the next neighbors() call (vectorStore.md §2.4) — invalidate the stamp.
   */
  async function rebuildShadow() {
    writeUserVersion(db, 0);
  }

  return { allVectors, neighbors, upsert, rebuildShadow };
}

module.exports = { createSqliteVec, SHADOW_TABLE, MAX_SHADOW_DIM, VEC0_K_LIMIT };
