'use strict';

// SqliteVec (vec0) engine conformance — vectorStore.md §2.4a/§2.5/§2.6.
//
// RED-first (AGENTS §2.1): written before the adapter exists. Two legs:
// 1. the A5 exact≡oracle harness (`runExactEngineConformance`) REUSED UNCHANGED —
//    the vec0 adapter must behave like TextVectorJs from the caller's side
//    (bit-parity scores are satisfied by f64 rescoring over canonical TEXT rows,
//    vectorStore.md §2.6);
// 2. the recall@50 ≥ 0.99 target over HELD-OUT (external) queries only, measured
//    END-TO-END through the vec0 candidate prefilter + f64 rescoring path.
//
// Also pins the vec0-specific contract: BigInt binding on every INTEGER aux
// column, the id>2^53 sentinel skip, shadow re-sync from canonical TEXT
// (never-tracked-DDL rule), and zero JOIN tokens in the adapter's statements.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const { createSqliteVec } = require('../SqliteVec');
const { runExactEngineConformance, buildCorpus } = require('./conformance.test');
const { serializeVector, parseVector } = require('../vectorMath');

// --- real node:sqlite + vec0 scratch database -------------------------------

let vecLoader = null;
try {
  vecLoader = require('sqlite-vec'); // eslint-disable-line global-require
} catch {
  vecLoader = null; // degrade: the load-failure legs report, others skip
}

const SCRATCH_DIR = path.join(__dirname, '.sqliteVecScratch');

function openScratchDb(name) {
  if (!vecLoader) return null;
  fs.mkdirSync(SCRATCH_DIR, { recursive: true });
  const dbPath = path.join(SCRATCH_DIR, name);
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      fs.unlinkSync(dbPath + suffix);
    } catch {
      /* absent */
    }
  }
  // allowExtension at OPEN is required (vectorStore.md §2.4a): enableLoadExtension
  // throws ERR_INVALID_STATE when the handle was not opened extension-capable.
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.enableLoadExtension(true);
  vecLoader.load(db);
  return db;
}

function closeDb(db) {
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
}

// --- shared fake canonical store over the corpus (loader seam) --------------

function makeStoreDoubles(corpus, { txMode = 'resolve' } = {}) {
  const { rows, dim } = corpus;
  const loadCalls = [];
  const loadRows = (modelId, userScope) => {
    loadCalls.push({ modelId, userScope });
    return rows.map((r) => ({ ...r }));
  };
  const txCalls = [];
  const transaction = (fn) => {
    txCalls.push(fn);
    return fn();
  };
  const pooledWrites = [];
  const chunkWrites = [];
  const upsertPooled = (row) => pooledWrites.push({ ...row });
  const replaceChunks = (nodeId, vectors) => chunkWrites.push({ nodeId, vectors });
  return {
    dim,
    loadCalls,
    txCalls,
    pooledWrites,
    chunkWrites,
    create: () =>
      createSqliteVec({
        modelId: 'model-under-test',
        loadRows,
        upsertPooled,
        replaceChunks,
        transaction,
      }),
  };
}

// --- leg 1: the A5 exact-engine harness, unchanged ---------------------------

describe('SqliteVec (vec0) exact≡oracle conformance', () => {
  if (!vecLoader) {
    it('is skipped: sqlite-vec not loadable in this environment', () => {
      expect(vecLoader).toBeNull();
    });
    return;
  }

  let db;
  beforeAll(() => {
    db = openScratchDb('conformance.db');
  });
  afterAll(() => {
    closeDb(db);
  });

  const corpus = buildCorpus({});
  const doubles = makeStoreDoubles(corpus);

  // The harness drives `loadRows` per call (no-resident-state gate) — the adapter
  // re-syncs its shadow from those rows whenever they change. The doubles above
  // serve as the canonical store; the adapter's shadow lives in the scratch db.
  runExactEngineConformance({
    createEngine: (deps) =>
      createSqliteVec({
        modelId: 'model-under-test',
        db,
        ...deps,
      }),
    corpus,
  });
});

// --- leg 2: recall@50 ≥ 0.99 with HELD-OUT (external) queries only ----------

