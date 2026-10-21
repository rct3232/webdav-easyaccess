'use strict';

// aclFilter unit tests — the SHARED oversample→filter→retry helper
// (vectorStore.md §2.5, §5 ACL legs: f=4 hit, adaptive retry hit, short-list
// terminal case). Engine-agnostic: driven entirely through injected seams.

const { neighborsFiltered, isVisibleNode, DEFAULT_OVERSAMPLE_FACTOR } = require('../aclFilter');

// Deterministic candidate generator: node ids ranked best-first by distance,
// `n` visible and `invisible` invisible interleaved by a fixed pattern.
function makeRankedIds({ total, invisibleIds }) {
  const hidden = new Set(invisibleIds);
  return Array.from({ length: total }, (_, i) => ({ node_id: i + 1 })).filter(
    (r) => !hidden.has(r.node_id) || r.node_id % 3 === 0 // some hidden, some not
  );
}

describe('aclFilter — oversample→filter→retry (vectorStore.md §2.5)', () => {
  it('f=4 hit: a visible top-k survives when invisible nodes crowd the raw top-k', async () => {
    // 30 raw candidates: every 3rd is invisible. k=5 visible survivors exist
    // within the first k·4 = 20 raw rows → one round, no retry.
    const raw = makeRankedIds({ total: 30, invisibleIds: [] });
    const calls = [];
    const out = await neighborsFiltered({
      k: 5,
      candidates: new Set([2, 4, 6, 8, 10]),
      loadCandidates: (limit) => {
        calls.push(limit);
        return raw.slice(0, limit);
      },
      rescore: (rows) => new Map(rows.map((r) => [r.node_id, 1 / r.node_id])),
    });
    expect(calls).toEqual([5 * DEFAULT_OVERSAMPLE_FACTOR]); // exactly one round
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([2, 4, 6, 8, 10]);
  });

  it('an invisible candidate NEVER appears even when it ranks first', async () => {
    const raw = [{ node_id: 1 }, { node_id: 2 }, { node_id: 3 }];
    const out = await neighborsFiltered({
      k: 3,
      candidates: (id) => id !== 1, // the raw winner is invisible
      loadCandidates: (limit) => raw.slice(0, limit),
      rescore: (rows) => new Map(rows.map((r) => [r.node_id, 1 / r.node_id])),
    });
    expect([...out.keys()]).toEqual([2, 3]);
  });

  it('adaptive retry doubles the oversample when too few survive', async () => {
    // Only 1-in-5 candidates visible: k=8 needs > k·4 = 32 raw rows
    // (8 visible max in 40... 32 raw ⇒ ~6 visible) → retry at 64.
    const raw = Array.from({ length: 200 }, (_, i) => ({ node_id: i + 1 }));
    const calls = [];
    const out = await neighborsFiltered({
      k: 8,
      candidates: (id) => id % 5 === 0, // 20% visible
      loadCandidates: (limit) => {
        calls.push(limit);
        return raw.slice(0, limit);
      },
      rescore: (rows) => new Map(rows.map((r) => [r.node_id, 1 / r.node_id])),
    });
    expect(calls.length).toBeGreaterThan(1); // retry happened
    expect(calls[1]).toBe(calls[0] * 2); // doubling
    expect([...out.keys()].every((id) => id % 5 === 0)).toBe(true);
    expect(out.size).toBe(8);
  });

  it('short-list terminal case: fewer visible rows than k returns them all', async () => {
    const raw = [{ node_id: 1 }, { node_id: 2 }, { node_id: 3 }];
    const out = await neighborsFiltered({
      k: 10,
      candidates: new Set([2, 3]),
      loadCandidates: (limit) => raw.slice(0, Math.min(limit, raw.length)),
      rescore: (rows) => new Map(rows.map((r) => [r.node_id, 1 / r.node_id])),
    });
    expect([...out.keys()].sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('candidates=null bypasses filtering (raw top-k is the answer)', async () => {
    const raw = [{ node_id: 9 }, { node_id: 4 }];
    const out = await neighborsFiltered({
      k: 2,
      candidates: null,
      loadCandidates: (limit) => raw.slice(0, limit),
      rescore: (rows) => new Map(rows.map((r) => [r.node_id, r.node_id / 100])),
    });
    expect([...out.keys()]).toEqual([9, 4]);
  });

  it('k=0 and negative k yield an empty map', async () => {
    for (const k of [0, -3]) {
      const out = await neighborsFiltered({
        k,
        candidates: null,
        loadCandidates: () => [],
        rescore: () => new Map(),
      });
      expect(out.size).toBe(0);
    }
  });

  it('stops growing when the candidate pool itself is exhausted', async () => {
    // 10 raw rows total, none visible: no retry can add rows — must terminate
    // quickly instead of looping to the retry ceiling.
    const raw = Array.from({ length: 10 }, (_, i) => ({ node_id: i + 1 }));
    const calls = [];
    const out = await neighborsFiltered({
      k: 5,
      candidates: () => false,
      loadCandidates: (limit) => {
        calls.push(limit);
        return raw.slice(0, limit);
      },
      rescore: () => new Map(),
    });
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(out.size).toBe(0);
  });
});

describe('isVisibleNode — candidate forms (vectorStore.md §2.2)', () => {
  it('null means visible', () => {
    expect(isVisibleNode(1, null)).toBe(true);
  });
  it('Set membership', () => {
    expect(isVisibleNode(1, new Set([1, 2]))).toBe(true);
    expect(isVisibleNode(3, new Set([1, 2]))).toBe(false);
  });
  it('predicate form', () => {
    expect(isVisibleNode(4, (id) => id % 2 === 0)).toBe(true);
    expect(isVisibleNode(5, (id) => id % 2 === 0)).toBe(false);
  });
});
