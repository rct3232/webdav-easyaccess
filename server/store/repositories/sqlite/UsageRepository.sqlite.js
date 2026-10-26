'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');

// julianday() parses BOTH timestamp formats that land in sqlite TEXT columns
// (CURRENT_TIMESTAMP-defaulted 'YYYY-MM-DD HH:MM:SS' and bound ISO
// 'YYYY-MM-DDTHH:MM:SS.sssZ'), is UTC-based and makes the watermark/retention
// math format-safe (purgeExpiredTombstones precedent). Julian day 2440587.5 =
// 1970-01-01T00:00:00Z.
const JULIAN_UNIX_EPOCH = 2440587.5;
const DAY_MS = 86400000;

/** julianday REAL (UTC day count) → ms epoch; null passes through. */
function jdToMs(jd) {
  if (jd === null || jd === undefined) return null;
  const ms = Math.round((Number(jd) - JULIAN_UNIX_EPOCH) * DAY_MS);
  return Number.isFinite(ms) ? ms : null;
}

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

/**
 * sqlite implementation of UsageRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteUsageRepository(executor) {
  return {
    dialect: 'sqlite',

    async insertUsageEvent({ userId, nodeId, action, at }) {
      try {
        const result = await executor.run(
          'INSERT INTO usage_events (user_id, node_id, action, created_at) VALUES (?, ?, ?, ?)',
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
                  MAX(julianday(e.created_at)) AS last_seen_jd,
                  MAX(na.opens) AS prev_opens,
                  MAX(na.downloads) AS prev_downloads,
                  MAX(na.previews) AS prev_previews,
                  MAX(na.search_hits) AS prev_search_hits,
                  MAX(na.likes) AS prev_likes,
                  MAX(na.score) AS prev_score,
                  MAX(julianday(na.updated_at)) AS prev_updated_jd
             FROM usage_events e
             LEFT JOIN node_activity na
               ON na.user_id = e.user_id AND na.node_id = e.node_id
            WHERE na.node_id IS NULL
               OR julianday(e.created_at) > julianday(na.updated_at)
            GROUP BY e.user_id, e.node_id
            ORDER BY e.user_id, e.node_id`
        );
        return rows.map((row) => ({
          userId: Number(row.user_id),
          nodeId: Number(row.node_id),
          counts: countsFrom(row),
          lastSeenAtMs: jdToMs(row.last_seen_jd),
          prevScore: Number(row.prev_score) || 0,
          prevCounts: countsFrom(row, 'prev_'),
          prevUpdatedAtMs: jdToMs(row.prev_updated_jd),
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
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    async listNodeActivity(userId, nodeIds) {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) return [];
      try {
        const placeholders = nodeIds.map(() => '?').join(', ');
        const { rows } = await executor.query(
          `SELECT user_id, node_id, opens, downloads, previews, search_hits, likes, score,
                  julianday(last_seen_at) AS last_seen_jd,
                  julianday(updated_at) AS updated_jd
             FROM node_activity
            WHERE user_id = ? AND node_id IN (${placeholders})
            ORDER BY node_id`,
          [Number(userId), ...nodeIds.map(Number)]
        );
        return rows.map((row) => ({
          userId: Number(row.user_id),
          nodeId: Number(row.node_id),
          counts: countsFrom(row),
          lastSeenAtMs: jdToMs(row.last_seen_jd),
          score: Number(row.score) || 0,
          updatedAtMs: jdToMs(row.updated_jd),
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteUsageEventsOlderThan(cutoffMs) {
      try {
        const result = await executor.run(
          'DELETE FROM usage_events WHERE julianday(created_at) < julianday(?)',
          [new Date(cutoffMs).toISOString()]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
