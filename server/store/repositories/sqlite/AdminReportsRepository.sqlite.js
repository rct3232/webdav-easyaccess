'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { toIsoString } = require('../../../utils/sharedHelpers');

/**
 * sqlite implementation of AdminReportsRepository (`?` placeholders; payload
 * JSONB → TEXT via JSON.stringify).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 * @param {{ mapReportRow: Function }} shared
 */
module.exports = function createSqliteAdminReportsRepository(executor, { mapReportRow }) {
  return {
    dialect: 'sqlite',

    async insertReport(row) {
      const spec = row || {};
      try {
        const result = await executor.run(
          `INSERT INTO admin_reports (kind, status, payload, created_at)
           VALUES (?, ?, ?, ?)`,
          [
            String(spec.kind),
            String(spec.status),
            spec.payload === null || spec.payload === undefined
              ? null
              : JSON.stringify(spec.payload),
            toIsoString(spec.created_at) || new Date().toISOString(),
          ]
        );
        return {
          id: Number(result.lastId),
          kind: String(spec.kind),
          status: String(spec.status),
          payload: spec.payload === undefined ? null : spec.payload,
          createdAt: toIsoString(spec.created_at) || new Date().toISOString(),
        };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listReports() {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM admin_reports ORDER BY created_at DESC, id DESC'
        );
        return rows.map(mapReportRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getReport(id) {
      try {
        const { rows } = await executor.query('SELECT * FROM admin_reports WHERE id = ? LIMIT 1', [
          Number(id),
        ]);
        return mapReportRow(rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateReport(id, patch) {
      const p = patch || {};
      const sets = [];
      const params = [];
      if (p.payload !== undefined) {
        sets.push('payload = ?');
        params.push(p.payload === null ? null : JSON.stringify(p.payload));
      }
      if (p.status !== undefined) {
        sets.push('status = ?');
        params.push(String(p.status));
      }
      if (sets.length === 0) {
        const current = await this.getReport(id);
        return current;
      }
      params.push(Number(id));
      try {
        const res = await executor.run(
          `UPDATE admin_reports SET ${sets.join(', ')} WHERE id = ?`,
          params
        );
        if (!res.changes) return null;
        return await this.getReport(id);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
