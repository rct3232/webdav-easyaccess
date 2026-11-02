'use strict';

/**
 * Shared shaping/validation for the AiUsageDailyRepository dialect twins
 * (docs/spec/server/store/aiUsageDailyStore.md). Counters are non-negative
 * integer deltas — they move only on their events and never decrease (§2.5).
 */

/** Non-negative integer counter delta; omitted → 0. */
function delta(value, field) {
  if (value === undefined || value === null) return 0;
  if (!Number.isInteger(value) || value < 0) {
    throw new TypeError(`recordUsage ${field} must be a non-negative integer`);
  }
  return value;
}

/** Validate + normalize a recordUsage event BEFORE SQL (§2.5). */
function normalizeUsageEvent(event) {
  if (!event || typeof event !== 'object') throw new TypeError('recordUsage requires an event');
  if (typeof event.day !== 'string' || !event.day) {
    throw new TypeError('recordUsage requires a non-empty string day');
  }
  if (typeof event.role !== 'string' || !event.role) {
    throw new TypeError('recordUsage requires a non-empty string role');
  }
  return {
    day: event.day,
    role: event.role,
    calls: delta(event.calls, 'calls'),
    inputChars: delta(event.inputChars, 'inputChars'),
    cached: delta(event.cached, 'cached'),
    degraded: delta(event.degraded, 'degraded'),
    failed429: delta(event.failed429, 'failed429'),
  };
}

/** Driver row → domain-shaped ledger row (repository-contract rule 2). */
function mapUsageRow(row) {
  return {
    day: String(row.day),
    role: String(row.role),
    calls: Number(row.calls),
    inputChars: Number(row.input_chars),
    cached: Number(row.cached),
    degraded: Number(row.degraded),
    failed429: Number(row.failed_429),
  };
}

module.exports = { normalizeUsageEvent, mapUsageRow };
