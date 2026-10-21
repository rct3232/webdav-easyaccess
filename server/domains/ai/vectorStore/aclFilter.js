'use strict';

// aclFilter — the SHARED oversample→filter→retry ACL helper of the vectorStore
// seam (vectorStore.md §2.5).
//
// vec0 KNN cannot enforce ACL inside the MATCH query (no join-KNN: vec0 + JOIN
// trips a planner bug), and pre-0.7 pgvector has the same shape of problem.
// The helper oversamples candidates from the engine's KNN (k·f), filters them
// to the caller-provided visible set, and adaptively retries with a doubled
// oversample when too few survive — bounded rounds, then a short list
// (correctness over padding).
//
// The helper is ENGINE-AGNOSTIC: it drives the engine through two injected
// seams — `loadCandidates(limit)` (raw KNN rows, ordered best-first) and
// `rescore(raw)` (per-node exact scores for the candidate ids) — so both the
// SqliteVec adapter and the pre-0.7 PgVector path consume it unchanged.

const DEFAULT_OVERSAMPLE_FACTOR = 4; // VECTOR_OVERSAMPLE_F default (§3)
const MAX_RETRY_ROUNDS = 4; // bounded: 4× → 8× → 16× → 32× then short list

/**
 * `candidates`: a Set of visible node ids, a predicate `(nodeId) => boolean`,
 * or `null` (no restriction — every candidate is visible).
 */
function isVisibleNode(nodeId, candidates) {
  if (!candidates) return true;
  if (candidates instanceof Set) return candidates.has(nodeId);
  return Boolean(candidates(nodeId));
}

/**
 * Oversample→filter→retry. Returns a Map nodeId → exact f64 score for at most
 * `k` visible nodes (caller sorts/trims).
 *
 * @param {object} opts
 * @param {number} opts.k final result size
 * @param {Set|((nodeId: number) => boolean)|null} opts.candidates ACL scope
 * @param {(limit: number) => Array<{ node_id: number }>} opts.loadCandidates
 *   raw KNN candidate fetch at the given oversample limit (best-first)
 * @param {Array<{ node_id: number }>} opts.rows canonical rows when the engine
 *   ranks a small corpus fully in JS (vec0 small-corpus path) — optional
 * @param {(raw: Array) => Map<number, number>} opts.rescore
 *   per-node exact score for the candidate node ids
 * @param {number} [opts.factor] oversample factor (VECTOR_OVERSAMPLE_F, §3)
 */
async function neighborsFiltered({
  k,
  candidates,
  loadCandidates,
  rescore,
  factor = DEFAULT_OVERSAMPLE_FACTOR,
}) {
  if (!Number.isInteger(k) || k <= 0) return new Map();
  let limit = k * factor;
  const noRestriction = !candidates;
  for (let round = 0; round <= MAX_RETRY_ROUNDS; round += 1) {
    const raw = loadCandidates(limit);
    const byNode = rescore(raw);
    if (noRestriction) {
      // No ACL: the raw top-k IS the answer (the engine ordered by distance;
      // exact f64 scores only re-rank within the same candidate set).
      return byNode;
    }
    const visible = [...byNode].filter(([nodeId]) => isVisibleNode(nodeId, candidates));
    if (visible.length >= k || round === MAX_RETRY_ROUNDS) {
      // Terminal: enough survivors, or the retry budget is exhausted — short
      // list wins over unbounded growth (correctness over padding, §2.5).
      const out = new Map(visible.slice(0, k));
      return out;
    }
    // Adaptive retry: double the oversample and re-fetch.
    limit *= 2;
    if (visible.length === 0 && raw.length < limit / 2) {
      // The candidate pool itself was exhausted (fewer corpus rows than the
      // previous limit) — retrying cannot add rows; short list now.
      return new Map(visible.slice(0, k));
    }
  }
  return new Map(); // unreachable; keeps linters honest about the return type
}

module.exports = { neighborsFiltered, isVisibleNode, DEFAULT_OVERSAMPLE_FACTOR, MAX_RETRY_ROUNDS };
