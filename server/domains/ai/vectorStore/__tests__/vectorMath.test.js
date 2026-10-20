'use strict';

// vectorMath unit tests — pins the exact contract of
// docs/spec/server/infrastructure/vectorMath.md §2.
// RED-first: written before the module exists (AGENTS §2.1).

const {
  serializeVector,
  parseVector,
  l2Norm,
  dotProduct,
  cosineSimilarity,
  unitNormalize,
  meanPool,
  truncateAndRenormalize,
} = require('../vectorMath');

describe('serializeVector / parseVector (TEXT codec)', () => {
  it('serializes to comma-separated number strings', () => {
    expect(serializeVector([0.1, 1, -2.5, 0])).toBe('0.1,1,-2.5,0');
  });

  it('round-trips bit-stably through serialize/parse', () => {
    // Includes values whose shortest repr exercises the full double range.
    const vec = [
      0.1,
      -0.1,
      1 / 3,
      Math.PI,
      1e-300,
      1.7976931348623157e308,
      5e-324,
      123.45678901234568,
      -9876.54321,
    ];
    const parsed = parseVector(serializeVector(vec), vec.length);
    expect(parsed.length).toBe(vec.length);
    for (let i = 0; i < vec.length; i++) expect(parsed[i]).toBe(vec[i]);
  });

  it('round-trips a full 768-dim vector bit-stably (EG2 stored dim)', () => {
    const vec = [];
    let s = 123456789 >>> 0;
    for (let i = 0; i < 768; i++) {
      s ^= s << 13;
      s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5;
      s >>>= 0;
      vec.push((s / 0x100000000) * 2 - 1);
    }
    const parsed = parseVector(serializeVector(vec), 768);
    for (let i = 0; i < 768; i++) expect(parsed[i]).toBe(vec[i]);
  });

  it('parseVector rejects a wrong element count with dimMismatch', () => {
    expect(() => parseVector('1,2,3', 4)).toThrow(expect.objectContaining({ code: 'dimMismatch' }));
  });

  it('parseVector rejects non-finite elements with invalidVector', () => {
    expect(() => parseVector('1,NaN,3', 3)).toThrow(
      expect.objectContaining({ code: 'invalidVector' })
    );
    expect(() => parseVector('1,Infinity,3', 3)).toThrow(
      expect.objectContaining({ code: 'invalidVector' })
    );
  });
});

describe('l2Norm / dotProduct / cosineSimilarity', () => {
  it('l2Norm computes the Euclidean norm', () => {
    expect(l2Norm([3, 4])).toBe(5);
    expect(l2Norm([])).toBe(0);
  });

  it('dotProduct throws dimMismatch on length mismatch', () => {
    expect(() => dotProduct([1, 2], [1, 2, 3])).toThrow(
      expect.objectContaining({ code: 'dimMismatch' })
    );
  });

  it('cosineSimilarity pins: identical 1, orthogonal 0, opposite -1', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBe(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [-1, -2, -3])).toBe(-1);
  });

  it('cosineSimilarity returns 0 when either operand has zero norm', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([1, 2, 3], [0, 0, 0])).toBe(0);
  });

  it('cosineSimilarity throws dimMismatch on length mismatch', () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow(
      expect.objectContaining({ code: 'dimMismatch' })
    );
  });
});

describe('unitNormalize / meanPool', () => {
  it('unitNormalize scales to unit L2 norm', () => {
    const u = unitNormalize([3, 4]);
    expect(u[0]).toBeCloseTo(0.6, 15);
    expect(u[1]).toBeCloseTo(0.8, 15);
    expect(l2Norm(u)).toBeCloseTo(1, 15);
  });

  it('unitNormalize returns the zero vector unchanged for zero norm', () => {
    expect(unitNormalize([0, 0])).toEqual([0, 0]);
  });

  it('meanPool is the element-wise mean, renormalized (pooled-row rule)', () => {
    const rows = [
      [1, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ];
    // mean = [2/3, 2/3, 0]; renormalized = [1/sqrt2, 1/sqrt2, 0]
    const pooled = meanPool(rows);
    expect(pooled[0]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(pooled[1]).toBeCloseTo(Math.SQRT1_2, 15);
    expect(pooled[2]).toBeCloseTo(0, 15);
    expect(l2Norm(pooled)).toBeCloseTo(1, 15);
  });

  it('meanPool of a single vector equals its unit normalization bit-for-bit', () => {
    const v = [0.3, -0.4, 0.5];
    expect(meanPool([v])).toEqual(unitNormalize(v));
  });

  it('meanPool throws emptyVectors on an empty set', () => {
    expect(() => meanPool([])).toThrow(expect.objectContaining({ code: 'emptyVectors' }));
  });
});

describe('truncateAndRenormalize (MRL dims)', () => {
  it('slices to dim and restores unit length', () => {
    const v = unitNormalize([1, 2, 3, 4]);
    const t = truncateAndRenormalize(v, 2);
    expect(t.length).toBe(2);
    expect(t[0]).toBeCloseTo(v[0] / l2Norm([v[0], v[1]]), 15);
    expect(t[1]).toBeCloseTo(v[1] / l2Norm([v[0], v[1]]), 15);
    expect(l2Norm(t)).toBeCloseTo(1, 15);
  });

  it('throws dimMismatch when the target dim is not a truncation', () => {
    expect(() => truncateAndRenormalize([1, 0], 2)).toThrow(
      expect.objectContaining({ code: 'dimMismatch' })
    );
    expect(() => truncateAndRenormalize([1, 0], 3)).toThrow(
      expect.objectContaining({ code: 'dimMismatch' })
    );
  });
});
