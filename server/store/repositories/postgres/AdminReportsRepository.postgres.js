'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { toIsoString } = require('../../../utils/sharedHelpers');

/**
 * PostgreSQL implementation of AdminReportsRepository (`$n` placeholders;
 * payload JSONB natively).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 * @param {{ mapReportRow: Function }} shared
 */
module.exports = function createPostgresAdminReportsRepository(executor, { mapReportRow }) {
  return {
    dialect: 'postgres',

    async insertReport(row) {
      const spec = row || {};
      try {
        const createdAt = toIsoString(spec.created_at) || new Date().toISOString();
        const result = await executor.run(
          `INSERT INTO admin_reports (kind, status, payload, created_at)
           VALUES ($1, $2, $3, $4)`,
          [
            String(spec.kind),
            String(spec.status),
            spec.payload === null || spec.payload === undefined ? null : spec.payload,
            createdAt,
          ]
        );
        return {
          id: Number(result.lastId),
          kind: String(spec.kind),
          status: String(spec.status),
          payload: spec.payload === undefined ? null : spec.payload,
          createdAt,
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
        const { rows } = await executor.query('SELECT * FROM admin_reports WHERE id = $1 LIMIT 1', [
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
        params.push(p.payload === null ? null : p.payload);
        sets.push(`payload = $${params.length}`);
      }
      if (p.status !== undefined) {
        params.push(String(p.status));
        sets.push(`status = $${params.length}`);
      }
      if (sets.length === 0) {
        return await this.getReport(id);
      }
      params.push(Number(id));
      try {
        const res = await executor.run(
          `UPDATE admin_reports SET ${sets.join(', ')} WHERE id = $${params.length}`,
          params
        );
        if (!res.changes) return null;
        return await this.getReport(id);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteReportsOlderThan(cutoffMs, opts = {}) {
      const limit = Number(opts && opts.limit);
      const bounded = Number.isInteger(limit) && limit > 0;
      try {
        const sql = bounded
          ? `DELETE FROM admin_reports WHERE id IN (
               SELECT id FROM admin_reports
                WHERE created_at < $1
                ORDER BY id
                LIMIT $2
             )`
          : 'DELETE FROM admin_reports WHERE created_at < $1';
        const params = [new Date(cutoffMs).toISOString()];
        if (bounded) params.push(limit);
        const result = await executor.run(sql, params);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
