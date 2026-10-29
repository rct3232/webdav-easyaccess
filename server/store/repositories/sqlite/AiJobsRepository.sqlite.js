'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const {
  buildClaimPredicate,
  backoffMs,
  mapJobRow,
  normalizeExcludeKinds,
  truncateError,
} = require('../aiJobsShared');

/**
 * sqlite implementation of AiJobsRepository (`?` placeholders). The driver is
 * a single-writer serialized queue — the claim is one lock-free statement
 * (§2.4); node:sqlite provides `RETURNING`. All instants this store WRITES
 * are bound ISO strings (repository-contract rule 2; julianday() compares
 * both the bound-ISO and CURRENT_TIMESTAMP-defaulted shapes).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteAiJobsRepository(executor) {
  return {
    dialect: 'sqlite',

    async enqueue(nodeId, kind, generation, contentHash) {
      try {
        const result = await executor.run(
          `INSERT INTO ai_jobs (node_id, kind, generation, content_hash)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (node_id, kind, generation) DO UPDATE
             SET status = 'pending',
                 attempt = 0,
                 next_retry_at = NULL,
                 started_at = NULL,
                 finished_at = NULL,
                 last_error = NULL,
                 content_hash = excluded.content_hash
             WHERE ai_jobs.content_hash IS NOT NULL
               AND excluded.content_hash IS NOT NULL
               AND ai_jobs.content_hash <> excluded.content_hash
           RETURNING id`,
          [Number(nodeId), String(kind), Number(generation), contentHash ?? null]
        );
        if (!result.rows || result.rows.length === 0) return null;
        return { id: Number(result.rows[0].id) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async enqueueMany(items) {
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) return { enqueued: 0 };
      try {
        return await executor.transaction(async (tx) => {
          let enqueued = 0;
          for (const item of list) {
            const result = await tx.run(
              `INSERT INTO ai_jobs (node_id, kind, generation, content_hash)
               VALUES (?, ?, ?, ?)
               ON CONFLICT (node_id, kind, generation) DO NOTHING`,
              [
                Number(item.nodeId),
                String(item.kind),
                Number(item.generation),
                item.contentHash ?? null,
              ]
            );
            enqueued += result.changes;
          }
          return { enqueued };
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async claimNext(opts = {}) {
      // Normalized ONCE: the same array feeds the placeholder slots and the
      // bound parameters — never the raw caller input (slot/value desync).
      const excludeKinds = normalizeExcludeKinds(opts.excludeKinds);
      try {
        const now = new Date().toISOString();
        // sqlite `?` are positional: started_at first, then the predicate's
        // ISO instant, then one slot per excluded kind (§2.4 + §2.3 filter).
        const result = await executor.run(
          `UPDATE ai_jobs SET status = 'running', started_at = ?
           WHERE id = (
             SELECT id FROM ai_jobs
             WHERE ${buildClaimPredicate(excludeKinds, () => '?')}
             ORDER BY id
             LIMIT 1
           )
           RETURNING *`,
          [now, now, ...excludeKinds]
        );
        if (!result.rows || result.rows.length === 0) return null;
        return mapJobRow(result.rows[0]);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async markDone(jobId) {
      try {
        const result = await executor.run(
          `UPDATE ai_jobs SET status = 'done', finished_at = ?
           WHERE id = ? AND status = 'running'`,
          [new Date().toISOString(), Number(jobId)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async markFailed(jobId, error) {
      try {
        return await executor.transaction(async (tx) => {
          const { rows } = await tx.query('SELECT attempt FROM ai_jobs WHERE id = ?', [
            Number(jobId),
          ]);
          if (rows.length === 0) return { changes: 0 };
          const nextAttempt = Number(rows[0].attempt) + 1;
          const nextRetryAt = new Date(Date.now() + backoffMs(nextAttempt)).toISOString();
          const result = await tx.run(
            `UPDATE ai_jobs
             SET status = 'failed', attempt = attempt + 1, last_error = ?, next_retry_at = ?
             WHERE id = ? AND status = 'running'`,
            [truncateError(error), nextRetryAt, Number(jobId)]
          );
          return { changes: result.changes };
        });
      } catch (txError) {
        throw mapDatabaseError(txError);
      }
    },

    async markSkipped(jobId, reason) {
      try {
        const result = await executor.run(
          `UPDATE ai_jobs SET status = 'skipped', finished_at = ?, last_error = ?
           WHERE id = ? AND status = 'running'`,
          [new Date().toISOString(), truncateError(reason), Number(jobId)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async recoverStaleRunning(staleMs) {
      const cutoff = new Date(Date.now() - Number(staleMs)).toISOString();
      try {
        const result = await executor.run(
          `UPDATE ai_jobs
           SET status = 'failed', attempt = attempt + 1, next_retry_at = ?
           WHERE status = 'running' AND started_at IS NOT NULL AND started_at < ?`,
          [new Date().toISOString(), cutoff]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getById(jobId) {
      try {
        const { rows } = await executor.query('SELECT * FROM ai_jobs WHERE id = ?', [
          Number(jobId),
        ]);
        return rows[0] ? mapJobRow(rows[0]) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listByNode(nodeId, opts = {}) {
      const sql =
        opts.generation === undefined
          ? 'SELECT * FROM ai_jobs WHERE node_id = ? ORDER BY id'
          : 'SELECT * FROM ai_jobs WHERE node_id = ? AND generation = ? ORDER BY id';
      const params =
        opts.generation === undefined
          ? [Number(nodeId)]
          : [Number(nodeId), Number(opts.generation)];
      try {
        const { rows } = await executor.query(sql, params);
        return rows.map(mapJobRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async countByStatus() {
      try {
        const { rows } = await executor.query(
          'SELECT status, COUNT(*) AS cnt FROM ai_jobs GROUP BY status'
        );
        const counts = { pending: 0, running: 0, done: 0, failed: 0, skipped: 0, cancelled: 0 };
        for (const row of rows) counts[String(row.status)] = Number(row.cnt);
        return counts;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listFailed(opts = {}) {
      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
      try {
        const { rows } = await executor.query(
          `SELECT * FROM ai_jobs WHERE status = 'failed' ORDER BY id DESC LIMIT ?`,
          [limit]
        );
        return rows.map(mapJobRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
