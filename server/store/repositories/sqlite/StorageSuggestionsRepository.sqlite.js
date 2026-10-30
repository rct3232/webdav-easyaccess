'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapSuggestionRow } = require('../storageSuggestionsShared');
const { STORAGE_SUGGESTION_STATE } = require('@webdav-easyaccess/shared/constants');

/**
 * sqlite implementation of StorageSuggestionsRepository (`?` placeholders).
 * `reason` binds as the JSON string (JSONB → TEXT in the sqlite conversion);
 * the shared mapper parses it back at the boundary. Methods taking `tx` run
 * against a caller-owned transaction OR the executor itself (same queryable
 * shape — actionJournalRepository precedent).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteStorageSuggestionsRepository(executor) {
  const placeholders = (count) => Array.from({ length: count }, () => '?').join(', ');

  return {
    dialect: 'sqlite',

    async insert({ userId, nodeId, kind, reason, expiresAt }) {
      try {
        const result = await executor.run(
          `INSERT INTO storage_suggestions (user_id, node_id, kind, reason, state, created_at, expires_at)
           VALUES (?, ?, ?, ?, '${STORAGE_SUGGESTION_STATE.PENDING}', CURRENT_TIMESTAMP, ?)`,
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
          `SELECT * FROM storage_suggestions
            WHERE user_id = ? AND state = '${STORAGE_SUGGESTION_STATE.PENDING}'
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
          'SELECT node_id, kind, state FROM storage_suggestions WHERE user_id = ? ORDER BY id',
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
          `UPDATE storage_suggestions SET state = '${STORAGE_SUGGESTION_STATE.DISMISSED}'
            WHERE id = ? AND user_id = ? AND state = '${STORAGE_SUGGESTION_STATE.PENDING}'`,
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
          `UPDATE storage_suggestions SET reason = ?
            WHERE id = ? AND user_id = ? AND state = '${STORAGE_SUGGESTION_STATE.PENDING}'`,
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
        const { rows } = await tx.query(
          `SELECT id, node_id, kind FROM storage_suggestions
            WHERE user_id = ? AND state = ? AND node_id IN (${placeholders(nodeIds.length)})
            ORDER BY id`,
          [Number(userId), String(state), ...nodeIds.map(Number)]
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
        const result = await tx.run(
          `UPDATE storage_suggestions SET state = ?
            WHERE state = ? AND id IN (${placeholders(ids.length)})`,
          [String(toState), String(fromState), ...ids.map(Number)]
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
          `SELECT id FROM storage_suggestions
            WHERE state = '${STORAGE_SUGGESTION_STATE.PENDING}' AND expires_at IS NOT NULL AND expires_at < ?
            ORDER BY id LIMIT ?`,
          [cutoff, cap]
        );
        const ids = rows.map((row) => Number(row.id));
        if (ids.length === 0) return { changes: 0, ids: [] };
        const result = await executor.run(
          `UPDATE storage_suggestions SET state = '${STORAGE_SUGGESTION_STATE.EXPIRED}'
            WHERE state = '${STORAGE_SUGGESTION_STATE.PENDING}' AND id IN (${placeholders(ids.length)})`,
          ids
        );
        return { changes: result.changes, ids };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
