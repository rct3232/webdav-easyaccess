'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapUsageRow, normalizeUsageEvent } = require('../aiUsageDailyShared');

/**
 * sqlite implementation of AiUsageDailyRepository (`?` placeholders). The
 * increment is ONE upsert statement — concurrent recorders cannot lose an
 * increment by construction (aiUsageDailyStore §2.3).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteAiUsageDailyRepository(executor) {
  return {
    dialect: 'sqlite',

    async recordUsage(event) {
      const usage = normalizeUsageEvent(event);
      try {
        const result = await executor.run(
          `INSERT INTO ai_usage_daily (day, role, calls, input_chars, cached, degraded, failed_429)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (day, role) DO UPDATE SET
             calls = calls + excluded.calls,
             input_chars = input_chars + excluded.input_chars,
             cached = cached + excluded.cached,
             degraded = degraded + excluded.degraded,
             failed_429 = failed_429 + excluded.failed_429`,
          [
            usage.day,
            usage.role,
            usage.calls,
            usage.inputChars,
            usage.cached,
            usage.degraded,
            usage.failed429,
          ]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getByDay(day) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM ai_usage_daily WHERE day = ? ORDER BY role ASC',
          [String(day)]
        );
        return rows.map(mapUsageRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async summarizeRange(opts = {}) {
      const fromDay = String(opts.fromDay);
      const toDay = String(opts.toDay);
      try {
        const { rows } = await executor.query(
          `SELECT role,
                  SUM(calls) AS calls,
                  SUM(input_chars) AS input_chars,
                  SUM(cached) AS cached,
                  SUM(degraded) AS degraded,
                  SUM(failed_429) AS failed_429
           FROM ai_usage_daily
           WHERE day >= ? AND day <= ?
           GROUP BY role
           ORDER BY role ASC`,
          [fromDay, toDay]
        );
        return rows.map(mapUsageRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
