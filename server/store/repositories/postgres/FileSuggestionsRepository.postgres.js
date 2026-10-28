'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapSuggestionRow, inPlaceholders } = require('../fileSuggestionsShared');
const { FILE_SUGGESTION_STATE } = require('@webdav-easyaccess/shared/constants');

/**
 * postgres implementation of FileSuggestionsRepository (`$n` placeholders).
 * `reason` binds with an explicit `::jsonb` cast; the pg driver returns JSONB
 * already parsed, so the shared mapper consumes it as an object directly.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresFileSuggestionsRepository(executor) {
  return {
    dialect: 'postgres',

    async insert({ userId, nodeId, kind, reason, expiresAt }) {
      try {
        // executor.run() injects `RETURNING id` for INSERTs (the pgExecutor
        // single-PK idiom) and reports the generated id as `lastId`.
        const result = await executor.run(
          `INSERT INTO file_suggestions (user_id, node_id, kind, reason, state, created_at, expires_at)
           VALUES ($1, $2, $3, $4::jsonb, '${FILE_SUGGESTION_STATE.PENDING}', NOW(), $5::timestamptz)`,
          [
            Number(userId),
            Number(nodeId),
            String(kind),
            reason === null || reason === undefined ? null : JSON.stringify(reason),
            expiresAt ?? null,
          ]
        );
        return { id: Number(result.lastId) };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listPending(userId) {
      try {
        const { rows } = await executor.query(
          `SELECT * FROM file_suggestions
            WHERE user_id = $1 AND state = '${FILE_SUGGESTION_STATE.PENDING}'
            ORDER BY id`,
          [Number(userId)]
        );
        return rows.map(mapSuggestionRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listKeys(userId) {
      try {
        const { rows } = await executor.query(
          'SELECT node_id, kind, state FROM file_suggestions WHERE user_id = $1 ORDER BY id',
          [Number(userId)]
        );
        return rows.map((row) => ({
          nodeId: Number(row.node_id),
          kind: row.kind,
          state: row.state,
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async dismiss(userId, id) {
      try {
        const result = await executor.run(
          `UPDATE file_suggestions SET state = '${FILE_SUGGESTION_STATE.DISMISSED}'
            WHERE id = $1 AND user_id = $2 AND state = '${FILE_SUGGESTION_STATE.PENDING}'`,
          [Number(id), Number(userId)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async updateReason(userId, id, reason) {
      try {
        const result = await executor.run(
          `UPDATE file_suggestions SET reason = $1::jsonb
            WHERE id = $2 AND user_id = $3 AND state = '${FILE_SUGGESTION_STATE.PENDING}'`,
          [
            reason === null || reason === undefined ? null : JSON.stringify(reason),
            Number(id),
            Number(userId),
          ]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listIdsByNodesTx(tx, userId, nodeIds, state) {
      if (!Array.isArray(nodeIds) || nodeIds.length === 0) return [];
      try {
        const params = [Number(userId), String(state), ...nodeIds.map(Number)];
        const { rows } = await tx.query(
          `SELECT id, node_id, kind FROM file_suggestions
            WHERE user_id = $1 AND state = $2 AND node_id IN (${inPlaceholders(nodeIds.length, 3)})
            ORDER BY id`,
          params
        );
        return rows.map((row) => ({
          id: Number(row.id),
          nodeId: Number(row.node_id),
          kind: row.kind,
        }));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async flipStatesTx(tx, { ids, fromState, toState }) {
      if (!Array.isArray(ids) || ids.length === 0) return { changes: 0 };
      try {
        const params = [String(toState), String(fromState), ...ids.map(Number)];
        const result = await tx.run(
          `UPDATE file_suggestions SET state = $1
            WHERE state = $2 AND id IN (${inPlaceholders(ids.length, 3)})`,
          params
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async expireStale({ now, limit }) {
      try {
        const cutoff = new Date(now ?? Date.now()).toISOString();
        const cap = Number.isInteger(limit) && limit > 0 ? limit : 1000;
        const { rows } = await executor.query(
          `SELECT id FROM file_suggestions
            WHERE state = '${FILE_SUGGESTION_STATE.PENDING}' AND expires_at IS NOT NULL AND expires_at < $1::timestamptz
            ORDER BY id LIMIT $2::int`,
          [cutoff, cap]
        );
        const ids = rows.map((row) => Number(row.id));
        if (ids.length === 0) return { changes: 0, ids: [] };
        const result = await executor.run(
          `UPDATE file_suggestions SET state = '${FILE_SUGGESTION_STATE.EXPIRED}'
            WHERE state = '${FILE_SUGGESTION_STATE.PENDING}' AND id IN (${inPlaceholders(ids.length)})`,
          ids
        );
        return { changes: result.changes, ids };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
