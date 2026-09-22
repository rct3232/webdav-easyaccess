'use strict';

/**
 * admin_reports plumbing (§4.14 Tier A, T0.7b): the kind/status constants and
 * the best-effort report-writer seam shared by the cleanup route, the
 * scheduled GC cycle and the startup fail-safe scan.
 *
 * Ownership: the `admin_reports` TABLE DDL lives in
 * `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (T0.2) and
 * the store/read routes land with T0.8. Until the store function is wired,
 * `getAdminReportsWriter()` is inert (no insertReport) — writes are skipped.
 *
 * Writes are best-effort by contract: a missing/throwing insertReport (e.g.
 * the admin_reports table not yet migrated) is caught and warn-logged; GC,
 * cleanup and boot must never fail because reporting failed. Test seam:
 * `WEA_SKIP_ADMIN_REPORTS` truthy ⇒ all writes no-op.
 */

/* eslint-disable no-console -- best-effort ops reporting */

const ADMIN_REPORT_KINDS = Object.freeze({
  gc: 'gc',
  migration: 'migration',
  failsafe: 'failsafe',
  night_eval: 'night_eval',
  cleanup: 'cleanup',
});

const ADMIN_REPORT_STATUSES = Object.freeze({
  ok: 'ok',
  partial: 'partial',
});

/** Test seam: any truthy value disables admin report persistence. */
function shouldSkipAdminReports() {
  const skip = (process.env.WEA_SKIP_ADMIN_REPORTS || '').toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(skip);
}

/**
 * Derive the row status from a run result: 'partial' when the result or any
 * nested section (e.g. GC `tier1`/`tier2`/`tier3`) carries errors, else 'ok'.
 * @param {Object} [result]
 * @returns {'ok'|'partial'}
 */
function resolveAdminReportStatus(result) {
  if (result && Array.isArray(result.errors) && result.errors.length > 0) {
    return ADMIN_REPORT_STATUSES.partial;
  }
  if (result && typeof result === 'object') {
    const sections = Object.values(result).filter((value) => value && typeof value === 'object');
    if (sections.some((section) => Array.isArray(section.errors) && section.errors.length > 0)) {
      return ADMIN_REPORT_STATUSES.partial;
    }
  }
  return ADMIN_REPORT_STATUSES.ok;
}

/**
 * Factory. `insertReport` is the store seam — injected in tests; the shared
 * singleton stays inert until T0.8 wires the admin_reports store function.
 *
 * @param {Object} [opts]
 * @param {(row: {kind, status, payload, created_at}) => Promise<Object>} [opts.insertReport]
 * @param {() => string} [opts.now] - ISO timestamp provider (tests)
 */
function createAdminReportsWriter({
  insertReport = null,
  now = () => new Date().toISOString(),
} = {}) {
  /**
   * Persist one report row. Returns the insertReport result, or null when
   * skipped (seam / no store / write failure) — never throws to the caller.
   * @param {{ kind: string, status: string, payload?: Object }} spec
   */
  async function writeReport({ kind, status, payload } = {}) {
    if (shouldSkipAdminReports()) return null;
    if (!ADMIN_REPORT_KINDS[kind]) {
      throw new TypeError(`Unknown admin report kind: ${String(kind)}`);
    }
    if (typeof insertReport !== 'function') return null; // store not wired (T0.8)

    const row = {
      kind,
      status: ADMIN_REPORT_STATUSES[status] || status,
      payload: payload === undefined ? null : payload,
      created_at: now(),
    };
    try {
      const result = await insertReport(row);
      return result === undefined ? null : result;
    } catch (error) {
      console.warn(`admin report persistence skipped: ${error.message}`);
      return null;
    }
  }

  return { writeReport };
}

let sharedWriter = null;

/** The process-wide writer. Inert until the T0.8 store function is wired. */
function getAdminReportsWriter() {
  if (!sharedWriter) {
    sharedWriter = createAdminReportsWriter();
  }
  return sharedWriter;
}

module.exports = {
  ADMIN_REPORT_KINDS,
  ADMIN_REPORT_STATUSES,
  createAdminReportsWriter,
  getAdminReportsWriter,
  resolveAdminReportStatus,
  shouldSkipAdminReports,
};
