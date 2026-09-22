'use strict';

/**
 * §3.4 item activity score — pure math contract (docs/spec/server/store/
 * usageStore.md §2.1): weights (w_open=1, w_preview=2, w_download=3,
 * w_search_hit=1, w_like=5), half-life H=30d, the interval accumulator
 * S_k = S_(k-1)·2^(−Δt/H) + Σ w_a and the read-time lazy decay
 * S_read = S·2^(−(now−updated_at)/H). Table-driven per the plan.
 */

const {
  ITEM_WEIGHTS,
  HALF_LIFE_DAYS,
  DAY_MS,
  decayFactor,
  scoreEvents,
  applyItemAccumulator,
  decayItemScore,
} = require('@server/infrastructure/usage/activityScore');
const { getDefault } = require('@server/infrastructure/configRegistry');

describe('activityScore (§3.4 item accumulator)', () => {
  describe('constants', () => {
    it('exposes the §3.4 weights as a frozen map', () => {
      expect(ITEM_WEIGHTS).toEqual({
        open: 1,
        preview: 2,
        download: 3,
        search_hit: 1,
        like: 5,
      });
      expect(Object.isFrozen(ITEM_WEIGHTS)).toBe(true);
    });

    it('uses H = 30 days', () => {
      expect(HALF_LIFE_DAYS).toBe(30);
      expect(DAY_MS).toBe(86400000);
    });

    it('keeps registry defaults in parity (single semantic source)', () => {
      expect(getDefault('AI_USAGE_W_OPEN')).toBe(ITEM_WEIGHTS.open);
      expect(getDefault('AI_USAGE_W_PREVIEW')).toBe(ITEM_WEIGHTS.preview);
      expect(getDefault('AI_USAGE_W_DOWNLOAD')).toBe(ITEM_WEIGHTS.download);
      expect(getDefault('AI_USAGE_W_SEARCH_HIT')).toBe(ITEM_WEIGHTS.search_hit);
      expect(getDefault('AI_USAGE_W_LIKE')).toBe(ITEM_WEIGHTS.like);
      expect(getDefault('AI_ACTIVITY_HALF_LIFE_DAYS')).toBe(HALF_LIFE_DAYS);
    });
  });

  describe('decayFactor', () => {
    it.each([
      ['half of H decays by 2^(−0.5)', 15 * DAY_MS, 30, Math.SQRT1_2],
      ['full H halves the factor', 30 * DAY_MS, 30, 0.5],
      ['two half-lives quarter the factor', 60 * DAY_MS, 30, 0.25],
      ['zero elapsed keeps the factor at 1', 0, 30, 1],
      ['negative elapsed (clock skew) clamps to 1', -5 * DAY_MS, 30, 1],
      ['one day decays by 2^(−1/30)', 1 * DAY_MS, 30, Math.pow(2, -1 / 30)],
    ])('%s', (_name, elapsedMs, halfLifeDays, expected) => {
      expect(decayFactor(elapsedMs, halfLifeDays)).toBeCloseTo(expected, 12);
    });
  });

  describe('scoreEvents (Σ w_a)', () => {
    it.each([
      ['empty events score 0', {}, 0],
      ['single open = w_open', { open: 1 }, 1],
      ['two opens and one download = 2·1 + 1·3', { open: 2, download: 1 }, 5],
      ['one of each action = 1+2+3+1+5', { open: 1, preview: 1, download: 1, search_hit: 1, like: 1 }, 12],
      ['likes dominate: one like = 5', { like: 1 }, 5],
      ['counts multiply weights: 3 previews = 6', { preview: 3 }, 6],
    ])('%s', (_label, counts, expected) => {
      expect(scoreEvents(counts)).toBe(expected);
    });

    it('ignores actions outside the §3.4 enum (defense in depth)', () => {
      expect(scoreEvents({ open: 1, bogus: 100 })).toBe(1);
    });

    it('honors injected (tuned) weights over the shipped defaults', () => {
      expect(scoreEvents({ open: 2 }, { open: 10 })).toBe(20);
    });
  });

  describe('applyItemAccumulator (S_k)', () => {
    const NOW = Date.UTC(2026, 8, 22, 3, 0, 0);

    it.each([
      [
        'fresh row: Δt=0, S_0=0 → score = Σ w_a (2 opens + 1 download = 5)',
        { previousScore: 0, previousAtMs: null, counts: { open: 2, download: 1 } },
        5,
      ],
      [
        'S_(k-1)=5 with no new events and no Δt → unchanged 5',
        { previousScore: 5, previousAtMs: NOW, counts: {} },
        5,
      ],
      [
        'Δt = H (30d) halves the carried score: 5·0.5 + 1×like(5) = 7.5',
        { previousScore: 5, previousAtMs: NOW - 30 * DAY_MS, counts: { like: 1 } },
        7.5,
      ],
      [
        'Δt = 2H quarters the carried score: 5·0.25 = 1.25',
        { previousScore: 5, previousAtMs: NOW - 60 * DAY_MS, counts: {} },
        1.25,
      ],
      [
        'Δt = 15d: 5·2^(−0.5) + 2 previews (4)',
        { previousScore: 5, previousAtMs: NOW - 15 * DAY_MS, counts: { preview: 2 } },
        5 * Math.pow(2, -0.5) + 4,
      ],
      [
        'future previousAt (clock skew) clamps Δt to 0 → no decay',
        { previousScore: 5, previousAtMs: NOW + 10 * DAY_MS, counts: {} },
        5,
      ],
    ])('%s', (_label, input, expected) => {
      const score = applyItemAccumulator({ ...input, nowMs: NOW });
      expect(score).toBeCloseTo(expected, 9);
    });

    it('uses injected weights/half-life (tuned values, §4.15 counters)', () => {
      const score = applyItemAccumulator({
        previousScore: 4,
        previousAtMs: NOW - 60 * DAY_MS,
        nowMs: NOW,
        counts: { open: 1 },
        weights: { open: 2 },
        halfLifeDays: 10,
      });
      expect(score).toBeCloseTo(4 * 0.25 + 2, 9);
    });
  });

  describe('decayItemScore (read-time lazy decay S_read)', () => {
    it.each([
      ['score untouched when updated_at == now', 4, 0, 4],
      ['30d → half', 4, 30 * DAY_MS, 2],
      ['60d → quarter', 4, 60 * DAY_MS, 1],
      ['0 score stays 0 regardless of age', 0, 90 * DAY_MS, 0],
      ['negative age clamps to no decay', 4, -3 * DAY_MS, 4],
    ])('%s', (_label, score, ageMs, expected) => {
      const now = Date.UTC(2026, 8, 22, 3, 0, 0);
      expect(decayItemScore(score, now - ageMs, now)).toBeCloseTo(expected, 9);
    });
  });
});