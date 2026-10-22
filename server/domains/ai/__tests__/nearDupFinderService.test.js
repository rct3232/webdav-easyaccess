'use strict';

/**
 * nearDupFinderService tests (docs/spec/server/services/nearDupFinderService.md).
 * Fake-injected unit legs (searchService DI precedent); the REAL presets
 * manifest supplies θ_dup and the REAL TextVectorJs scoring path carries the
 * default engine seam — the threshold is never hardcoded in the test either.
 * RED-first: band / hash-first / ACL / self-exclusion / degrade / cap.
 */

const {
  createNearDupFinderService,
  MAX_NEAR_DUP_GROUPS,
} = require('@server/domains/ai/nearDupFinderService');
const presets = require('@server/infrastructure/adapters/llm/presets');
const { serializeVector } = require('@server/domains/ai/vectorStore/vectorMath');

const THETA = presets.getPresetByFamilyRole('embedded', 'embed').profile.thetaDup;
const MODEL = { id: 77, role: 'embed', provider: 'embedded', engine: 'embedded' };
const DIM = 128;
const ROOT = { id: 1 };

/** Pair of unit vectors on axes (i, i+1) with cosine ≈ t. */
function axisPair(i, t) {
  const a = new Array(DIM).fill(0);
  const b = new Array(DIM).fill(0);
  a[i] = 1;
  b[i] = t;
  b[i + 1] = Math.sqrt(1 - t * t);
  return [a, b];
}

function fileRow(nodeId, { hash = null, size = 100, name = `f${nodeId}`, parentId = ROOT.id, type = 'file' } = {}) {
  return { nodeId, parentId, name, type, contentHash: hash, size };
}

function embeddingRow(nodeId, vec) {
  return {
    nodeId,
    modelId: MODEL.id,
    dim: DIM,
    vector: serializeVector(vec),
    source: 'fulltext',
    contentHash: null,
  };
}

function makeFinder({ subtreeRows = [], embeddings = [], model = MODEL, presetsModule, engineFactory } = {}) {
  return createNearDupFinderService({
    fileNodesStore: {
      getUserRootNode: jest.fn().mockResolvedValue(ROOT),
      listSubtreeCacheRows: jest.fn().mockResolvedValue(subtreeRows),
    },
    embeddingsStore: { listAll: jest.fn().mockResolvedValue(embeddings) },
    llmModelsStore: { getActiveByRole: jest.fn().mockResolvedValue(model) },
    ...(presetsModule ? { presets: presetsModule } : {}),
    ...(engineFactory ? { engineFactory } : {}),
  });
}

const EMPTY = { available: false, groups: [], groupCount: 0, duplicateCount: 0 };

