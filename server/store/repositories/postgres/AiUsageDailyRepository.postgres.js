'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapUsageRow, normalizeUsageEvent } = require('../aiUsageDailyShared');

/**
 * postgres implementation of AiUsageDailyRepository (`$n` placeholders). The
 * increment is ONE upsert statement — concurrent recorders cannot lose an
 * increment by construction (aiUsageDailyStore §2.3).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresAiUsageDailyRepository(executor) {
  return {
    dialect: 'postgres',

    async recordUsage(event) {
      const usage = normalizeUsageEvent(event);
      try {
        const result = await executor.run(
          `INSERT INTO ai_usage_daily (day, role, calls, input_chars, cached, degraded, failed_429)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (day, role) DO UPDATE SET
             calls = ai_usage_daily.calls + excluded.calls,
             input_chars = ai_usage_daily.input_chars + excluded.input_chars,
             cached = ai_usage_daily.cached + excluded.cached,
             degraded = ai_usage_daily.degraded + excluded.degraded,
             failed_429 = ai_usage_daily.failed_429 + excluded.failed_429`,
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
          'SELECT * FROM ai_usage_daily WHERE day = $1 ORDER BY role ASC',
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
           WHERE day >= $1 AND day <= $2
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
