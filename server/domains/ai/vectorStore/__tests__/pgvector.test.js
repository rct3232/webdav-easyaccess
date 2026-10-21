'use strict';

// PgVector ANN-leg conformance (vectorStore.md §2.3/§2.4/§2.6).
//
// The exact≡oracle harness (conformance.test.js) grades EXACT engines only —
// a C-side ANN accumulation order can never be bit-identical to the JS oracle.
// The ANN engine is graded here instead:
//   - recall@50 ≥ 0.99 at ef_search=400 over HELD-OUT (external) queries only
//     (noisy perturbations of corpus vectors; a byte-equal self-query FAILS the
//     suite by construction guard),
//   - `SET LOCAL hnsw.ef_search = 400` captured on every ANN query,
//   - ef=100 contrast measured test-side for evidence (the adapter itself has
//     NO ef knob — §3: fixed in code, never the library default 100),
//   - shadow lifecycle: init/rebuild/dim-change (never tracked DDL, §2.4).
//
// Runs against real pgvector ≥0.7 (pgvector/pgvector:pg16). The suite is
// SKIPPED unless the WEA_TEST_PG_* namespace points at a server; a server
// without the `vector` extension FAILS the suite with the operator hint
// (deliberate: the pg:vector leg is opt-in via `npm run test:ci:pg:vector`).

const { Pool } = require('pg');
const { createPgVector } = require('../PgVector');
const { serializeVector } = require('../vectorMath');

const SHADOW = 'vectorstore_shadow_pg';
const EF_SEARCH = 400; // §3: fixed in code — asserted as captured SQL below
const K = 50; // §2.6 recall@50

// --- deterministic PRNG (xorshift32; Math.random is banned for corpus work) ---

