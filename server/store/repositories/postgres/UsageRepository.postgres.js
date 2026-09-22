'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

function countsFrom(row, prefix = '') {
  return {
    open: Number(row[`${prefix}opens`]) || 0,
    download: Number(row[`${prefix}downloads`]) || 0,
    preview: Number(row[`${prefix}previews`]) || 0,
    search_hit: Number(row[`${prefix}search_hits`]) || 0,
    like: Number(row[`${prefix}likes`]) || 0,
  };
}

/** NodeActivityRow.counts (domain keys) → storage column values. */
function countsToColumns(counts = {}) {
  return {
    open: Number(counts.open) || 0,
    download: Number(counts.download) || 0,
    preview: Number(counts.preview) || 0,
    search_hit: Number(counts.search_hit) || 0,
    like: Number(counts.like) || 0,
  };
}

/** node-pg returns timestamptz as Date; normalize any value to ms epoch. */
function toMs(value) {
  if (value === null || value === undefined) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * PostgreSQL implementation of UsageRepository (`$n` placeholders). TIMESTAMPTZ
 * comparisons/aggregation are native (no julianday shim needed).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresUsageRepository(executor) {
  return {
    dialect: 'postgres',

    async insertUsageEvent({ userId, nodeId, action, at }) {
      try {
        const result = await executor.run(
          'INSERT INTO usage_events (user_id, node_id, action, created_at) VALUES ($1, $2, $3, $4)',
          [
            Number(userId),
            Number(nodeId),
            String(action),
            at ? new Date(at).toISOString() : new Date().toISOString(),
          ]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async readRollupGroups() {
      try {
        const { rows } = await executor.query(
          `SELECT e.user_id AS user_id,
                  e.node_id AS node_id,
                  SUM(CASE WHEN e.action = 'open' THEN 1 ELSE 0 END) AS opens,
                  SUM(CASE WHEN e.action = 'download' THEN 1 ELSE 0 END) AS downloads,
                  SUM(CASE WHEN e.action = 'preview' THEN 1 ELSE 0 END) AS previews,
                  SUM(CASE WHEN e.action = 'search_hit' THEN 1 ELSE 0 END) AS search_hits,
                  SUM(CASE WHEN e.action = 'like' THEN 1 ELSE 0 END) AS likes,
                  MAX(e.created_at) AS last_seen_at,
                  MAX(na.opens) AS prev_opens,
                  MAX(na.downloads) AS prev_downloads,
                  MAX(na.previews) AS prev_previews,
                  MAX(na.search_hits) AS prev_search_hits,
                  MAX(na.likes) AS prev_likes,
                  MAX(na.score) AS prev_score,
                  MAX(na.updated_at) AS prev_updated_at
             FROM usage_events e
             LEFT JOIN node_activity na
               ON na.user_id = e.user_id AND na.node_id = e.node_id
            WHERE na.node_id IS NULL
               OR e.created_at > na.updated_at
            GROUP BY e.user_id, e.node_id
            ORDER BY e.user_id, e.node_id`
        );
        return rows.map((row) => ({
          userId: Number(row.user_id),
          nodeId: Number(row.node_id),
          counts: countsFrom(row),
          lastSeenAtMs: toMs(row.last_seen_at),
          prevScore: Number(row.prev_score) || 0,
          prevCounts: countsFrom(row, 'prev_'),
          prevUpdatedAtMs: toMs(row.prev_updated_at),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertNodeActivity(rows) {
      if (!rows || rows.length === 0) return { changes: 0 };
      try {
        let changes = 0;
        for (const row of rows) {
          const counts = countsToColumns(row.counts);
          const result = await executor.run(
            `INSERT INTO node_activity
               (user_id, node_id, opens, downloads, previews, search_hits, last_seen_at, likes, score, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
             ON CONFLICT (user_id, node_id) DO UPDATE SET
               opens = excluded.opens,
               downloads = excluded.downloads,
               previews = excluded.previews,
               search_hits = excluded.search_hits,
               likes = excluded.likes,
               last_seen_at = excluded.last_seen_at,
               score = excluded.score,
               updated_at = excluded.updated_at`,
            [
              Number(row.userId),
              Number(row.nodeId),
              counts.open,
              counts.download,
              counts.preview,
              counts.search_hit,
              new Date(row.lastSeenAtMs).toISOString(),
              counts.like,
              Number(row.score) || 0,
              new Date(row.updatedAtMs).toISOString(),
            ]
          );
          changes += result.changes;
        }
        return { changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteUsageEventsOlderThan(cutoffMs) {
      try {
        const result = await executor.run('DELETE FROM usage_events WHERE created_at < $1', [
          new Date(cutoffMs).toISOString(),
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
