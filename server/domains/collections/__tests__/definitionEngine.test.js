'use strict';

// Pure definition-engine contract: pooled-vector membership, predicate AND,
// and the theta_in/theta_out hysteresis band (§2.3 collectionsService.md).

const engine = require('../definitionEngine');

const nodes = [
  { id: 1, parentId: null, name: 'root', type: 'directory', createdAt: '2026-01-01T00:00:00Z' },
  { id: 2, parentId: 1, name: 'a.jpg', type: 'file', createdAt: '2026-01-02T00:00:00Z' },
  { id: 3, parentId: 1, name: 'b.jpg', type: 'file', createdAt: '2026-01-03T00:00:00Z' },
];
const nodesById = new Map(nodes.map((node) => [node.id, node]));

function providers(overrides = {}) {
  return {
    likedNodeIds: new Set(),
    getSize: async () => 10,
    listNodesByTag: async () => [],
    ...overrides,
  };
}

const seedDefinition = {
  kind: 'seed_vector',
  seed_ref: 2,
  theta: 0.62,
  all_of: [{ type: 'path', value: '/root' }],
};

describe('definitionEngine vector membership', () => {
  it('parses vector definitions with optional predicate atoms', () => {
    expect(engine.parseDefinition(seedDefinition)).toMatchObject({
      kind: 'seed_vector',
      allOf: [{ type: 'path', prefix: '/root' }],
      vector: { seed_ref: 2, theta: 0.62 },
    });
    expect(engine.isVectorDefinition(seedDefinition)).toBe(true);
    expect(engine.hasDefinition(seedDefinition)).toBe(true);
  });

  it('accepts centroid_ref null as the owning collection self reference', () => {
    const parsed = engine.parseDefinition({
      kind: 'centroid',
      centroid_ref: null,
      theta: 0.8,
      tier: 'mid',
    });
    expect(parsed.kind).toBe('centroid');
    expect(parsed.vector).toMatchObject({
      kind: 'centroid',
      centroid_ref: null,
      theta: 0.8,
      tier: 'mid',
    });
    expect(() => engine.parseDefinition({ kind: 'centroid', theta: 0.8 })).toThrow(
      'invalidDefinition'
    );
  });

  it('admits non-members at theta_in and keeps previous members at theta_out', async () => {
    const scores = new Map([
      [2, 0.9],
      [3, 0.6],
    ]);
    const vector = {
      scoreFor: async (nodeId) => scores.get(Number(nodeId)) ?? null,
      thetaIn: 0.66,
      thetaOut: 0.58,
      previousMembers: new Set([3]),
    };

    const admitted = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: nodes.slice(1),
      nodesById,
      providers: providers(),
      vector,
    });

    expect([...admitted.keys()].sort()).toEqual([2, 3]);
    expect(admitted.get(3)).toContain('similar');
    expect(admitted.get(2)).toContain('similar');
  });

  it('does not admit a non-member inside the band and removes a member below theta_out', async () => {
    const scores = new Map([
      [2, 0.6],
      [3, 0.5],
    ]);
    const vector = {
      scoreFor: async (nodeId) => scores.get(Number(nodeId)) ?? null,
      thetaIn: 0.66,
      thetaOut: 0.58,
      previousMembers: new Set([3]),
    };

    const admitted = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: nodes.slice(1),
      nodesById,
      providers: providers(),
      vector,
    });

    expect(admitted.size).toBe(0);
  });

  it('combines predicate atoms with the vector rule (AND)', async () => {
    const vector = {
      scoreFor: async () => 0.9,
      thetaIn: 0.66,
      thetaOut: 0.58,
      previousMembers: new Set(),
    };
    const outside = [{ ...nodes[2], parentId: 99 }];
    const admitted = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: outside,
      nodesById: new Map([...nodesById, [99, { id: 99, parentId: null, name: 'other' }]]),
      providers: providers(),
      vector,
    });

    expect(admitted.size).toBe(0);
  });

  it('degrades to no matches when the vector seam is absent', async () => {
    const admitted = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: nodes.slice(1),
      nodesById,
      providers: providers(),
    });

    expect(admitted.size).toBe(0);
  });

  it('keepMissing keeps an existing member without a pooled vector and never adds a non-member', async () => {
    const vector = {
      scoreFor: async (nodeId) => (Number(nodeId) === 3 ? null : 0.9),
      thetaIn: 0.66,
      thetaOut: 0.58,
      previousMembers: new Set([3]),
      keepMissing: true,
    };

    const admitted = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: nodes.slice(1),
      nodesById,
      providers: providers(),
      vector,
    });

    // 2 is a scored non-member above theta_in; 3 is a previous member whose
    // vector is missing (enrichment gap) — kept. The reverse case (3 not a
    // previous member) admits nothing for it.
    expect(admitted.get(2)).toContain('similar');
    expect(admitted.get(3)).toContain('similar');

    const withoutPrevious = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: [nodes[2]],
      nodesById,
      providers: providers(),
      vector: { ...vector, previousMembers: new Set() },
    });
    expect(withoutPrevious.size).toBe(0);
  });

  it('without keepMissing a missing pooled vector drops the candidate (upload-hook parity)', async () => {
    const admitted = await engine.evaluateDefinition({
      definition: seedDefinition,
      candidateNodes: [nodes[2]],
      nodesById,
      providers: providers(),
      vector: {
        scoreFor: async () => null,
        thetaIn: 0.66,
        thetaOut: 0.58,
        previousMembers: new Set([3]),
      },
    });
    expect(admitted.size).toBe(0);
  });

  it('computes cosine similarity and rejects dimension/value mismatches', () => {
    expect(engine.cosineSimilarity([1, 0], [1, 0])).toBe(1);
    expect(engine.cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(engine.cosineSimilarity([1, 0], [1, 0, 0])).toBeNull();
    expect(engine.cosineSimilarity([0, 0], [1, 0])).toBeNull();
  });
});
