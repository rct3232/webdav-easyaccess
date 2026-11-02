'use strict';

// Exact≡oracle conformance harness (vectorStore.md §2.6, vectorMath.md §3.4/§5).
//
// The oracle leg recomputes neighbor rankings with INDEPENDENT plain
// arithmetic over the raw serialized TEXT rows — it deliberately does not use
// the vectorMath helpers, so the engine's codec and math are cross-checked,
// not self-referential. Exact engines must match the oracle bit-for-bit on
// scores and identically on order/ids.
//
// RED-first: written before TextVectorJs exists (AGENTS §2.1).

const { createTextVectorJs } = require('../TextVectorJs');
const { serializeVector } = require('../vectorMath');

// --- deterministic PRNG (xorshift32; Math.random is banned in pure code) ---

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

function randomUnitVector(dim, rng) {
  const v = new Array(dim);
  for (let i = 0; i < dim; i++) v[i] = rng() * 2 - 1;
  let sum = 0;
  for (let i = 0; i < dim; i++) sum += v[i] * v[i];
  const n = Math.sqrt(sum);
  if (n === 0) return randomUnitVector(dim, rng);
  for (let i = 0; i < dim; i++) v[i] /= n;
  return v;
}

// --- independent oracle arithmetic (no vectorMath imports) ---

function oracleParse(text) {
  return text.split(',').map(Number);
}

function oracleDot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

function oracleNorm(a) {
  return Math.sqrt(oracleDot(a, a));
}

function oracleCosine(a, b) {
  const na = oracleNorm(a);
  const nb = oracleNorm(b);
  if (na === 0 || nb === 0) return 0;
  return oracleDot(a, b) / (na * nb);
}

// score = per-node max over chunk cosines when chunks exist, pooled otherwise
function oracleNeighbors(queryText, rows, candidates, k) {
  const q = oracleParse(queryText);
  const qn = oracleNorm(q);
  const byNode = new Map();
  for (const row of rows) {
    if (candidates && !candidates.has(row.nodeId)) continue;
    if (row.dim !== q.length) continue;
    const v = oracleParse(row.vector);
    let c = oracleCosine(q, v);
    if (qn === 0) c = 0; // zero-norm query scores 0 everywhere (same rule both sides)
    const cur = byNode.get(row.nodeId);
    if (cur === undefined || c > cur) byNode.set(row.nodeId, c);
  }
  const scored = [...byNode].map(([nodeId, score]) => ({ nodeId, score }));
  scored.sort((x, y) => y.score - x.score || x.nodeId - y.nodeId);
  return scored.slice(0, k);
}

// --- fixture corpus (deterministic) ---

function buildCorpus({ seed = 20260420, dim = 16, nodeCount = 40, chunkyCount = 12 } = {}) {
  const rng = xorshift32(seed);
  const rows = []; // { nodeId, chunkIdx(null=pooled), vector TEXT, dim }
  const meta = []; // { nodeId, chunkCount }
  for (let nodeId = 1; nodeId <= nodeCount; nodeId++) {
    const chunky = nodeId <= chunkyCount;
    const chunkCount = chunky ? 1 + (nodeId % 4) : 0; // 1..4 chunks
    const chunkVectors = [];
    for (let c = 0; c < chunkCount; c++) chunkVectors.push(randomUnitVector(dim, rng));
    let pooled;
    if (chunky) {
      pooled = new Array(dim).fill(0);
      for (const cv of chunkVectors) for (let i = 0; i < dim; i++) pooled[i] += cv[i];
      for (let i = 0; i < dim; i++) pooled[i] /= chunkVectors.length;
      const n = Math.sqrt(pooled.reduce((s, x) => s + x * x, 0));
      for (let i = 0; i < dim; i++) pooled[i] /= n;
    } else {
      pooled = randomUnitVector(dim, rng);
    }
    rows.push({ nodeId, chunkIdx: null, vector: serializeVector(pooled), dim });
    chunkVectors.forEach((cv, c) =>
      rows.push({ nodeId, chunkIdx: c, vector: serializeVector(cv), dim })
    );
    meta.push({ nodeId, chunkCount });
  }
  // Held-out queries: a FRESH rng stream, and asserted never to byte-match a
  // corpus row (vectorStore.md §2.6 — self-queries are banned as grading input).
  const queries = [];
  for (let i = 0; i < 12; i++) {
    const q = randomUnitVector(dim, rng);
    const text = serializeVector(q);
    expect(rows.every((r) => r.vector !== text)).toBe(true);
    queries.push(text);
  }
  return { dim, rows, meta, queries };
}

