'use strict';

/**
 * keeperScore tests (docs/spec/server/services/dashboardService.md §2.5.1).
 * Pure module: no IO, no clock reads — every input is passed in. Covers the
 * v1 weights, the 30d-unopened PENALTY (never an exclusion), media
 * resolution/size quality, name originality, centrality from nearDupFinder
 * pairScores, tie-break by smallest node id, all-equal neutrality and the
 * additive `reason.keep` exposure shape.
 */

const {
  WEIGHTS,
  UNOPENED_MULTIPLIER,
  computeGroupKeeper,
} = require('@server/domains/dashboard/keeperScore');

const DAY_MS = 86400000;
const NOW = Date.parse('2026-10-28T12:00:00Z');

function member(nodeId, overrides = {}) {
  return {
    nodeId,
    name: `file-${nodeId}.txt`,
    sizeBytes: 1000,
    mimeType: 'text/plain',
    ...overrides,
  };
}

function pairs(entries) {
  return entries.map(([nodeA, nodeB, score]) => ({ nodeA, nodeB, score }));
}

describe('keeperScore.computeGroupKeeper — weights and exposure', () => {
  it('uses the owner-approved v1 weights and annotates score_version v1', () => {
    expect(WEIGHTS).toEqual({ activity: 0.45, quality: 0.3, name: 0.15, centrality: 0.1 });
    const result = computeGroupKeeper({
      members: [member(1), member(2)],
      nowMs: NOW,
    });
    expect(result.keep.score_version).toBe('v1');
    expect(result.keep.factors).toEqual({
      activity: 0.5,
      quality: 0.5,
      name: 0.5,
      centrality: 0.5,
    });
    expect(result.keep.relative_score).toBe(0.5);
  });

  it('emits the full reason.keep shape (basename only, relative score, factors)', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'photos/report.pdf' }),
        member(2, { name: 'photos/report copy.pdf' }),
      ],
      nowMs: NOW,
    });

    expect(result.keep).toEqual({
      name: 'report.pdf',
      relative_score: expect.any(Number),
      confidence: expect.stringMatching(/^(high|medium|low)$/),
      basis: expect.stringMatching(/^(activity|resolution|size|name|centrality|mixed|none)$/),
      factors: {
        activity: expect.any(Number),
        quality: expect.any(Number),
        name: expect.any(Number),
        centrality: expect.any(Number),
      },
      unopened_30d: expect.any(Boolean),
      score_version: 'v1',
    });
    expect(result.keep.name).not.toContain('/');
    expect(result.keep.relative_score).toBeGreaterThanOrEqual(0);
    expect(result.keep.relative_score).toBeLessThanOrEqual(1);
    for (const value of Object.values(result.keep.factors)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });
});

describe('keeperScore — activity factor', () => {
  it('30d-unopened is a 0.25 penalty, never an exclusion: an active low-score member wins', () => {
    const unopened = {
      score: 10,
      lastSeenAtMs: NOW - 40 * DAY_MS,
      updatedAtMs: NOW - 40 * DAY_MS,
    };
    const active = { score: 1, lastSeenAtMs: NOW, updatedAtMs: NOW };

    const result = computeGroupKeeper({
      members: [member(1), member(2)],
      activityByNode: new Map([
        [1, unopened],
        [2, active],
      ]),
      nowMs: NOW,
    });

    // No penalty would let the score-10 member win (10 vs 1).
    expect(result.keeperNodeId).toBe(2);
    expect(result.keep.basis).toBe('activity');
    expect(result.keep.unopened_30d).toBe(false);
    expect(result.keep.factors.activity).toBe(1);
    expect(UNOPENED_MULTIPLIER).toBe(0.25);
  });

  it('a member with no accumulator row is unopened (raw 0) but still eligible as keeper', () => {
    const result = computeGroupKeeper({
      members: [member(1), member(2)],
      nowMs: NOW,
    });

    expect(Number.isInteger(result.keeperNodeId)).toBe(true);
    expect(result.keep.unopened_30d).toBe(true);
    // all-equal activity ⇒ neutral, not an invented preference
    expect(result.keep.factors.activity).toBe(0.5);
  });

  it('marks the keeper unopened_30d when last_seen is null', () => {
    const result = computeGroupKeeper({
      members: [member(1), member(2)],
      activityByNode: new Map([
        [1, { score: 1, lastSeenAtMs: null, updatedAtMs: NOW }],
        [2, { score: 1, lastSeenAtMs: NOW, updatedAtMs: NOW }],
      ]),
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(2);
    expect(result.keep.unopened_30d).toBe(false);
  });
});

describe('keeperScore — media quality', () => {
  const probe = (width, height) => ({ width, height });

  it('ranks image/video members by log1p(width*height) and labels the basis resolution', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 500 }),
        member(2, { name: 'photo.jpg', mimeType: 'image/jpeg', sizeBytes: 500 }),
      ],
      probeByNode: new Map([
        [1, probe(800, 600)],
        [2, probe(4000, 3000)],
      ]),
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(2);
    expect(result.keep.basis).toBe('resolution');
    expect(result.keep.factors.quality).toBe(1);
    expect(result.keep.name).toBe('photo.jpg');
  });

  it('falls back to log1p(size) when a media member has no probe (basis size)', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 1000000 }),
        member(2, { name: 'clip.mp4', mimeType: 'video/mp4', sizeBytes: 10000000 }),
      ],
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(2);
    expect(result.keep.basis).toBe('size');
    expect(result.keep.factors.quality).toBe(1);
  });

  it('documents stay neutral at 0.5 and do not enter the media min-max range', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'report.pdf', mimeType: 'application/pdf' }),
        member(2, { name: 'photo.jpg', mimeType: 'image/jpeg' }),
      ],
      probeByNode: new Map([[2, probe(4000, 3000)]]),
      activityByNode: new Map([
        [1, { score: 50, lastSeenAtMs: NOW, updatedAtMs: NOW }],
        [2, { score: 1, lastSeenAtMs: NOW, updatedAtMs: NOW }],
      ]),
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(1);
    expect(result.keep.factors.quality).toBe(0.5);
    expect(result.keep.basis).toBe('activity');
  });

  it('adds the +0.05 lossless bonus after normalization, clamped to 1', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'shot.png', mimeType: 'image/png' }),
        member(2, { name: 'shot.jpg', mimeType: 'image/jpeg' }),
      ],
      probeByNode: new Map([
        [1, probe(1000, 1000)],
        [2, probe(1000, 1000)],
      ]),
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(1); // equal media ⇒ bonus breaks the tie
    expect(result.keep.factors.quality).toBeCloseTo(0.55, 3);
  });
});

