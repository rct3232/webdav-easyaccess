'use strict';

/**
 * Startup maintenance hooks: optional GC cron scheduling and the fail-safe
 * orphaned-node startup scan. Both are fire-and-forget; failures are logged,
 * never fatal.
 *
 * Scheduling config:
 *   GC_INTERVAL_MS            - DB-only cron interval in ms (registry dbOnly);
 *                               0/unset disables scheduling
 *   GC_ORPHAN_TTL_DAYS        - orphan age threshold (consumed by gcService)
 *   WEA_SKIP_GC_SCHEDULER     - test seam; any truthy value disables scheduling
 *
 * §4.14 Tier A: each scheduled GC run and the startup fail-safe scan persist
 * an admin_reports row (kind gc / failsafe) via the best-effort writer in
 * server/domains/admin/services/adminReportsService.js — inert until the
 * admin_reports store is wired (T0.8), never fatal.
 */
/* eslint-disable no-console -- startup status reporting */

function shouldSkip() {
  const skip = (process.env.WEA_SKIP_GC_SCHEDULER || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

function resolveIntervalMs() {
  // GC_INTERVAL_MS is DB-only (registry dbOnly); the shared resolver was primed
  // with the DB settings at boot (loadAll), so getConfigSync sees the DB row or
  // the built-in default (0 = disabled). Env is intentionally ignored here.
  const { getSharedResolver } = require('./configResolver');
  const raw = Number(getSharedResolver().getConfigSync('GC_INTERVAL_MS'));
  return Number.isFinite(raw) && raw > 0 ? raw : 0;
}

/**
 * Resolve the shared admin-reports writer lazily (DI overrides it in tests).
 * The admin_reports store is wired by T0.8; until then the writer is inert.
 */
function resolveAdminReportsWriter(injected) {
  if (injected) return injected;
  const { getAdminReportsWriter } = require('../domains/admin/services/adminReportsService');
  return getAdminReportsWriter();
}

/**
 * Start the periodic GC schedule.
 * @param {Object} opts
 * @param {Object} opts.gcService - gcService exposing runGcCycle().
 * @param {Object} [opts.adminReportsWriter] - DI seam for the admin_reports writer.
 * @returns {NodeJS.Timeout|null} timer, or null when disabled.
 */
function startGcScheduler({ gcService, adminReportsWriter } = {}) {
  if (shouldSkip() || !gcService) return null;
  const intervalMs = resolveIntervalMs();
  if (!intervalMs) return null;

  return setInterval(() => {
    gcService
      .runGcCycle()
      .then(async (result) => {
        // Persist the run result as an admin_reports row (§4.14 Tier A — no
        // console-only GC reports). Best-effort: never breaks the schedule.
        try {
          const {
            ADMIN_REPORT_KINDS,
            resolveAdminReportStatus,
          } = require('../domains/admin/services/adminReportsService');
          await resolveAdminReportsWriter(adminReportsWriter).writeReport({
            kind: ADMIN_REPORT_KINDS.gc,
            status: resolveAdminReportStatus(result),
            payload: result,
          });
        } catch (err) {
          console.error('Failed to persist GC report:', err.message);
        }
      })
      .catch((err) => {
        console.error('Scheduled GC failed:', err.message);
        // A failed run is still a run: partial row with the error payload.
        resolveAdminReportsWriter(adminReportsWriter)
          .writeReport({
            kind: 'gc',
            status: 'partial',
            payload: { error: err.message },
          })
          .catch(() => {});
      });
  }, intervalMs);
}

/**
 * Run the startup fail-safe scan. Reports orphaned nodes for manual review
 * without taking any destructive action.
 * @param {Object} opts
 * @param {Object} opts.failSafeService - failSafeService exposing runStartupRecovery().
 * @param {Object} [opts.adminReportsWriter] - DI seam for the admin_reports writer.
 * @returns {Promise<Object>} report
 */
async function runStartupFailSafeRecovery({ failSafeService, adminReportsWriter } = {}) {
  if (!failSafeService) {
    return { scanned: 0, resolved: 0, manualReview: [] };
  }
  let report;
  try {
    report = await failSafeService.runStartupRecovery();
  } catch (err) {
    console.error('Fail-safe recovery on startup failed:', err.message);
    const failed = { scanned: 0, resolved: 0, manualReview: [], error: err.message };
    // A failed scan is still a run: partial row (§4.14 Tier A), best-effort.
    try {
      await resolveAdminReportsWriter(adminReportsWriter).writeReport({
        kind: 'failsafe',
        status: 'partial',
        payload: failed,
      });
    } catch (reportErr) {
      console.error('Failed to persist fail-safe report:', reportErr.message);
    }
    return failed;
  }
  try {
    await resolveAdminReportsWriter(adminReportsWriter).writeReport({
      kind: 'failsafe',
      status: 'ok',
      payload: report,
    });
  } catch (err) {
    // Reporting never breaks the startup hook.
    console.error('Failed to persist fail-safe report:', err.message);
  }
  if (report.scanned > 0) {
    console.warn(
      `\u26A0 Fail-safe recovery: ${report.scanned} orphaned node(s) require manual review`
    );
    console.warn('  Resolve them via POST /api/admin/maintenance/repair-sync');
  } else {
    console.log('Fail-safe recovery: no orphaned nodes found');
  }
  const pending = report.pendingUpload || { scanned: 0 };
  if (pending.scanned > 0) {
    console.warn(
      `\u26A0 Fail-safe recovery: ${pending.scanned} pending_upload node(s) require manual review`
    );
    console.warn('  Resolve them via POST /api/admin/maintenance/repair-sync');
  }
  return report;
}

module.exports = {
  startGcScheduler,
  runStartupFailSafeRecovery,
  shouldSkip,
  resolveIntervalMs,
};