function xorshift32(seed) {
  let s = seed >>> 0;
  return function next() {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

function gauss(rng) {
  // Irwin–Hall(4): mean 0, std 0.577 — deterministic pseudo-gaussian.
  return rng() + rng() + rng() + rng() - 2;
}

function randomUnitVector(dim, rng) {
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rng() * 2 - 1;
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

function unit(vec) {
  let sum = 0;
  for (let i = 0; i < vec.length; i++) sum += vec[i] * vec[i];
  const n = Math.sqrt(sum);
  return vec.map((x) => x / n);
}

// --- independent oracle arithmetic (no vectorMath imports for scoring) ---

function oracleParse(text) {
  return text.split(',').map(Number);
}

function oracleCosine(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// score = per-node MAX over its rows (pooled + chunks); dedup before k
function oracleNeighbors(queryText, rows, candidates, k) {
  const q = oracleParse(queryText);
  const byNode = new Map();
  for (const row of rows) {
    if (candidates && !candidates.has(row.nodeId)) continue;
    if (row.dim !== q.length) continue;
    const c = oracleCosine(q, oracleParse(row.vector));
    const cur = byNode.get(row.nodeId);
    if (cur === undefined || c > cur) byNode.set(row.nodeId, c);
  }
  const scored = [...byNode].map(([nodeId, score]) => ({ nodeId, score }));
  scored.sort((x, y) => y.score - x.score || x.nodeId - y.nodeId);
  return scored.slice(0, k);
}

// --- clustered corpus: HNSW-miss-inducing structure (ANN stress) ---

function buildClusteredCorpus({ seed, dim, clusters, nodesPerCluster, queryCount, queryNoise }) {
  const rng = xorshift32(seed);
  const rows = []; // { nodeId, chunkIdx(null|0..n), vector TEXT, dim }
  const vecByNode = new Map(); // nodeId -> { pooled: number[], chunks: number[][] }
  let nodeId = 0;
  for (let c = 0; c < clusters; c++) {
    const center = randomUnitVector(dim, rng);
    for (let n = 0; n < nodesPerCluster; n++) {
      nodeId += 1;
      const base = unit(center.map((x) => x + gauss(rng) * 0.25));
      const chunkCount = 1 + (nodeId % 3); // 1..3 chunks
      const chunkVectors = [];
      for (let ch = 0; ch < chunkCount; ch++) {
        chunkVectors.push(unit(base.map((x) => x + gauss(rng) * 0.08)));
      }
      const pooledSum = new Array(dim).fill(0);
      for (const cv of chunkVectors) for (let i = 0; i < dim; i++) pooledSum[i] += cv[i];
      const pooled = unit(pooledSum.map((x) => x / chunkVectors.length));
      rows.push({ nodeId, chunkIdx: null, vector: serializeVector(pooled), dim });
      chunkVectors.forEach((cv, ch) =>
        rows.push({ nodeId, chunkIdx: ch, vector: serializeVector(cv), dim })
      );
      vecByNode.set(nodeId, { pooled, chunks: chunkVectors });
    }
  }
  // Held-out queries: noisy perturbations of source nodes from a FRESH rng
  // stream — never byte-equal to any corpus row (guard asserted below).
  const qrng = xorshift32(seed ^ 0x5f5f5f5f);
  const queries = [];
  const sources = [];
  const stride = Math.floor(nodeId / queryCount);
  for (let i = 0; i < queryCount; i++) {
    const src = 1 + ((i * stride) % nodeId);
    const srcVec = vecByNode.get(src).pooled;
    const q = unit(srcVec.map((x) => x + gauss(qrng) * queryNoise));
    const text = serializeVector(q);
    queries.push({ text, vec: q });
    sources.push(src);
  }
  return { dim, rows, vecByNode, queries, sources, nodeCount: nodeId };
}

// --- test-double canonical stores (the seam is persistence-injected) ---

function createCanonicalDoubles(corpus) {
  const state = { pooled: new Map(), chunks: new Map() };
  const seed = () => {
    state.pooled.clear();
    state.chunks.clear();
    for (const r of corpus.rows) {
      if (r.chunkIdx === null) state.pooled.set(r.nodeId, { ...r });
      else {
        if (!state.chunks.has(r.nodeId)) state.chunks.set(r.nodeId, []);
        state.chunks.get(r.nodeId).push({ ...r });
      }
    }
  };
  const loadRows = (modelId) => {
    if (modelId !== corpus.modelId) return [];
    const out = [];
    for (const v of state.pooled.values()) out.push({ ...v });
    for (const list of state.chunks.values()) for (const v of list) out.push({ ...v });
    return out;
  };
  const upsertPooledCalls = [];
  const chunkReplaceCalls = [];
  return {
    seed,
    loadRows,
    upsertPooled: (row) => {
      upsertPooledCalls.push({ ...row });
      state.pooled.set(row.nodeId, { ...row });
    },
    replaceChunks: (nodeId, vectors) => {
      chunkReplaceCalls.push({ nodeId, vectors });
      state.chunks.set(
        nodeId,
        vectors.map((vector, i) => ({
          nodeId,
          chunkIdx: i,
          vector,
          dim: vectors[i].split(',').length,
        }))
      );
    },
    upsertPooledCalls,
    chunkReplaceCalls,
    counts: () => ({
      pooled: state.pooled.size,
      chunkRows: [...state.chunks.values()].reduce((s, l) => s + l.length, 0),
    }),
  };
}

// --- pg executor double over a Pool (mirrors postgresExecutor contract) ---

function createPgExecutor(pool, sqlLog) {
  const record = (sql) => sqlLog.push(sql.replace(/\s+/g, ' ').trim());
  const clientExecutor = (client) => ({
    async query(sql, params = []) {
      record(sql);
      const res = await client.query(sql, params);
      return { rows: res.rows || [] };
    },
    async run(sql, params = []) {
      record(sql);
      const res = await client.query(sql, params);
      return { changes: res.rowCount, rows: res.rows || [] };
    },
  });
  return {
    dialect: 'postgres',
    query: clientExecutor(pool).query,
    run: clientExecutor(pool).run,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const out = await fn(clientExecutor(client));
        await client.query('COMMIT');
        return out;
      } catch (err) {
        try {
          await client.query('ROLLBACK');
        } catch {
          /* rollback of a dead tx */
        }
        throw err;
      } finally {
        client.release();
      }
    },
  };
}

// --- env gating (repo pattern: WEA_TEST_PG_* namespace decides) ---

const TEST_PG_KEYS = [
  'WEA_TEST_PG_HOST',
  'WEA_TEST_PG_PORT',
  'WEA_TEST_PG_USER',
  'WEA_TEST_PG_PASSWORD',
  'WEA_TEST_PG_DATABASE',
];
const pgEnvPresent = TEST_PG_KEYS.some((key) => !!process.env[key]);
const suite = pgEnvPresent ? describe : describe.skip;

suite('PgVector ANN leg (real pgvector)', () => {
  const MODEL_ID = 4242;
  const DIM = 64;
  let pool;
  let executor;
  let sqlLog;

  // functional corpus (small) + recall corpus (large, clustered)
  const functional = buildClusteredCorpus({
    seed: 20261021,
    dim: DIM,
    clusters: 5,
    nodesPerCluster: 8,
    queryCount: 6,
    queryNoise: 0.12,
  });
  const recall = buildClusteredCorpus({
    seed: 971,
    dim: DIM,
    clusters: 40,
    nodesPerCluster: 30,
    queryCount: 30,
    queryNoise: 0.12,
  });
  functional.modelId = MODEL_ID;
  recall.modelId = MODEL_ID;

  const shadowDim = async () => {
    const { rows } = await pool.query(
      `SELECT a.atttypmod FROM pg_attribute a
       WHERE a.attrelid = to_regclass('${SHADOW}') AND a.attname = 'vector' AND NOT a.attisdropped`
    );
    return rows.length === 0 ? null : Number(rows[0].atttypmod);
  };
  const shadowRowCount = async (where = '1=1', params = []) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*) AS cnt FROM ${SHADOW} WHERE ${where}`,
      params
    );
    return Number(rows[0].cnt);
  };

  beforeAll(async () => {
    pool = new Pool({
      host: process.env.WEA_TEST_PG_HOST || '127.0.0.1',
      port: Number(process.env.WEA_TEST_PG_PORT || 5433),
      user: process.env.WEA_TEST_PG_USER || 'e2etest',
      password: process.env.WEA_TEST_PG_PASSWORD || 'e2etest',
      database: process.env.WEA_TEST_PG_DATABASE || 'webdav_test',
    });
    await pool.query('SELECT 1');
    const ext = await pool.query(`SELECT extversion FROM pg_extension WHERE extname = 'vector'`);
    if (ext.rows.length === 0) {
      await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
    }
    const version = await pool.query(
      `SELECT extversion FROM pg_extension WHERE extname = 'vector'`
    );
    if (version.rows.length === 0) {
      throw new Error(
        'PgVector ANN leg needs pgvector ≥ 0.7: the target PG has no `vector` extension. ' +
          'Run against pgvector/pgvector:pg16 (dev: port 5434 container) via npm run test:ci:pg:vector.'
      );
    }
    await pool.query(`DROP TABLE IF EXISTS ${SHADOW}`);
    sqlLog = [];
    executor = createPgExecutor(pool, sqlLog);
  });

  afterAll(async () => {
    await pool.query(`DROP TABLE IF EXISTS ${SHADOW}`);
    await pool.end();
  });

  const makeAdapter = (doubles, dim = DIM) =>
    createPgVector({
      modelId: MODEL_ID,
      dim,
      executor,
      loadRows: doubles.loadRows,
      upsertPooled: doubles.upsertPooled,
      replaceChunks: doubles.replaceChunks,
      transaction: (fn) => executor.transaction(fn),
    });

  // ---------------------------------------------------------------------
  // functional legs — small corpus
  // ---------------------------------------------------------------------

  describe('shadow lifecycle (derived artifact, never tracked DDL)', () => {
    let adapter;
    let doubles;

    beforeAll(() => {
      doubles = createCanonicalDoubles(functional);
      doubles.seed();
      adapter = makeAdapter(doubles);
    });

    it('init() creates the shadow table with the bound dim + HNSW index', async () => {
      const outcome = await adapter.init();
      expect(outcome).toBe('created');
      expect(await shadowDim()).toBe(DIM);
      const idx = await pool.query(`SELECT 1 FROM pg_indexes WHERE indexname = '${SHADOW}_hnsw'`);
      expect(idx.rows.length).toBe(1);
    });

    it('init() is idempotent (absent-checked)', async () => {
      await expect(adapter.init()).resolves.toBe('ok');
      expect(await shadowDim()).toBe(DIM);
    });

    it('init() on a stale-dim shadow drop-rebuilds and reports rebuilt', async () => {
      // simulate a model dim change: recreate the table at dim 8
      await pool.query(`DROP TABLE IF EXISTS ${SHADOW}`);
      await pool.query(
        `CREATE TABLE ${SHADOW} (node_id BIGINT NOT NULL, chunk_idx INT NULL, model_id BIGINT NOT NULL, vector vector(8))`
      );
      const outcome = await adapter.init();
      expect(outcome).toBe('rebuilt');
      expect(await shadowDim()).toBe(DIM); // back at the ACTIVE model dim
      expect(await shadowRowCount()).toBe(0); // stale-space data never coexists
    });

    it('rebuildShadow() repopulates from canonical TEXT rows', async () => {
      await adapter.rebuildShadow();
      expect(await shadowRowCount()).toBe(functional.rows.length);
      expect(await shadowRowCount('chunk_idx IS NULL')).toBe(functional.nodeCount);
    });
  });

  describe('upsert — canonical + shadow in ONE transaction', () => {
    let adapter;
    let doubles;

    beforeEach(() => {
      doubles = createCanonicalDoubles(functional);
      doubles.seed();
      adapter = makeAdapter(doubles);
    });

    it('writes the pooled half, chunk half and shadow rows in one TX', async () => {
      const pooled = functional.vecByNode.get(1).pooled;
      const chunks = functional.vecByNode.get(1).chunks;
      const before = await shadowRowCount('node_id = 1');
      await adapter.upsert(1, [pooled, ...chunks], DIM);
      // canonical hooks fired with serialized TEXT
      expect(doubles.upsertPooledCalls.at(-1).vector).toBe(serializeVector(pooled));
      expect(doubles.chunkReplaceCalls.at(-1).vectors).toEqual(chunks.map(serializeVector));
      // shadow: pooled row (chunk_idx NULL) + one row per chunk, dense idx
      expect(await shadowRowCount('node_id = 1')).toBe(1 + chunks.length);
      const { rows } = await pool.query(
        `SELECT chunk_idx, model_id FROM ${SHADOW} WHERE node_id = 1 ORDER BY chunk_idx NULLS FIRST`
      );
      expect(rows[0].chunk_idx).toBeNull();
      expect(rows[0].model_id).toBe(MODEL_ID);
      rows.slice(1).forEach((r, i) => expect(r.chunk_idx).toBe(i));
      if (before > 0) {
        expect(before).toBe(await shadowRowCount('node_id = 1')); // replace, no dup
      }
      // ONE transaction: the TX body ran through a single BEGIN..COMMIT
      const txOpens = sqlLog.filter((s) => s === 'BEGIN').length;
      expect(txOpens).toBe(1);
    });

    it('a chunk-write failure rolls back the shadow sync too', async () => {
      const pooled = functional.vecByNode.get(2).pooled;
      const beforeShadow = await shadowRowCount();
      const beforeCanonical = doubles.counts();
      doubles.replaceChunks = () => {
        throw new Error('forced chunk-write failure');
      };
      await expect(adapter.upsert(2, [pooled, pooled], DIM)).rejects.toThrow(
        'forced chunk-write failure'
      );
      expect(await shadowRowCount()).toBe(beforeShadow);
      expect(doubles.counts()).toEqual(beforeCanonical);
    });

    it('re-upserting a node replaces its shadow rows (no dupes)', async () => {
      const v1 = functional.vecByNode.get(3);
      await adapter.upsert(3, [v1.pooled, ...v1.chunks], DIM);
      const afterFirst = await shadowRowCount('node_id = 3');
      const v2 = functional.vecByNode.get(4);
      await adapter.upsert(3, [v2.pooled, ...v2.chunks], DIM);
      expect(await shadowRowCount('node_id = 3')).toBe(1 + v2.chunks.length);
      expect(afterFirst).toBe(1 + v1.chunks.length);
    });
  });

  describe('neighbors — seam semantics over the shadow', () => {
    let adapter;
    let doubles;

    beforeAll(() => {
      doubles = createCanonicalDoubles(functional);
      doubles.seed();
      adapter = makeAdapter(doubles);
      return adapter.rebuildShadow();
    });

    it('matches the oracle on held-out queries (ids and score order)', async () => {
      for (const q of functional.queries) {
        const got = await adapter.neighbors(q.vec, 10, null);
        const want = oracleNeighbors(q.text, functional.rows, null, 10);
        expect(got.map((r) => r.nodeId)).toEqual(want.map((r) => r.nodeId));
      }
    });

    it('scores per-node MAX over chunks (mid-section regression fixture)', async () => {
      const dim = DIM;
      const q = new Array(dim).fill(0);
      q[0] = 1;
      const near = new Array(dim).fill(0);
      near[0] = Math.SQRT1_2;
      near[1] = Math.SQRT1_2; // cos(q, near) ≈ 0.707
      const far = new Array(dim).fill(0);
      far[0] = -1;
      const pooled = unit(q.map((_, i) => (near[i] + far[i]) / 2));
      const fixtureRows = [
        { nodeId: 987654, chunkIdx: null, vector: serializeVector(pooled), dim },
        { nodeId: 987654, chunkIdx: 0, vector: serializeVector(near), dim },
        { nodeId: 987654, chunkIdx: 1, vector: serializeVector(far), dim },
      ];
      const fixtureDoubles = {
        loadRows: () => fixtureRows.map((r) => ({ ...r })),
        upsertPooled: () => {},
        replaceChunks: () => {},
      };
      const fixtureAdapter = makeAdapter(fixtureDoubles);
      await fixtureAdapter.rebuildShadow();
      const got = await fixtureAdapter.neighbors(q, 5, null);
      expect(got[0].nodeId).toBe(987654);
      expect(got[0].score).toBeGreaterThanOrEqual(0.6);
      expect(got[0].score).toBeCloseTo(Math.SQRT1_2, 3);
    });

    it('dedups node ids before k is cut', async () => {
      const got = await adapter.neighbors(functional.queries[0].vec, 10, null);
      const ids = got.map((r) => r.nodeId);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('restricts ranking to the candidates set (Set and predicate agree)', async () => {
      const visible = new Set(functional.rows.filter((_, i) => i % 2 === 0).map((r) => r.nodeId));
      const pred = (id) => visible.has(id);
      const q = functional.queries[1];
      const viaSet = await adapter.neighbors(q.vec, 10, visible);
      const viaPred = await adapter.neighbors(q.vec, 10, pred);
      expect(viaPred).toEqual(viaSet);
      for (const r of viaSet) expect(visible.has(r.nodeId)).toBe(true);
      const want = oracleNeighbors(q.text, functional.rows, visible, 10);
      expect(viaSet.map((r) => r.nodeId)).toEqual(want.map((r) => r.nodeId));
    });

    it('an invisible candidate NEVER appears even when it ranks top-1 (adaptive retry)', async () => {
      // every 7th node visible: f=4 oversample (k=10 → 40 scanned) is NOT
      // enough to surface 10 visible nodes → the doubling retry must kick in
      const visible = new Set([...functional.vecByNode.keys()].filter((id) => id % 7 === 0));
      const q = functional.queries[2];
      const got = await adapter.neighbors(q.vec, 10, visible);
      expect(got.length).toBe(10);
      for (const r of got) expect(visible.has(r.nodeId)).toBe(true);
    });

    it('returns a short list when fewer visible candidates exist than k', async () => {
      const visible = new Set([1, 2, 3]);
      const got = await adapter.neighbors(functional.queries[3].vec, 10, visible);
      expect(got.length).toBe(3);
    });

    it('a query of a mismatched dim returns [] (space-key discipline)', async () => {
      expect(await adapter.neighbors([1, 0], 5, null)).toEqual([]);
    });

    it('captures SET LOCAL hnsw.ef_search = 400 on every ANN query', async () => {
      sqlLog.length = 0;
      await adapter.neighbors(functional.queries[4].vec, 10, null);
      const sets = sqlLog.filter((s) => s.startsWith('SET LOCAL hnsw.ef_search'));
      expect(sets.length).toBeGreaterThanOrEqual(1);
      for (const s of sets) expect(s).toBe(`SET LOCAL hnsw.ef_search = ${EF_SEARCH}`);
    });

    it('a cross-model_id shadow row is never returned (space key)', async () => {
      // plant a row in a DIFFERENT model space, maximally close to the query
      const q = functional.queries[5];
      const srcNode = functional.sources[5];
      const srcVec = functional.vecByNode.get(srcNode).pooled;
      await pool.query(
        `INSERT INTO ${SHADOW} (node_id, chunk_idx, model_id, vector) VALUES ($1, NULL, $2, $3::vector)`,
        [999999, MODEL_ID + 1, serializeVector(srcVec)]
      );
      const got = await adapter.neighbors(q.vec, 50, null);
      expect(got.map((r) => r.nodeId)).not.toContain(999999);
      await pool.query(`DELETE FROM ${SHADOW} WHERE node_id = 999999`);
    });
  });

  describe('allVectors (canonical load path)', () => {
    it('returns parsed pooled + chunk rows for the bound model, per call', async () => {
      const doubles = createCanonicalDoubles(functional);
      doubles.seed();
      const adapter = makeAdapter(doubles);
      const all = await adapter.allVectors(null);
      expect(all.length).toBe(functional.rows.length);
      for (const r of all) {
        expect(Array.isArray(r.vector)).toBe(true);
        expect(r.vector.length).toBe(DIM);
      }
      const again = await adapter.allVectors(null);
      expect(again.length).toBe(all.length); // no resident state
    });
  });

  // ---------------------------------------------------------------------
  // recall leg — clustered corpus, HELD-OUT queries only (§2.6)
  // ---------------------------------------------------------------------

  describe('recall@50 ≥ 0.99 @ ef_search=400 (held-out queries)', () => {
    let adapter;
    let doubles;

    beforeAll(async () => {
      doubles = createCanonicalDoubles(recall);
      doubles.seed();
      adapter = makeAdapter(doubles);
      await adapter.init();
      await adapter.rebuildShadow(); // load the big corpus into the shadow
    }, 120000);

    it('held-out guard: no query byte-matches a corpus row', () => {
      const rowTexts = new Set(recall.rows.map((r) => r.vector));
      for (const q of recall.queries) {
        expect(rowTexts.has(q.text)).toBe(false); // self-queries are BANNED as grading input
      }
    });

    it('measures recall@50 ≥ 0.99 across the held-out query set', async () => {
      const oracleTop50 = recall.queries.map((q) => oracleNeighbors(q.text, recall.rows, null, K));
      let hits = 0;
      const recalls = [];
      for (let i = 0; i < recall.queries.length; i++) {
        const got = await adapter.neighbors(recall.queries[i].vec, K, null);
        const wantIds = new Set(oracleTop50[i].map((r) => r.nodeId));
        const gotIds = new Set(got.map((r) => r.nodeId));
        expect(gotIds.size).toBe(K); // node dedup before k
        let inter = 0;
        for (const id of wantIds) if (gotIds.has(id)) inter += 1;
        hits += inter;
        recalls.push(inter / K);
      }
      const recallAt50 = hits / (K * recall.queries.length);
      // eslint-disable-next-line no-console
      console.info(
        `[pgvector leg] recall@50 @ ef${EF_SEARCH} = ${recallAt50.toFixed(4)} ` +
          `(min per-query ${Math.min(...recalls).toFixed(2)})`
      );
      expect(recallAt50).toBeGreaterThanOrEqual(0.99);
    }, 120000);

    it('ef=100 contrast (test-side evidence only — the adapter has NO ef knob)', async () => {
      const oracleTop50 = recall.queries.map((q) => oracleNeighbors(q.text, recall.rows, null, K));
      let hitsAt100 = 0;
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL hnsw.ef_search = 100');
        for (let i = 0; i < recall.queries.length; i++) {
          const { rows } = await client.query(
            `SELECT node_id, 1 - (vector <=> $1::vector) AS score
             FROM ${SHADOW} WHERE model_id = $2
             ORDER BY vector <=> $1::vector LIMIT $3`,
            [serializeVector(recall.queries[i].vec), MODEL_ID, K]
          );
          const gotIds = new Set(rows.map((r) => Number(r.node_id)));
          const byNode = new Set();
          for (const id of gotIds) byNode.add(id);
          for (const r of oracleTop50[i]) if (byNode.has(r.nodeId)) hitsAt100 += 1;
        }
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      const recallAt100 = hitsAt100 / (K * recall.queries.length);
      // eslint-disable-next-line no-console
      console.info(`[pgvector leg] ef=100 contrast recall@50 = ${recallAt100.toFixed(4)}`);
      expect(recallAt100).toBeLessThanOrEqual(1); // evidence print; no floor asserted at 100
    }, 120000);

    it('rebuildShadow() from canonical TEXT reproduces identical neighbor results', async () => {
      const q = recall.queries[0];
      const before = await adapter.neighbors(q.vec, K, null);
      await pool.query(`DROP TABLE IF EXISTS ${SHADOW}`); // derived artifact destroyed
      await adapter.rebuildShadow();
      const after = await adapter.neighbors(q.vec, K, null);
      expect(after.map((r) => r.nodeId)).toEqual(before.map((r) => r.nodeId));
      for (let i = 0; i < before.length; i++) {
        expect(after[i].score).toBeCloseTo(before[i].score, 9);
      }
      expect(await shadowRowCount()).toBe(recall.rows.length);
    }, 120000);
  });
});