describe('keeperScore — name originality', () => {
  it('penalizes copy markers and clamps the raw score at 0.1', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'report.pdf' }),
        member(2, { name: 'report copy edited export compressed small thumb preview temp ~$.pdf' }),
      ],
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(1);
    expect(result.keep.basis).toBe('name');
    expect(result.keep.factors.name).toBe(1);
  });

  it('treats parenthesized copy markers and screenshot names as penalized', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'Screenshot 2026-10-01.png' }),
        member(2, { name: 'holiday.png' }),
      ],
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(2);
    expect(result.keep.basis).toBe('name');
  });
});

describe('keeperScore — centrality', () => {
  it('uses the mean cosine to the other group members from pairScores', () => {
    const result = computeGroupKeeper({
      members: [member(1), member(2), member(3)],
      pairScores: pairs([
        [1, 2, 0.9],
        [1, 3, 0.9],
        [2, 3, 0.5],
      ]),
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(1);
    expect(result.keep.basis).toBe('centrality');
    expect(result.keep.factors.centrality).toBe(1);
  });

  it('a pair group has identical centrality for both members (all-equal ⇒ 0.5)', () => {
    const result = computeGroupKeeper({
      members: [member(1), member(2)],
      pairScores: pairs([[1, 2, 0.97]]),
      nowMs: NOW,
    });

    expect(result.keep.factors.centrality).toBe(0.5);
  });
});

describe('keeperScore — tie-break, confidence and missing inputs', () => {
  it('breaks a composite tie with the smallest node id', () => {
    const result = computeGroupKeeper({
      members: [member(9), member(4)],
      nowMs: NOW,
    });

    expect(result.keeperNodeId).toBe(4);
    expect(result.keep.basis).toBe('none');
    expect(result.keep.confidence).toBe('low');
  });

  it('reports the composite margin as confidence (high on a wide gap)', () => {
    const result = computeGroupKeeper({
      members: [
        member(1, { name: 'report.pdf' }),
        member(2, { name: 'report copy edited export compressed small thumb preview.pdf' }),
      ],
      nowMs: NOW,
    });

    expect(result.keep.confidence).toBe('high');
  });

  it('tolerates absent activity/probe/pair inputs without throwing', () => {
    expect(() =>
      computeGroupKeeper({
        members: [member(1, { mimeType: null }), member(2, { mimeType: null })],
        nowMs: NOW,
      })
    ).not.toThrow();

    const result = computeGroupKeeper({
      members: [member(1, { mimeType: null }), member(2, { mimeType: null })],
      nowMs: NOW,
    });
    expect(result.keep.factors).toEqual({
      activity: 0.5,
      quality: 0.5,
      name: 0.5,
      centrality: 0.5,
    });
  });
});
