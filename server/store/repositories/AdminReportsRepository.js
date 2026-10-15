'use strict';

/**
 * AdminReportsRepository — domain interface over the `admin_reports` table
 * (§5 DDL, T0.2; docs/spec/server/routes/admin.md §2.2.6).
 *
 * Rows are domain-shaped `{ id, kind, status, payload, createdAt }` — payload
 * is a parsed object|null on both dialects (JSONB pg / TEXT sqlite),
 * createdAt an ISO string. Wire shaping (`created_at`) happens at the route
 * (CODING_STYLE Express Patterns).
 *
 * The table has NO user FKs: rows are ops artifacts owned by the admin
 * domain, written best-effort by the shared admin-reports writer.
 *
 * @typedef {Object} AdminReportsRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(row: { kind: string, status: string, payload?: Object|null, created_at: string }) => Promise<{ id: number, kind: string, status: string, payload: Object|null, createdAt: string }>} insertReport
 * @property {() => Promise<Array<{ id: number, kind: string, status: string, payload: Object|null, createdAt: string }>>} listReports
 *   Newest first (created_at DESC, id DESC tiebreak).
 * @property {(id: number|string) => Promise<Object|null>} getReport
 * @property {(id: number|string, patch: { payload?: Object, status?: string }) => Promise<Object|null>} updateReport
 *   Patches only the provided fields; returns the updated row, or null when
 *   the id does not exist.
 * @property {(cutoffMs: number) => Promise<{ changes: number }>} deleteReportsOlderThan
 *   Writer-side housekeeping (admin.md §2.2.6): deletes rows with
 *   created_at < cutoff (ISO-mapped), idempotent, best-effort.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {AdminReportsRepository}
 */
const { parseJsonColumn } = require('./rowMappers');
const { toIsoString } = require('../../utils/sharedHelpers');

function mapReportRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    kind: row.kind,
    status: row.status,
    payload: parseJsonColumn(row.payload),
    createdAt: toIsoString(row.created_at),
  };
}

module.exports = function createAdminReportsRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createAdminReportsRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/AdminReportsRepository.sqlite')
      : require('./postgres/AdminReportsRepository.postgres');
  return impl(executor, { mapReportRow });
};
