'use strict';

/**
 * Postgres twin of EmbeddingsRepository (docs/spec/server/store/
 * embeddingsStore.md). Mirrors the SQLite logic exactly; `$n` placeholders
 * replace `?`, `CURRENT_TIMESTAMP` replaces `datetime('now')`.
 */

const { mapEmbeddingsRow, serializeVector } = require('../embeddingsShared');

module.exports = function createPostgresEmbeddingsRepository(executor) {
  async function get(nodeId) {
    const { rows } = await executor.query(
      'SELECT node_id, model_id, dim, vector, source, content_hash, updated_at FROM embeddings WHERE node_id = $1',
      [nodeId]
    );
    return rows.length > 0 ? mapEmbeddingsRow(rows[0]) : null;
  }

  async function getByNodeIds(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return [];
    const placeholders = nodeIds.map((_, idx) => `$${idx + 1}`).join(', ');
    const { rows } = await executor.query(
      `SELECT node_id, model_id, dim, vector, source, content_hash, updated_at
       FROM embeddings WHERE node_id IN (${placeholders}) ORDER BY node_id`,
      nodeIds
    );
    return rows.map(mapEmbeddingsRow);
  }

  async function upsert(nodeId, patch) {
    const vectorText = serializeVector(patch.vector);
    return executor.transaction(async () => {
      const result = await executor.run(
        `INSERT INTO embeddings (node_id, model_id, dim, vector, source, content_hash, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)
         ON CONFLICT(node_id) DO UPDATE SET
           model_id = excluded.model_id,
           dim = excluded.dim,
           vector = excluded.vector,
           source = excluded.source,
           content_hash = excluded.content_hash,
           updated_at = CURRENT_TIMESTAMP`,
        [nodeId, patch.modelId, patch.dim, vectorText, patch.source, patch.contentHash ?? null]
      );
      return { changes: result.changes };
    });
  }

  async function deleteNode(nodeId) {
    return executor.transaction(async () => {
      const result = await executor.run('DELETE FROM embeddings WHERE node_id = $1', [nodeId]);
      return { changes: result.changes };
    });
  }

  async function deleteMany(nodeIds) {
    if (!Array.isArray(nodeIds) || nodeIds.length === 0) return { changes: 0 };
    return executor.transaction(async () => {
      const placeholders = nodeIds.map((_, idx) => `$${idx + 1}`).join(', ');
      const result = await executor.run(
        `DELETE FROM embeddings WHERE node_id IN (${placeholders})`,
        nodeIds
      );
      return { changes: result.changes };
    });
  }

  async function listAll(modelId, opts = {}) {
    const { afterNodeId, limit } = opts;
    const params = [modelId];
    let where = 'WHERE model_id = $1';
    let orderBy = ' ORDER BY node_id';
    let limitClause = '';
    if (afterNodeId !== undefined && afterNodeId !== null) {
      params.push(afterNodeId);
      where += ` AND node_id > $${params.length}`;
    }
    if (limit !== undefined && limit !== null) {
      params.push(limit);
      limitClause = ` LIMIT $${params.length}`;
    }
    const { rows } = await executor.query(
      `SELECT node_id, model_id, dim, vector, source, content_hash, updated_at
       FROM embeddings ${where}${orderBy}${limitClause}`,
      params
    );
    return rows.map(mapEmbeddingsRow);
  }

  async function countByModel(modelId) {
    const { rows } = await executor.query(
      'SELECT COUNT(*) AS count FROM embeddings WHERE model_id = $1',
      [modelId]
    );
    return Number(rows[0].count);
  }

  return {
    dialect: 'postgres',
    get,
    getByNodeIds,
    upsert,
    delete: deleteNode,
    deleteMany,
    listAll,
    countByModel,
  };
};
