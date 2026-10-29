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
 * postgres implementation of AiJobsRepository (`$n` placeholders). The claim
 * is one TX with `FOR UPDATE SKIP LOCKED` — concurrent workers skip past
 * locked rows, no lost or double claims (§2.4). All instants this store
 * WRITES are bound ISO strings (repository-contract rule 2).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresAiJobsRepository(executor) {
  return {
    dialect: 'postgres',

    async enqueue(nodeId, kind, generation, contentHash) {
      try {
        const result = await executor.run(
          `INSERT INTO ai_jobs (node_id, kind, generation, content_hash)
           VALUES ($1, $2, $3, $4)
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
        if (!result || result.changes === 0 || result.lastId === undefined) return null;
        return { id: Number(result.lastId) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async enqueueMany(items) {
      try {
        return await executor.transaction((tx) => this.enqueueManyTx(tx, items));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async enqueueManyTx(tx, items) {
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) return { enqueued: 0, ids: [] };
      const ids = [];
      for (const item of list) {
        const result = await tx.run(
          `INSERT INTO ai_jobs (node_id, kind, generation, content_hash)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (node_id, kind, generation) DO NOTHING
           RETURNING id`,
          [
            Number(item.nodeId),
            String(item.kind),
            Number(item.generation),
            item.contentHash ?? null,
          ]
        );
        const insertedId =
          result.lastId !== undefined ? result.lastId : result.rows && result.rows[0]?.id;
        if (result.changes > 0 && insertedId !== undefined) {
          ids.push(Number(insertedId));
        }
      }
      return { enqueued: ids.length, ids };
    },

    async cancelPending({ jobIds } = {}) {
      try {
        return await executor.transaction((tx) => this.cancelPendingTx(tx, { jobIds }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async cancelPendingTx(tx, { jobIds } = {}) {
      const ids = [
        ...new Set(
          (Array.isArray(jobIds) ? jobIds : [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        ),
      ];
      const cancelledIds = [];
      const skippedIds = [];
      const now = new Date().toISOString();
      for (const id of ids) {
        const result = await tx.run(
          `UPDATE ai_jobs SET status = 'cancelled', finished_at = $1
           WHERE id = $2 AND status = 'pending'`,
          [now, id]
        );
        if (result.changes > 0) cancelledIds.push(id);
        else skippedIds.push(id);
      }
      return { cancelledIds, skippedIds };
    },

    async claimNext(opts = {}) {
      // Normalized ONCE: the same array feeds the placeholder slots and the
      // bound parameters — never the raw caller input (slot/value desync).
      const excludeKinds = normalizeExcludeKinds(opts.excludeKinds);
      try {
        return await executor.transaction(async (tx) => {
          const now = new Date().toISOString();
          // postgres `$n` are indexed per predicate position: $1 = ISO
          // instant, $2..$n = excluded kinds (§2.4 + §2.3 filter).
          const locked = await tx.query(
            `SELECT id FROM ai_jobs
             WHERE ${buildClaimPredicate(excludeKinds, (index) => `$${index + 1}`)}
             ORDER BY id
             LIMIT 1
             FOR UPDATE SKIP LOCKED`,
            [now, ...excludeKinds]
          );
          if (locked.rows.length === 0) return null;
          const claimed = await tx.run(
            `UPDATE ai_jobs SET status = 'running', started_at = $1
             WHERE id = $2
             RETURNING *`,
            [now, Number(locked.rows[0].id)]
          );
          return mapJobRow(claimed.rows[0]);
        });
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async markDone(jobId) {
      try {
        const result = await executor.run(
          `UPDATE ai_jobs SET status = 'done', finished_at = $1
           WHERE id = $2 AND status = 'running'`,
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
          const { rows } = await tx.query('SELECT attempt FROM ai_jobs WHERE id = $1', [
            Number(jobId),
          ]);
          if (rows.length === 0) return { changes: 0 };
          const nextAttempt = Number(rows[0].attempt) + 1;
          const now = new Date();
          const nextRetryAt = new Date(now.getTime() + backoffMs(nextAttempt)).toISOString();
          const result = await tx.run(
            `UPDATE ai_jobs
             SET status = 'failed', attempt = attempt + 1, last_error = $1,
                 next_retry_at = $2, finished_at = $3
             WHERE id = $4 AND status = 'running'`,
            [truncateError(error), nextRetryAt, now.toISOString(), Number(jobId)]
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
          `UPDATE ai_jobs SET status = 'skipped', finished_at = $1, last_error = $2
           WHERE id = $3 AND status = 'running'`,
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
        const now = new Date().toISOString();
        const result = await executor.run(
          `UPDATE ai_jobs
           SET status = 'failed', attempt = attempt + 1, next_retry_at = $1, finished_at = $2
           WHERE status = 'running' AND started_at IS NOT NULL AND started_at < $3`,
          [now, now, cutoff]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getById(jobId) {
      try {
        const { rows } = await executor.query('SELECT * FROM ai_jobs WHERE id = $1', [
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
          ? 'SELECT * FROM ai_jobs WHERE node_id = $1 ORDER BY id'
          : 'SELECT * FROM ai_jobs WHERE node_id = $1 AND generation = $2 ORDER BY id';
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

    async countFailedSince(sinceIso) {
      try {
        const { rows } = await executor.query(
          `SELECT COUNT(*) AS cnt FROM ai_jobs
           WHERE status = 'failed' AND finished_at IS NOT NULL AND finished_at >= $1`,
          [String(sinceIso)]
        );
        return Number(rows[0]?.cnt ?? 0);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async countFinishedSince(sinceIso) {
      try {
        const { rows } = await executor.query(
          `SELECT COUNT(*) AS cnt FROM ai_jobs
           WHERE finished_at IS NOT NULL AND finished_at >= $1`,
          [String(sinceIso)]
        );
        return Number(rows[0]?.cnt ?? 0);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async countActiveByIds(jobIds) {
      const ids = [
        ...new Set(
          (Array.isArray(jobIds) ? jobIds : [])
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
        ),
      ];
      if (ids.length === 0) return 0;
      try {
        let total = 0;
        for (let start = 0; start < ids.length; start += 500) {
          const batch = ids.slice(start, start + 500);
          const placeholders = batch.map((_, index) => `$${index + 1}`).join(', ');
          const { rows } = await executor.query(
            `SELECT COUNT(*) AS cnt FROM ai_jobs
             WHERE id IN (${placeholders}) AND status IN ('pending', 'running')`,
            batch
          );
          total += Number(rows[0]?.cnt ?? 0);
        }
        return total;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listFailed(opts = {}) {
      const limit = Number.isInteger(opts.limit) && opts.limit > 0 ? opts.limit : 50;
      try {
        const { rows } = await executor.query(
          `SELECT * FROM ai_jobs WHERE status = 'failed' ORDER BY id DESC LIMIT $1`,
          [limit]
        );
        return rows.map(mapJobRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
