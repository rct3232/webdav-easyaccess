'use strict';

// Unit tests for the C2 semantic scorer (searchService.md §2.5a seam).
// Covers: MIN-across-segments, max-over-chunks, baseline exclusion, gate band,
// cap 50, ACL scoping, and the absence/degrade paths.

const { createSemanticScorer } = require('../semanticScorer');

const USER = 1;
const MODEL_ID = 7;
const DELTA_BASE = 0.08;

function makeFakeModelsStore(model = { id: MODEL_ID, provider: 'embedded', role: 'embed' }) {
  return { getActiveByRole: jest.fn(async (role) => (role === 'embed' ? model : null)) };
}

function makeFakePresets(deltaBase = DELTA_BASE) {
  return {
    getPresetByFamilyRole: jest.fn((provider, role) =>
      role === 'embed' ? { profile: { deltaBase } } : null
    ),
  };
}

function makeFakeFileNodesStore(visibleIds = []) {
  return {
    getUserRootNode: jest.fn(async () => ({ id: 100 })),
    listVisibleFileNodeIds: jest.fn(async () => visibleIds),
    sampleVisibleNodeIds: jest.fn(async () => visibleIds.slice(0, 10)),
  };
}

describe('semanticScorer — absence and degrade paths', () => {
  it('returns [] when there is no active embed model', async () => {
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(null),
    });
    const result = await score({ userId: USER, segmentVecs: [[1]], sampleFn: async () => [] });
    expect(result).toEqual([]);
  });

  it('returns [] when the profile lacks a finite deltaBase (ungated result is a violation)', async () => {
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      // NB: passing `undefined` would fall through makeFakePresets' default
      // parameter — NaN tests the non-finite branch (Number(undefined)=NaN takes
      // the identical path, so a missing field degrades the same way).
      presets: makeFakePresets(Number.NaN),
    });
    const result = await score({ userId: USER, segmentVecs: [[1]], sampleFn: async () => [] });
    expect(result).toEqual([]);
  });

  it('returns [] when there are no segment vectors', async () => {
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
    });
    const result = await score({ userId: USER, segmentVecs: [], sampleFn: async () => [] });
    expect(result).toEqual([]);
  });
});

describe('semanticScorer — BASELINE_SAMPLE_DOCS config seam', () => {
  function makeEngineFactory(candidateIds) {
    return () => ({
      neighbors: jest.fn(async (segVec, k, candidates) =>
        [...candidates]
          .filter((id) => candidateIds.includes(id))
          .map((id) => ({ nodeId: id, score: 0.9 }))
          .slice(0, k)
      ),
    });
  }

  it('resolves the baseline sample cap on EVERY score() call (hot config, no restart)', async () => {
    const config = { BASELINE_SAMPLE_DOCS: '7' };
    const caps = [];
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore([10]),
      engineFactory: makeEngineFactory([10]),
      configResolver: {
        getConfig: jest.fn(async (key) =>
          key === 'BASELINE_SAMPLE_DOCS' ? config.BASELINE_SAMPLE_DOCS : undefined
        ),
      },
    });
    const sampleFn = async (n) => {
      caps.push(n);
      return [];
    };

    await score({ userId: USER, segmentVecs: [[1]], sampleFn });
    config.BASELINE_SAMPLE_DOCS = 13;
    await score({ userId: USER, segmentVecs: [[1]], sampleFn });

    expect(caps).toEqual([7, 13]);
  });

  it('falls back to 500 when the configured value is missing or non-numeric', async () => {
    const caps = [];
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore([10]),
      engineFactory: makeEngineFactory([10]),
      configResolver: { getConfig: async () => 'not-a-number' },
    });
    const sampleFn = async (n) => {
      caps.push(n);
      return [];
    };

    await score({ userId: USER, segmentVecs: [[1]], sampleFn });
    expect(caps).toEqual([500]);
  });
});