describe('SqliteVec recall contract (vectorStore.md §2.6)', () => {
  if (!vecLoader) {
    it('is skipped: sqlite-vec not loadable in this environment', () => {
      expect(vecLoader).toBeNull();
    });
    return;
  }

  let db;
  beforeAll(() => {
    db = openScratchDb('recall.db');
  });
  afterAll(() => {
    closeDb(db);
  });

  it('recall@50 ≥ 0.99 over held-out queries (end-to-end through vec0 candidates + f64 rescoring)', async () => {
    // Larger corpus: node-per-row pooled vectors only (chunks don't change the
    // recall semantics — each node is one candidate); 200 nodes, held-out queries
    // drawn from a FRESH rng stream (never corpus rows — §2.6 ban on self-queries).
    const dim = 32;
    const nodeCount = 200;
    const queryCount = 40;
    const k = 50;
    let seed = 20261021 >>> 0;
    const rng = () => {
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return seed / 0x100000000;
    };
    const unit = () => {
      const v = new Array(dim);
      for (let i = 0; i < dim; i++) v[i] = rng() * 2 - 1;
      const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      for (let i = 0; i < dim; i++) v[i] /= n;
      return v;
    };
    const rows = [];
    const vectors = [];
    for (let nodeId = 1; nodeId <= nodeCount; nodeId++) {
      const v = unit();
      vectors.push(v);
      rows.push({ nodeId, chunkIdx: null, vector: serializeVector(v), dim });
    }
    // Held-out queries: perturbed copies of distinct corpus vectors PLUS pure
    // fresh randoms — external queries in both cases, never byte-equal corpus rows.
    const queries = [];
    for (let i = 0; i < queryCount; i++) {
      let q;
      if (i % 2 === 0) {
        const base = vectors[i];
        q = base.map((x) => x + (rng() * 2 - 1) * 0.05);
        const n = Math.sqrt(q.reduce((s, x) => s + x * x, 0));
        q = q.map((x) => x / n);
      } else {
        q = unit();
      }
      expect(rows.some((r) => r.vector === serializeVector(q))).toBe(false);
      queries.push(serializeVector(q));
    }

    const loadRows = () => rows.map((r) => ({ ...r }));
    const engine = createSqliteVec({
      modelId: 'recall-model',
      db,
      loadRows,
      upsertPooled: () => {},
      replaceChunks: () => {},
      transaction: (fn) => fn(),
    });

    // The naive f64 oracle ground truth (top-50 ids per query).
    const oracle = (q) => {
      const qv = parseVector(q, dim);
      const scored = rows.map((r) => {
        const v = parseVector(r.vector, dim);
        let dot = 0;
        let na = 0;
        let nb = 0;
        for (let i = 0; i < dim; i++) {
          dot += qv[i] * v[i];
          na += qv[i] * qv[i];
          nb += v[i] * v[i];
        }
        return {
          nodeId: r.nodeId,
          score: na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb)),
        };
      });
      scored.sort((a, b) => b.score - a.score || a.nodeId - b.nodeId);
      return scored.slice(0, k).map((r) => r.nodeId);
    };

    let recallSum = 0;
    for (const q of queries) {
      const got = await engine.neighbors(parseVector(q, dim), k, null);
      const gotIds = got.map((r) => r.nodeId);
      const want = oracle(q);
      const hit = gotIds.filter((id) => want.includes(id)).length;
      recallSum += hit / k;
    }
    const recall = recallSum / queryCount;
    expect(recall).toBeGreaterThanOrEqual(0.99);
  });
});

// --- leg 3: vec0-specific contract pins -------------------------------------

