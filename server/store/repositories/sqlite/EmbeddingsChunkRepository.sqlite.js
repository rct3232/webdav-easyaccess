'use strict';

/**
 * SQLite twin of EmbeddingsChunkRepository (docs/spec/server/store/
 * embeddingsChunkStore.md). Composite-PK chunk rows: replaceChunks is ONE
 * executor.transaction (space-scoped DELETE of the node's incoming-model rows
 * + INSERT with PK upsert via the tx handle), listAllByModel is the tuple
 * keyset cursor (node_id, chunk_idx). Every executor call maps driver errors
 * via mapDatabaseError (repository-contract §2.2 rule 4).
 */

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapChunkRow, serializeVector } = require('../embeddingsShared');

module.exports = function createSqliteEmbeddingsChunkRepository(executor) {
  async function get(nodeId, chunkIdx) {
    try {
      const { rows } = await executor.query(
        `SELECT node_id, chunk_idx, model_id, vector, updated_at
         FROM embeddings_chunk WHERE node_id = ? AND chunk_idx = ?`,
        [Number(nodeId), Number(chunkIdx)]
      );
      return rows.length > 0 ? mapChunkRow(rows[0]) : null;
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function listByNode(nodeId, opts = {}) {
    const { modelId } = opts;
    try {
      const params = [Number(nodeId)];
      let where = 'WHERE node_id = ?';
      if (modelId !== undefined && modelId !== null) {
        where += ' AND model_id = ?';
        params.push(Number(modelId));
      }
      const { rows } = await executor.query(
        `SELECT node_id, chunk_idx, model_id, vector, updated_at
         FROM embeddings_chunk ${where} ORDER BY chunk_idx ASC`,
        params
      );
      return rows.map(mapChunkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function replaceChunks(nodeId, modelId, chunks) {
    if (!Array.isArray(chunks)) {
      throw new TypeError('replaceChunks requires a chunks array');
    }
    // Serialize/validate BEFORE the tx — a malformed vector must never
    // trigger the wholesale delete (never stored half-written, spec §2.6).
    const rows = chunks.map((chunk) => ({
      chunkIdx: Number(chunk.chunkIdx),
      vectorText: serializeVector(chunk.vector),
    }));
    try {
      return await executor.transaction(async (tx) => {
        // Space-scoped delete: the node's set for the INCOMING model. Rows of
        // other models at non-colliding indices survive (mid-backfill mixed
        // spaces); a colliding (node_id, chunk_idx) position is claimed by
        // the PK upsert below (newer space wins).
        await tx.run('DELETE FROM embeddings_chunk WHERE node_id = ? AND model_id = ?', [
          Number(nodeId),
          Number(modelId),
        ]);
        for (const row of rows) {
          await tx.run(
            `INSERT INTO embeddings_chunk (node_id, chunk_idx, model_id, vector, updated_at)
             VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT (node_id, chunk_idx) DO UPDATE SET
               vector = excluded.vector,
               model_id = excluded.model_id,
               updated_at = CURRENT_TIMESTAMP`,
            [Number(nodeId), row.chunkIdx, Number(modelId), row.vectorText]
          );
        }
        return { inserted: rows.length };
      });
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteByNode(nodeId) {
    try {
      const result = await executor.run('DELETE FROM embeddings_chunk WHERE node_id = ?', [
        Number(nodeId),
      ]);
      return { changes: result.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function deleteByModel(modelId) {
    try {
      const result = await executor.run('DELETE FROM embeddings_chunk WHERE model_id = ?', [
        Number(modelId),
      ]);
      return { changes: result.changes };
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function countByNode(nodeId, opts = {}) {
    const { modelId } = opts;
    try {
      const params = [Number(nodeId)];
      let where = 'WHERE node_id = ?';
      if (modelId !== undefined && modelId !== null) {
        where += ' AND model_id = ?';
        params.push(Number(modelId));
      }
      const { rows } = await executor.query(`SELECT COUNT(*) AS count FROM embeddings_chunk ${where}`, params);
      return Number(rows[0].count);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  async function listAllByModel(modelId, opts = {}) {
    const { afterNodeId, afterChunkIdx, limit } = opts;
    try {
      const params = [Number(modelId)];
      let where = 'WHERE model_id = ?';
      if (afterNodeId !== undefined && afterNodeId !== null) {
        const chunkCursor =
          afterChunkIdx === undefined || afterChunkIdx === null ? -1 : Number(afterChunkIdx);
        where += ' AND (node_id > ? OR (node_id = ? AND chunk_idx > ?))';
        params.push(Number(afterNodeId), Number(afterNodeId), chunkCursor);
      }
      let limitClause = '';
      if (limit !== undefined && limit !== null) {
        limitClause = ' LIMIT ?';
        params.push(Number(limit));
      }
      const { rows } = await executor.query(
        `SELECT node_id, chunk_idx, model_id, vector, updated_at
         FROM embeddings_chunk ${where} ORDER BY node_id ASC, chunk_idx ASC${limitClause}`,
        params
      );
      return rows.map(mapChunkRow);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }

  return {
    dialect: 'sqlite',
    get,
    listByNode,
    replaceChunks,
    deleteByNode,
    deleteByModel,
    countByNode,
    listAllByModel,
  };
};