describe('nearDupFinderService.findNearDuplicateGroups — threshold band (θ from profile)', () => {
  it('groups a pair at cosine ≥ θ_dup and rejects a pair just below it', async () => {
    const [hi1, hi2] = axisPair(0, THETA + 0.0005);
    const [lo1, lo2] = axisPair(2, THETA - 0.0005);
    const finder = makeFinder({
      subtreeRows: [fileRow(11, { hash: 'h-a' }), fileRow(12, { hash: 'h-b' }), fileRow(13, { hash: 'h-c' }), fileRow(14, { hash: 'h-d' })],
      embeddings: [embeddingRow(11, hi1), embeddingRow(12, hi2), embeddingRow(13, lo1), embeddingRow(14, lo2)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.available).toBe(true);
    expect(result.groupCount).toBe(1);
    expect(result.duplicateCount).toBe(2);
    expect(result.groups[0].nodeIds).toEqual([11, 12]);
    expect(result.groups[0].score).toBeGreaterThanOrEqual(THETA);
    expect(JSON.stringify(result.groups.flatMap((g) => g.nodeIds))).not.toContain('13');
    expect(JSON.stringify(result.groups.flatMap((g) => g.nodeIds))).not.toContain('14');
  });

  it('keeps the smallest node id, maps paths/sizes and orders groups by score desc', async () => {
    const [v1, v2] = axisPair(0, THETA + 0.001);
    const [w1, w2] = axisPair(4, THETA + 0.004); // stronger pair → first group
    const finder = makeFinder({
      subtreeRows: [
        fileRow(21, { hash: 'h-1', size: 300, name: 'keep.txt' }),
        fileRow(22, { hash: 'h-2', size: 500, name: 'member.txt', parentId: 5 }),
        fileRow(23, { hash: 'h-3', size: 10 }),
        fileRow(24, { hash: 'h-4', size: 10 }),
      ],
      embeddings: [embeddingRow(21, v1), embeddingRow(22, v2), embeddingRow(23, w1), embeddingRow(24, w2)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.groupCount).toBe(2);
    const [first, second] = result.groups;
    expect(first.nodeIds).toEqual([23, 24]);
    expect(second.nodeIds).toEqual([21, 22]);
    expect(second.sizeBytes).toEqual([300, 500]); // per-member sizes, aligned with nodeIds
    expect(second.filePaths).toEqual(['/keep.txt', '/member.txt']);
    expect(second.score).toBeGreaterThanOrEqual(THETA);
  });

  it('keeps groups of ≥3 with a single keep and unioned transitive members', async () => {
    const [base, near] = axisPair(0, THETA + 0.001);
    const finder = makeFinder({
      subtreeRows: [fileRow(31, { hash: 'h-1' }), fileRow(32, { hash: 'h-2' }), fileRow(33, { hash: 'h-3' })],
      // 31~32 above θ, 32~33 above θ (same axis construction reused) ⇒ one group of 3
      embeddings: [embeddingRow(31, base), embeddingRow(32, near), embeddingRow(33, base)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.groupCount).toBe(1);
    expect(result.groups[0].nodeIds).toEqual([31, 32, 33]);
    expect(result.duplicateCount).toBe(3);
  });
});

describe('nearDupFinderService — hash-first precedence', () => {
  it('never surfaces an equal content_hash pair, even at cosine 1.0', async () => {
    const vec = axisPair(0, 1)[0];
    const [similar] = axisPair(0, THETA + 0.001); // would pair with 21 were it not a hash twin
    const finder = makeFinder({
      subtreeRows: [fileRow(21, { hash: 'same' }), fileRow(22, { hash: 'same' }), fileRow(23, { hash: 'other' })],
      embeddings: [embeddingRow(21, vec), embeddingRow(22, vec), embeddingRow(23, similar)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.groupCount).toBe(0);
    const ids = JSON.stringify(result.groups.flatMap((g) => g.nodeIds));
    expect(ids).not.toContain('21');
    expect(ids).not.toContain('22');
    expect(ids).not.toContain('23'); // the hash twin cannot drag a non-twin into a group
  });

  it('NULL content_hash rows stay vector candidates (register-b parity with the hash pass)', async () => {
    const [v1, v2] = axisPair(0, THETA + 0.001);
    const finder = makeFinder({
      subtreeRows: [fileRow(41, { hash: null }), fileRow(42, { hash: null })],
      embeddings: [embeddingRow(41, v1), embeddingRow(42, v2)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.available).toBe(true);
    expect(result.groupCount).toBe(1);
    expect(result.groups[0].nodeIds).toEqual([41, 42]);
  });
});

describe('nearDupFinderService — ACL scoping + self-exclusion', () => {
  it('a stranger node with an identical vector never leaks into the requester groups', async () => {
    const vec = axisPair(0, 1)[0];
    const finder = makeFinder({
      // owner subtree lists ONLY node 51 — the stranger's node 999 exists in
      // the model space (embeddings table) but is not visible
      subtreeRows: [fileRow(51, { hash: 'h-1' })],
      embeddings: [embeddingRow(51, vec), embeddingRow(999, vec)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.available).toBe(true);
    expect(result.groupCount).toBe(0);
    expect(JSON.stringify(result.groups)).not.toContain('999');
  });

  it('queries carry the self id and non-candidates in the ENGINE-side predicate (§2.2 seam)', async () => {
    const calls = [];
    const finder = makeFinder({
      subtreeRows: [fileRow(61, { hash: 'h-1' }), fileRow(62, { hash: 'h-2' }), fileRow(63, { hash: 'h-3' })],
      embeddings: [embeddingRow(61, axisPair(0, 1)[0]), embeddingRow(62, axisPair(0, 1)[0]), embeddingRow(63, axisPair(2, 1)[0])],
      engineFactory: (modelId, loadRows) => ({
        neighbors: jest.fn(async (queryVec, k, candidates) => {
          calls.push({ modelId, loadRows, k, candidates });
          return [];
        }),
        allVectors: jest.fn(),
        upsert: jest.fn(),
        rebuildShadow: jest.fn(),
      }),
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.available).toBe(true);
    expect(calls).toHaveLength(3); // one query per candidate node
    for (const call of calls) {
      expect(call.modelId).toBe(MODEL.id);
      expect(typeof call.loadRows).toBe('function');
      expect(call.k).toBeGreaterThanOrEqual(2);
    }
    // the predicate passed for the first query excludes its own node
    const first = calls[0];
    expect(first.candidates(61)).toBe(false);
    expect(first.candidates(62)).toBe(true);
    expect(first.candidates(63)).toBe(true);
    expect(first.candidates(999)).toBe(false);
  });
});

describe('nearDupFinderService — honest degrade (§4.12 absence is data)', () => {
  it.each([
    ['no active embed model', { model: null }],
    [
      'profile without thetaDup',
      {
        model: { id: 78, provider: 'embedded', engine: 'embedded' },
        presetsModule: {
          getPresetByFamilyRole: () => ({ profile: { dim: 768, chPerTok: 1.5 } }),
        },
      },
    ],
    ['empty canonical set', { embeddings: [] }],
    ['single pooled row', { subtreeRows: [fileRow(71, { hash: 'h' })], embeddings: [embeddingRow(71, axisPair(0, 1)[0])] }],
  ])('%s ⇒ available:false, zeros, no throw', async (_name, opts) => {
    const finder = makeFinder({
      subtreeRows: opts.subtreeRows ?? [fileRow(11, { hash: 'h-a' }), fileRow(12, { hash: 'h-b' })],
      embeddings: opts.embeddings ?? [embeddingRow(11, axisPair(0, 1)[0]), embeddingRow(12, axisPair(0, 1)[0])],
      model: 'model' in opts ? opts.model : MODEL,
      presetsModule: opts.presetsModule,
    });

    await expect(finder.findNearDuplicateGroups(42)).resolves.toEqual(EMPTY);
  });

  it('embeddings present but no pair ≥ θ ⇒ available:true with empty groups', async () => {
    const [a] = axisPair(0, 1);
    const [b] = axisPair(2, 1); // orthogonal to a
    const finder = makeFinder({
      subtreeRows: [fileRow(81, { hash: 'h-1' }), fileRow(82, { hash: 'h-2' })],
      embeddings: [embeddingRow(81, a), embeddingRow(82, b)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.available).toBe(true);
    expect(result.groups).toEqual([]);
    expect(result.groupCount).toBe(0);
    expect(result.duplicateCount).toBe(0);
  });

  it('directories are not candidates', async () => {
    const [v1, v2] = axisPair(0, THETA + 0.001);
    const finder = makeFinder({
      subtreeRows: [fileRow(91, { hash: 'h-1' }), fileRow(92, { hash: 'h-2', type: 'directory' })],
      embeddings: [embeddingRow(91, v1), embeddingRow(92, v2)],
    });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.groupCount).toBe(0);
  });
});

describe('nearDupFinderService — operational cap + idempotence', () => {
  it('caps the returned group set at MAX_NEAR_DUP_GROUPS, strongest first', async () => {
    const subtreeRows = [];
    const embeddings = [];
    const totalGroups = MAX_NEAR_DUP_GROUPS + 10;
    for (let g = 0; g < totalGroups; g += 1) {
      const base = g * 2 + 1;
      const [v1, v2] = axisPair(2 * g, THETA + 0.001); // disjoint axis pair per group
      subtreeRows.push(fileRow(base, { hash: `h-${base}` }), fileRow(base + 1, { hash: `h-${base + 1}` }));
      embeddings.push(embeddingRow(base, v1), embeddingRow(base + 1, v2));
    }
    const finder = makeFinder({ subtreeRows, embeddings });

    const result = await finder.findNearDuplicateGroups(42);

    expect(result.groupCount).toBe(MAX_NEAR_DUP_GROUPS);
    expect(result.duplicateCount).toBe(2 * MAX_NEAR_DUP_GROUPS);
    const again = await finder.findNearDuplicateGroups(42);
    expect(again).toEqual(result);
  });
});