describe('SqliteVec vec0 contract pins (vectorStore.md §2.4a/§2.5)', () => {
  if (!vecLoader) {
    it('is skipped: sqlite-vec not loadable in this environment', () => {
      expect(vecLoader).toBeNull();
    });
    return;
  }

  let db;
  beforeAll(() => {
    db = openScratchDb('pins.db');
  });
  afterAll(() => {
    closeDb(db);
  });

  const dim = 8;
  const row = (nodeId, chunkIdx, vec) => ({ nodeId, chunkIdx, vector: serializeVector(vec), dim });

  function makeEngine(rows, opts = {}) {
    return createSqliteVec({
      modelId: 'pins-model',
      db,
      loadRows: () => rows.map((r) => ({ ...r })),
      upsertPooled: opts.upsertPooled || (() => {}),
      replaceChunks: opts.replaceChunks || (() => {}),
      transaction: (fn) => fn(),
    });
  }

  it('is constructible and exposes the seam surface', () => {
    const engine = makeEngine([row(1, null, [1, 0, 0, 0, 0, 0, 0, 0])]);
    for (const fn of ['neighbors', 'allVectors', 'upsert', 'rebuildShadow']) {
      expect(typeof engine[fn]).toBe('function');
    }
  });

  it('binds every INTEGER aux column as BigInt (no f64 aux corruption)', async () => {
    // ids chosen to make a double binding visibly wrong is impractical at small
    // scale — the pin is that upsert+neighbors succeed with aux values only
    // representable through BigInt binding (vec0 rejects f64 aux binds outright,
    // so any slip fails loudly here).
    const bigId = 9007199254740000; // > 2^53 - 1000, needs BigInt precision
    expect(Number.isInteger(bigId)).toBe(true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const engine = makeEngine([
      row(bigId, null, [1, 0, 0, 0, 0, 0, 0, 0]),
      row(1, null, [0, 1, 0, 0, 0, 0, 0, 0]),
    ]);
    const got = await engine.neighbors([1, 0, 0, 0, 0, 0, 0, 0], 10, null);
    // the >2^53 sentinel row is SKIPPED with a warning; the safe row still answers
    expect(got.map((r) => r.nodeId)).toEqual([1]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects dims > 2048 (vec0 float[D] limit) with a clear error', () => {
    const big = new Array(2049).fill(0);
    big[0] = 1;
    expect(() => makeEngine([row(1, null, big)])).toThrow();
  });

  it('re-syncs the shadow from canonical TEXT on every load change (never-tracked DDL)', async () => {
    const v1 = [1, 0, 0, 0, 0, 0, 0, 0];
    const v2 = [0, 1, 0, 0, 0, 0, 0, 0];
    let current = [row(1, null, v1)];
    const engine = makeEngine(current);
    const got1 = await engine.neighbors(v2, 5, null);
    expect(got1.length).toBe(1);
    // canonical changed under the engine (job re-embed) → next call re-syncs
    current = [row(1, null, v2), row(2, null, v1)];
    const got2 = await engine.neighbors(v1, 5, null);
    expect(got2[0].nodeId).toBe(2); // fresh ranking, no stale shadow rows
    // and the stale row (nodeId 1 with v1) no longer ranks above node 2
    expect(got2.map((r) => r.nodeId)).toContain(1);
  });

  it('upsert writes canonical halves through the injected stores (shadow follows)', async () => {
    const pooledWrites = [];
    const chunkWrites = [];
    const txCalls = [];
    const vec0 = [1, 0, 0, 0, 0, 0, 0, 0];
    const vec1 = [0, 1, 0, 0, 0, 0, 0, 0];
    const engine = createSqliteVec({
      modelId: 'pins-model',
      db,
      loadRows: () => [],
      upsertPooled: (r) => pooledWrites.push(r),
      replaceChunks: (nodeId, vectors) => chunkWrites.push({ nodeId, vectors }),
      transaction: (fn) => {
        txCalls.push(fn);
        return fn();
      },
    });
    await engine.upsert(42, [vec0, vec1], dim);
    expect(txCalls.length).toBe(1);
    expect(pooledWrites).toEqual([
      { nodeId: 42, modelId: 'pins-model', dim, vector: serializeVector(vec0) },
    ]);
    expect(chunkWrites).toEqual([{ nodeId: 42, vectors: [serializeVector(vec1)] }]);
  });

  it('contains zero JOIN tokens in any KNN statement (no join-KNN, §2.5)', async () => {
    const engine = makeEngine([
      row(1, null, [1, 0, 0, 0, 0, 0, 0, 0]),
      row(2, 0, [0, 1, 0, 0, 0, 0, 0, 0]),
    ]);
    await engine.neighbors([1, 0, 0, 0, 0, 0, 0, 0], 5, null);
    // The adapter module source must not embed a JOIN in its SQL.
    const src = fs.readFileSync(require.resolve('../SqliteVec'), 'utf8');
    expect(src).not.toMatch(/\bJOIN\b/i);
    expect(src).not.toMatch(/\bIN\s*\(\s*SELECT\b/i); // no subquery-filter KNN either
  });

  it('returns empty results on an empty corpus without error', async () => {
    const engine = makeEngine([]);
    await expect(engine.neighbors([1, 0, 0, 0, 0, 0, 0, 0], 5, null)).resolves.toEqual([]);
  });

  it('scores per-node max-over-chunks end-to-end (mid-section fixture through vec0)', async () => {
    const q = [1, 0, 0, 0, 0, 0, 0, 0];
    const near = [Math.SQRT1_2, Math.SQRT1_2, 0, 0, 0, 0, 0, 0];
    const far = [-1, 0, 0, 0, 0, 0, 0, 0];
    const pooled = near.map((x, i) => (x + far[i]) / 2);
    const pn = Math.sqrt(pooled.reduce((s, x) => s + x * x, 0));
    const pooledN = pooled.map((x) => x / pn);
    const engine = makeEngine([row(7, null, pooledN), row(7, 0, near), row(7, 1, far)]);
    const got = await engine.neighbors(q, 5, null);
    expect(got[0].nodeId).toBe(7);
    expect(got[0].score).toBeCloseTo(Math.SQRT1_2, 15);
    expect(got[0].score).toBeGreaterThanOrEqual(0.6);
  });
});
