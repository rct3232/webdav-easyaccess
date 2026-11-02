'use strict';

/**
 * §3.4 item activity score — pure math (docs/spec/server/store/usageStore.md
 * §2.1). SINGLE semantic source for the product T2-hot constants (PLAN §6:
 * dbOnly, defaults shipped, admin-displayed — NOT AI-profile numbers):
 *
 *   S_k = S_(k-1)·2^(−Δt_k/H) + Σ_(events in interval k) w_a     (H = 30d)
 *   S_read = S·2^(−(now−updated_at)/H)                            (lazy decay)
 *
 * Consumers: usageService (nightly rollup) and read-time item ordering
 * (collection member lazy decay). No IO, no time, no randomness — callers
 * inject `now` and any tuned weights/half-life (§4.15 counters).
 */

// §3.4 shipped weights: w_open=1, w_preview=2, w_download=3, w_search_hit=1,
// w_like=5. Keys mirror the usage_events.action CHECK enum exactly.
const ITEM_WEIGHTS = Object.freeze({
  open: 1,
  preview: 2,
  download: 3,
  search_hit: 1,
  like: 5,
});

const HALF_LIFE_DAYS = 30;
const DAY_MS = 86400000;

/**
 * 2^(−Δt/H) — decay multiplier for an elapsed interval. Negative elapsed
 * (clock skew / future timestamps) clamps to no decay (factor 1).
 */
function decayFactor(elapsedMs, halfLifeDays = HALF_LIFE_DAYS) {
  const elapsed = Math.max(0, Number(elapsedMs) || 0);
  return Math.pow(2, -elapsed / (halfLifeDays * DAY_MS));
}

/**
 * Σ w_a over per-action counts. Actions outside the §3.4 enum contribute 0
 * (the usage_events CHECK enum is the real guard; this is defense in depth).
 * @param {Record<string, number>} counts
 * @param {Record<string, number>} [weights]
 */
function scoreEvents(counts, weights = ITEM_WEIGHTS) {
  if (!counts) return 0;
  let total = 0;
  for (const [action, count] of Object.entries(counts)) {
    const weight = weights[action];
    if (typeof weight !== 'number' || !Number.isFinite(weight) || weight < 0) continue;
    const n = Number(count) || 0;
    if (n > 0) total += n * weight;
  }
  return total;
}

/**
 * One rollup interval of the §3.4 item accumulator.
 * @param {Object} input
 * @param {number} [input.previousScore=0] - S_(k-1) (node_activity.score).
 * @param {number|null} [input.previousAtMs] - updated_at of the previous
 *   rollup (ms epoch); null ⇒ fresh row, Δt = 0.
 * @param {number} input.nowMs - rollup instant (ms epoch).
 * @param {Record<string, number>} [input.counts] - NEW events in interval k.
 * @param {Record<string, number>} [input.weights]
 * @param {number} [input.halfLifeDays]
 * @returns {number} S_k
 */
function applyItemAccumulator({
  previousScore = 0,
  previousAtMs = null,
  nowMs,
  counts = {},
  weights = ITEM_WEIGHTS,
  halfLifeDays = HALF_LIFE_DAYS,
}) {
  const prev = Number(previousScore) || 0;
  const elapsed = previousAtMs == null ? 0 : Math.max(0, Number(nowMs) - Number(previousAtMs));
  return prev * decayFactor(elapsed, halfLifeDays) + scoreEvents(counts, weights);
}

/**
 * Read-time lazy decay (§3.4 item ordering): S_read = S·2^(−(now−updated_at)/H).
 * Negative age clamps to no decay.
 */
function decayItemScore(score, updatedAtMs, nowMs, halfLifeDays = HALF_LIFE_DAYS) {
  const age = Math.max(0, Number(nowMs) - Number(updatedAtMs));
  return (Number(score) || 0) * decayFactor(age, halfLifeDays);
}

module.exports = {
  ITEM_WEIGHTS,
  HALF_LIFE_DAYS,
  DAY_MS,
  decayFactor,
  scoreEvents,
  applyItemAccumulator,
  decayItemScore,
};
