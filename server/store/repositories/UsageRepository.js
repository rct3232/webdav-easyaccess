'use strict';

/**
 * UsageRepository — domain interface over `usage_events` + `node_activity`
 * (docs/spec/server/store/usageStore.md). Raw §3.4 usage signals and the
 * per-(user,node) activity accumulator. NO journal writes (telemetry, §4.11).
 *
 * @typedef {Object} RollupGroup
 * @property {number} userId
 * @property {number} nodeId
 * @property {{open: number, download: number, preview: number, search_hit: number, like: number}} counts
 *   NEW events in the watermark interval (per action).
 * @property {number} lastSeenAtMs - MAX(created_at) over the consumed events.
 * @property {number} prevScore - existing node_activity.score (0 when absent).
 * @property {{open: number, download: number, preview: number, search_hit: number, like: number}} prevCounts
 *   Lifetime counts of the existing row (all 0 when absent).
 * @property {number|null} prevUpdatedAtMs - previous rollup instant (null = no row).
 *
 * @typedef {Object} NodeActivityRow
 * @property {number} userId
 * @property {number} nodeId
 * @property {{open: number, download: number, preview: number, search_hit: number, like: number}} counts
 *   Lifetime totals (previous + new).
 * @property {number} lastSeenAtMs
 * @property {number} score - accumulated §3.4 item score.
 * @property {number} updatedAtMs - rollup instant.
 *
 * @typedef {Object} UsageRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {({ userId, nodeId, action, at? }) => Promise<{ changes: number }>} insertUsageEvent
 *   One raw event row; `at` defaults to now.
 * @property {() => Promise<RollupGroup[]>} readRollupGroups
 *   Watermark-filtered event groups (created_at strictly greater than the
 *   accumulator row's updated_at; absent rows consume ALL events).
 * @property {(rows: NodeActivityRow[]) => Promise<{ changes: number }>} upsertNodeActivity
 *   Batch UPSERT on the PK (user_id, node_id).
 * @property {(cutoffMs: number) => Promise<{ changes: number }>} deleteUsageEventsOlderThan
 *   Retention roll-off (raw events older than the cutoff).
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {UsageRepository}
 */
module.exports = function createUsageRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createUsageRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/UsageRepository.sqlite')
      : require('./postgres/UsageRepository.postgres');
  return impl(executor);
};