describe('semanticScorer — scoring engine (TextVectorJs oracle + injected engineFactory)', () => {
  it('MIN-across-segments: doc score = min over the segment scores (segment-AND)', async () => {
    // Candidate A: seg1=0.9, seg2=0.5 → min 0.5
    // Candidate B: seg1=0.6, seg2=0.8 → min 0.6
    // spread = 0 (empty sample); deltaBase = 0.08 ⇒ top 0.6 ≥ 0.08 keep
    const engineCalls = [];
    const engineFactory = (_modelId, _loadRows) => ({
      neighbors: jest.fn(async (segVec, k, candidates) => {
        engineCalls.push({ segVec, k, candidates });
        const isSeg1 = segVec[0] === 1;
        const rows = [];
        if (isSeg1) {
          rows.push({ nodeId: 10, score: 0.9 });
          rows.push({ nodeId: 11, score: 0.6 });
        } else {
          rows.push({ nodeId: 10, score: 0.5 });
          rows.push({ nodeId: 11, score: 0.8 });
        }
        return rows.filter((r) => candidates.has(r.nodeId)).slice(0, k);
      }),
    });
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore([10, 11]),
      engineFactory,
    });
    const result = await score({
      userId: USER,
      segmentVecs: [[1], [2]],
      sampleFn: async () => [],
    });
    // Both candidates pass the gate; sorted score desc then nodeId asc
    expect(result).toEqual([
      { nodeId: 11, score: 0.6 },
      { nodeId: 10, score: 0.5 },
    ]);
    expect(result[0].nodeId).toBe(11);
    expect(result[1].nodeId).toBe(10);
  });

  it('baseline exclusion: candidates are removed from the baseline sample', async () => {
    // Candidates: {10: min 0.9}; sample from sampleFn: [10, 20, 30]
    // The scorer must EXCLUDE 10 from the sample ⇒ spread = max(min over [20, 30])
    let engineCall = 0;
    const engineFactory = (_modelId, _loadRows) => ({
      neighbors: jest.fn(async (segVec, k, candidates) => {
        engineCall += 1;
        const rows = [];
        for (const id of candidates) {
          if (id === 10) rows.push({ nodeId: 10, score: 0.9 });
          if (id === 20) rows.push({ nodeId: 20, score: 0.2 });
          if (id === 30) rows.push({ nodeId: 30, score: 0.1 });
        }
        // Cut phase (call 1): only the true match surfaces into the top-k — a
        // real ANN ranks ordinary corpus docs below the match. Without
        // exclusion, node 10 (score 0.9) would contaminate the sample, pinning
        // spread to 0.9 and rejecting the scorer's own top hit. The
        // exact-score pass (call 2) returns full scores for every
        // candidate ∪ sample id.
        return (engineCall === 1 ? rows.filter((row) => row.nodeId === 10) : rows).slice(0, k);
      }),
    });
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore([10, 20, 30]),
      engineFactory,
    });
    const result = await score({
      userId: USER,
      segmentVecs: [[1]],
      sampleFn: async () => [10, 20, 30], // 10 is a candidate ⇒ excluded from the sample
    });
    // spread = 0.2 (max min over sample {20, 30}) — NOT 0.9 (contaminated)
    // top = 0.9 ≥ spread + deltaBase = 0.28 ⇒ keep
    expect(result).toEqual([{ nodeId: 10, score: 0.9 }]);
  });

  it('gate band: below spread + deltaBase ⇒ honestly empty', async () => {
    // Candidates: {10: min 0.15}; sample: {20: min 0.2}
    // top = 0.15 < spread + deltaBase = 0.28 ⇒ reject
    let engineCall = 0;
    const engineFactory = (_modelId, _loadRows) => ({
      neighbors: jest.fn(async (segVec, k, candidates) => {
        engineCall += 1;
        const rows = [];
        for (const id of candidates) {
          if (id === 10) rows.push({ nodeId: 10, score: 0.15 });
          if (id === 20) rows.push({ nodeId: 20, score: 0.2 });
        }
        // Cut phase (call 1): only node 10 (score 0.15) surfaces into the
        // top-k; node 20 (score 0.2) stays below the cut and reaches the
        // exact-score pass through the baseline sample. The exact-score pass
        // (call 2) returns full scores for every candidate ∪ sample id.
        return (engineCall === 1 ? rows.filter((row) => row.nodeId === 10) : rows).slice(0, k);
      }),
    });
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore([10, 20]),
      engineFactory,
    });
    const result = await score({
      userId: USER,
      segmentVecs: [[1]],
      sampleFn: async () => [20],
    });
    expect(result).toEqual([]);
  });

  it('cap 50: the per-segment cut is k=50 (not the whole visible set)', async () => {
    const visibleIds = Array.from({ length: 100 }, (_, i) => i + 1);
    const engineCalls = [];
    const engineFactory = (_modelId, _loadRows) => ({
      neighbors: jest.fn(async (segVec, k, candidates) => {
        engineCalls.push({ k });
        return [...candidates].slice(0, k).map((id) => ({ nodeId: id, score: 0.9 }));
      }),
    });
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore(visibleIds),
      engineFactory,
    });
    await score({
      userId: USER,
      segmentVecs: [[1]],
      sampleFn: async () => [],
    });
    expect(engineCalls[0].k).toBe(50);
  });

  it('ACL scoping: the engine receives the visible set as candidates', async () => {
    const visibleIds = [10, 20];
    const engineCalls = [];
    const engineFactory = (_modelId, _loadRows) => ({
      neighbors: jest.fn(async (segVec, k, candidates) => {
        engineCalls.push({ candidates });
        return [...candidates].map((id) => ({ nodeId: id, score: 0.9 }));
      }),
    });
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore(visibleIds),
      engineFactory,
    });
    await score({ userId: USER, segmentVecs: [[1]], sampleFn: async () => [] });
    expect(engineCalls[0].candidates).toBeInstanceOf(Set);
    expect([...engineCalls[0].candidates].sort((a, b) => a - b)).toEqual([10, 20]);
  });

  it('max-over-chunks: the engine (not the scorer) folds chunk rows per node', async () => {
    // The scorer relies on the seam's max-over-chunks contract: a node with
    // chunk rows {0.4, 0.85} must be scored 0.85 (its best chunk).
    const engineFactory = (_modelId, _loadRows) => ({
      neighbors: jest.fn(async (segVec, k, candidates) => {
        // Simulate the seam's per-node max-over-chunks reduction.
        const byNode = new Map();
        for (const nodeId of candidates) {
          const chunkScores = nodeId === 10 ? [0.4, 0.85] : [0.5];
          byNode.set(nodeId, Math.max(...chunkScores));
        }
        return [...byNode]
          .map(([nodeId, score]) => ({ nodeId, score }))
          .sort((a, b) => b.score - a.score)
          .slice(0, k);
      }),
    });
    const score = createSemanticScorer({
      llmModelsStore: makeFakeModelsStore(),
      presets: makeFakePresets(),
      fileNodesStore: makeFakeFileNodesStore([10, 11]),
      engineFactory,
    });
    const result = await score({ userId: USER, segmentVecs: [[1]], sampleFn: async () => [] });
    expect(result[0]).toEqual({ nodeId: 10, score: 0.85 });
  });
});
