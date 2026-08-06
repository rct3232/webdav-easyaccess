'use strict';

/**
 * Startup maintenance hooks: optional GC cron scheduling and the fail-safe
 * orphaned-node startup scan. Both are fire-and-forget; failures are logged,
 * never fatal.
 *
 * Scheduling config:
 *   GC_INTERVAL_MS            - cron interval in ms; 0/unset disables scheduling
 *   GC_ORPHAN_TTL_DAYS        - orphan age threshold (consumed by gcService)
 *   WEA_SKIP_GC_SCHEDULER     - test seam; any truthy value disables scheduling
 */

function shouldSkip() {
  const skip = (process.env.WEA_SKIP_GC_SCHEDULER || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

function resolveIntervalMs() {
  const raw = Number(process.env.GC_INTERVAL_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Start the periodic GC schedule.
 * @param {Object} opts
 * @param {Object} opts.gcService - gcService exposing runGcCycle().
 * @returns {NodeJS.Timeout|null} timer, or null when disabled.
 */
function startGcScheduler({ gcService }) {
  if (shouldSkip() || !gcService) return null;
  const intervalMs = resolveIntervalMs();
  if (!intervalMs) return null;

  return setInterval(() => {
    gcService
      .runGcCycle()
      .then(() => {
        /* periodic maintenance is silent on success */
      })
      .catch((err) => {
        console.error('Scheduled GC failed:', err.message);
      });
  }, intervalMs);
}

/**
 * Run the startup fail-safe scan. Reports orphaned nodes for manual review
 * without taking any destructive action.
 * @param {Object} opts
 * @param {Object} opts.failSafeService - failSafeService exposing runStartupRecovery().
 * @returns {Promise<Object>} report
 */
async function runStartupFailSafeRecovery({ failSafeService }) {
  if (!failSafeService) {
    return { scanned: 0, resolved: 0, manualReview: [] };
  }
  try {
    const report = await failSafeService.runStartupRecovery();
    if (report.scanned > 0) {
      console.warn(`\u26A0 Fail-safe recovery: ${report.scanned} orphaned node(s) require manual review`);
      console.warn('  Resolve them via POST /api/admin/maintenance/repair-sync');
    } else {
      console.log('Fail-safe recovery: no orphaned nodes found');
    }
    return report;
  } catch (err) {
    console.error('Fail-safe recovery on startup failed:', err.message);
    return { scanned: 0, resolved: 0, manualReview: [], error: err.message };
  }
}

module.exports = {
  startGcScheduler,
  runStartupFailSafeRecovery,
  shouldSkip,
  resolveIntervalMs,
};