// --- the reusable exact-engine conformance runner ---

function runExactEngineConformance({ createEngine, corpus, k = 10 }) {
  const { dim, rows, meta, queries } = corpus;

  // In-memory canonical doubles standing in for embeddingsStore/embeddingsChunkStore.
  const store = {
    pooled: new Map(),
    chunks: new Map(),
  };
  for (const r of rows) {
    if (r.chunkIdx === null) {
      store.pooled.set(r.nodeId, r);
    } else {
      if (!store.chunks.has(r.nodeId)) store.chunks.set(r.nodeId, []);
      store.chunks.get(r.nodeId).push(r);
    }
  }
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

  const engine = createEngine({ loadRows, upsertPooled, replaceChunks, transaction });

  describe('exact ≡ oracle (vectorStore.md §2.6)', () => {
    it('neighbors matches the naive oracle bit-for-bit on held-out queries', async () => {
      for (const queryText of queries) {
        const got = await engine.neighbors(oracleParse(queryText), k, null);
        const want = oracleNeighbors(queryText, rows, null, k);
        expect(got.length).toBe(want.length);
        for (let i = 0; i < want.length; i++) {
          expect(got[i].nodeId).toBe(want[i].nodeId);
          expect(got[i].score).toBe(want[i].score); // bit parity, not tolerance
        }
      }
    });

    it('scores per-node MAX over chunks (mid-section regression fixture)', async () => {
      // Deliberate construction: chunk near the query (cos ≈ 0.71 ≥ 0.6) while
      // the pooled mean is near-orthogonal (< 0.5) — pooled-only scoring hides
      // the match (searchService §2.3; vectorStore.md §5).
      const qDim = dim;
      const q = new Array(qDim).fill(0);
      q[0] = 1;
      const near = new Array(qDim).fill(0);
      near[0] = Math.SQRT1_2;
      near[1] = Math.SQRT1_2; // cos(q, near) = 1/√2 ≈ 0.707
      const far = new Array(qDim).fill(0);
      far[0] = -1; // cos(q, far) = -1; mean of near+far ≈ orthogonal to q
      const pooled = q.map((_, i) => (near[i] + far[i]) / 2);
      const pn = Math.sqrt(pooled.reduce((s, x) => s + x * x, 0));
      for (let i = 0; i < qDim; i++) pooled[i] /= pn;
      const pooledOnly = oracleCosine(q, pooled);
      expect(pooledOnly).toBeLessThan(0.5);
      const nodeId = 987654;
      const fixtureRows = [
        { nodeId, chunkIdx: null, vector: serializeVector(pooled), dim: qDim },
        { nodeId, chunkIdx: 0, vector: serializeVector(near), dim: qDim },
        { nodeId, chunkIdx: 1, vector: serializeVector(far), dim: qDim },
      ];
      const fixtureEngine = createEngine({
        loadRows: () => fixtureRows.map((r) => ({ ...r })),
        upsertPooled: () => {},
        replaceChunks: () => {},
        transaction: (fn) => fn(),
      });
      const got = await fixtureEngine.neighbors(q, 5, null);
      expect(got[0].nodeId).toBe(nodeId);
      expect(got[0].score).toBeCloseTo(Math.SQRT1_2, 15);
      expect(got[0].score).toBeGreaterThanOrEqual(0.6);
    });

    it('dedups node ids before k is cut (chunky nodes occupy one slot)', async () => {
      const queryText = queries[0];
      const got = await engine.neighbors(oracleParse(queryText), k, null);
      const ids = got.map((r) => r.nodeId);
      expect(new Set(ids).size).toBe(ids.length);
      const chunkyPresent = ids.filter((id) => meta[id - 1].chunkCount > 0);
      const want = oracleNeighbors(queryText, rows, null, k).map((r) => r.nodeId);
      expect(ids).toEqual(want); // the oracle already applies dedup-before-k
      expect(chunkyPresent.length).toBeGreaterThan(0); // chunky nodes really compete
    });

    it('restricts ranking to the candidates set (invisible never appears)', async () => {
      for (const queryText of queries) {
        const visible = new Set();
        for (const m of meta) if (m.nodeId % 2 === 0) visible.add(m.nodeId);
        const got = await engine.neighbors(oracleParse(queryText), k, visible);
        const want = oracleNeighbors(queryText, rows, visible, k);
        expect(got.map((r) => r.nodeId)).toEqual(want.map((r) => r.nodeId));
        for (const r of got) expect(r.nodeId % 2).toBe(0);
      }
    });

    it('accepts a predicate as candidates and agrees with the Set form', async () => {
      const visible = new Set(meta.filter((m) => m.nodeId % 2 === 0).map((m) => m.nodeId));
      const pred = (id) => id % 2 === 0;
      for (const queryText of queries) {
        const viaSet = await engine.neighbors(oracleParse(queryText), k, visible);
        const viaPred = await engine.neighbors(oracleParse(queryText), k, pred);
        expect(viaPred).toEqual(viaSet);
      }
    });

    it('skips rows whose dim differs from the query (space-key discipline)', async () => {
      const odd = [{ nodeId: 1, chunkIdx: null, vector: serializeVector([1, 0, 0, 0, 0]), dim: 5 }];
      const oddEngine = createEngine({
        loadRows: () => odd.map((r) => ({ ...r })),
        upsertPooled: () => {},
        replaceChunks: () => {},
        transaction: (fn) => fn(),
      });
      await expect(oddEngine.neighbors([1, 0], 5, null)).resolves.toEqual([]);
    });

    it('zero-norm vectors score 0 (cosine has no direction)', async () => {
      const zero = [
        { nodeId: 1, chunkIdx: null, vector: serializeVector(new Array(dim).fill(0)), dim },
      ];
      const zeroEngine = createEngine({
        loadRows: () => zero.map((r) => ({ ...r })),
        upsertPooled: () => {},
        replaceChunks: () => {},
        transaction: (fn) => fn(),
      });
      const got = await zeroEngine.neighbors([1, ...new Array(dim - 1).fill(0)], 5, null);
      expect(got).toEqual([{ nodeId: 1, score: 0 }]);
    });

    it('is deterministic: repeated calls return identical output', async () => {
      const a = await engine.neighbors(oracleParse(queries[1]), k, null);
      const b = await engine.neighbors(oracleParse(queries[1]), k, null);
      expect(b).toEqual(a);
    });

    it('keeps NO resident state: every call re-loads rows', async () => {
      const before = loadCalls.length;
      await engine.allVectors(null);
      await engine.allVectors(null);
      expect(loadCalls.length).toBe(before + 2);
      await engine.neighbors(oracleParse(queries[2]), k, null);
      expect(loadCalls.length).toBe(before + 3);
    });

    it('allVectors returns parsed pooled + chunk rows for the bound model', async () => {
      const all = await engine.allVectors(null);
      expect(all.length).toBe(rows.length);
      expect(loadCalls.every((c) => c.modelId === 'model-under-test')).toBe(true);
      for (const r of all) {
        expect(Array.isArray(r.vector)).toBe(true);
        expect(r.vector.length).toBe(dim);
      }
    });

    it('upsert writes the pooled half and chunk half inside ONE transaction', async () => {
      const vec0 = randomUnitVector(dim, xorshift32(77));
      const vec1 = randomUnitVector(dim, xorshift32(78));
      const vec2 = randomUnitVector(dim, xorshift32(79));
      await engine.upsert(42, [vec0, vec1, vec2], dim);
      expect(txCalls.length).toBe(1); // both halves in one TX
      expect(pooledWrites).toEqual([
        { nodeId: 42, modelId: 'model-under-test', dim, vector: serializeVector(vec0) },
      ]);
      expect(chunkWrites).toEqual([
        { nodeId: 42, vectors: [serializeVector(vec1), serializeVector(vec2)] },
      ]);
    });

    it('upsert with only the pooled row deletes prior chunk rows', async () => {
      const vec0 = randomUnitVector(dim, xorshift32(80));
      await engine.upsert(43, [vec0], dim);
      expect(pooledWrites[pooledWrites.length - 1].nodeId).toBe(43);
      expect(chunkWrites[chunkWrites.length - 1]).toEqual({ nodeId: 43, vectors: [] });
    });

    it('rebuildShadow is a no-op for the artifact-free engine', async () => {
      await expect(engine.rebuildShadow()).resolves.toBeUndefined();
    });
  });
}

// --- A5 leg: the TextVectorJs engine itself under the harness ---

// Exports for the native adapters' conformance legs (vectorMath.md §5): the
// native suites require this file and drive the SAME runner + corpus builder
// unchanged. Requiring this file from a test executes the A5 describe block —
// harmless (its own legs re-run green alongside the requiring suite).

module.exports = { runExactEngineConformance, buildCorpus };

describe('TextVectorJs (JsFallback) conformance', () => {
  const corpus = buildCorpus({});
  runExactEngineConformance({
    createEngine: (deps) => createTextVectorJs({ modelId: 'model-under-test', ...deps }),
    corpus,
  });
});
