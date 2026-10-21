'use strict';

/**
 * Shared row shaping + retry math for the AiJobsRepository dialect twins
 * (docs/spec/server/store/aiJobsStore.md). The retry ladder is a module
 * constant pair — operational mechanics, never model-profile values (§2.5).
 */

const { toIsoString } = require('../../utils/sharedHelpers');

const AI_JOB_RETRY_BASE_MS = 30_000;
const AI_JOB_RETRY_MAX_MS = 1_800_000;

/** backoff(attempt) = min(30s · 2^(attempt−1), 30min) — plain exponential, no jitter. */
function backoffMs(attempt) {
  const n = Number(attempt);
  if (!Number.isInteger(n) || n < 1) return AI_JOB_RETRY_BASE_MS;
  const exp = Math.min(n - 1, 30);
  return Math.min(AI_JOB_RETRY_BASE_MS * 2 ** exp, AI_JOB_RETRY_MAX_MS);
}

/** last_error is a bounded note channel (≤1KB — §2.3 markFailed). */
function truncateError(error) {
  if (error === undefined || error === null) return null;
  const text = String(error);
  return text.length <= 1024 ? text : text.slice(0, 1024);
}

/** Driver row → domain-shaped job (repository-contract rule 2: numbers, ISO timestamps). */
function mapJobRow(row) {
  return {
    id: Number(row.id),
    nodeId: Number(row.node_id),
    kind: String(row.kind),
    generation: Number(row.generation),
    status: String(row.status),
    attempt: Number(row.attempt),
    nextRetryAt: toIsoString(row.next_retry_at),
    lastError:
      row.last_error === null || row.last_error === undefined ? null : String(row.last_error),
    contentHash:
      row.content_hash === null || row.content_hash === undefined ? null : String(row.content_hash),
    createdAt: toIsoString(row.created_at),
    startedAt: toIsoString(row.started_at),
    finishedAt: toIsoString(row.finished_at),
  };
}

/**
 * Claimable predicate (§2.3): `pending` OR (`failed` AND next_retry_at due).
 * `next_retry_at IS NULL` counts as due — a failed row without a scheduled
 * retry never gets stuck. The left side is the raw column reference (dialect
 * twins may wrap it in julianday); the right placeholder binds an ISO instant.
 */
const CLAIMABLE_PREDICATE =
  "(status = 'pending' OR (status = 'failed' AND (%NEXT_RETRY% IS NULL OR %NEXT_RETRY% <= %PARAM%)))";

/**
 * Predicate-level kind exclusion for `claimNext({ excludeKinds })`
 * (park&drain — aiJobsStore §2.3): excluded kinds' rows stay parked with
 * their status/attempt untouched (zero attempt inflation). Appended to
 * CLAIMABLE_PREDICATE; `%KIND_SLOTS%` expands to one placeholder per
 * excluded kind (dialect-resolved by the twins — never a literal `?` here,
 * Wave A exit-gate defect c49dca4).
 */
const KIND_EXCLUSION_CLAUSE = ' AND kind NOT IN (%KIND_SLOTS%)';

/**
 * Builds the claim predicate for `claimNext`, optionally excluding kinds.
 * @param {string[]} [excludeKinds] kinds to park (empty/undefined = no filter).
 * @param {(index: number) => string} param placeholder factory — index 0
 *   binds the base predicate's ISO instant, indexes 1..n the excluded kinds.
 * @returns {string} dialect-resolved SQL predicate.
 */
function buildClaimPredicate(excludeKinds, param) {
  const kinds = (Array.isArray(excludeKinds) ? excludeKinds : [])
    .map(String)
    .filter((k) => k.length > 0);
  let sql = CLAIMABLE_PREDICATE.replaceAll('%NEXT_RETRY%', 'next_retry_at').replaceAll(
    '%PARAM%',
    param(0)
  );
  if (kinds.length > 0) {
    sql += KIND_EXCLUSION_CLAUSE.replace(
      '%KIND_SLOTS%',
      kinds.map((_, i) => param(i + 1)).join(', ')
    );
  }
  return sql;
}

module.exports = {
  AI_JOB_RETRY_BASE_MS,
  AI_JOB_RETRY_MAX_MS,
  backoffMs,
  truncateError,
  mapJobRow,
  CLAIMABLE_PREDICATE,
  KIND_EXCLUSION_CLAUSE,
  buildClaimPredicate,
};
