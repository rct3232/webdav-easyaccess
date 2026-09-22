'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const {
  serializeVector,
  mapEmbeddingRow,
  mapParentRow,
  normalizeTagSet,
} = require('../aiTagShared');

/**
 * sqlite implementation of AiTagRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteAiTagRepository(executor) {
  return {
    dialect: 'sqlite',

    async getTagVector(tag, modelId) {
      try {
        const { rows } = await executor.query(
          'SELECT * FROM tag_embeddings WHERE tag = ? AND model_id = ? LIMIT 1',
          [String(tag), Number(modelId)]
        );
        return rows[0] ? mapEmbeddingRow(rows[0]) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getTagVectors(tags, modelId) {
      if (!tags || tags.length === 0) return [];
      try {
        const placeholders = tags.map(() => '?').join(', ');
        const { rows } = await executor.query(
          `SELECT * FROM tag_embeddings WHERE model_id = ? AND tag IN (${placeholders})`,
          [Number(modelId), ...tags.map(String)]
        );
        return rows.map(mapEmbeddingRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async findTagsWithoutEmbedding(tags, modelId) {
      if (!tags || tags.length === 0) return [];
      try {
        const placeholders = tags.map(() => '?').join(', ');
        const { rows } = await executor.query(
          `SELECT tag FROM tag_embeddings WHERE model_id = ? AND tag IN (${placeholders})`,
          [Number(modelId), ...tags.map(String)]
        );
        const cached = new Set(rows.map((row) => String(row.tag)));
        return tags.filter((tag) => !cached.has(String(tag)));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertTagVector(tag, modelId, vector) {
      try {
        const result = await executor.run(
          `INSERT INTO tag_embeddings (tag, model_id, vector, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT (tag, model_id) DO UPDATE SET
             vector = excluded.vector,
             updated_at = excluded.updated_at`,
          [String(tag), Number(modelId), serializeVector(vector), new Date().toISOString()]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertTagVectors(tx, items, modelId) {
      const list = Array.isArray(items) ? items : [];
      if (list.length === 0) return { inserted: 0 };
      try {
        const tags = list.map((item) => String(item.tag));
        const placeholders = tags.map(() => '?').join(', ');
        const { rows } = await tx.query(
          `SELECT tag FROM tag_embeddings WHERE model_id = ? AND tag IN (${placeholders})`,
          [Number(modelId), ...tags]
        );
        const existing = new Set(rows.map((row) => String(row.tag)));

        const now = new Date().toISOString();
        for (const item of list) {
          await tx.run(
            `INSERT INTO tag_embeddings (tag, model_id, vector, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (tag, model_id) DO UPDATE SET
               vector = excluded.vector,
               updated_at = excluded.updated_at`,
            [String(item.tag), Number(modelId), serializeVector(item.vector), now]
          );
        }
        return { inserted: list.filter((item) => !existing.has(String(item.tag))).length };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteByModel(modelId) {
      try {
        const result = await executor.run('DELETE FROM tag_embeddings WHERE model_id = ?', [
          Number(modelId),
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async getParent(child) {
      try {
        const { rows } = await executor.query('SELECT * FROM tag_parents WHERE child = ? LIMIT 1', [
          String(child),
        ]);
        return rows[0] ? mapParentRow(rows[0]) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listParentHints() {
      try {
        const { rows } = await executor.query('SELECT * FROM tag_parents ORDER BY child');
        return rows.map(mapParentRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async upsertAutoParent(child, parent) {
      try {
        const result = await executor.run(
          `INSERT INTO tag_parents (child, parent, source, created_at)
           VALUES (?, ?, 'auto', ?)
           ON CONFLICT (child) DO UPDATE SET
             parent = excluded.parent,
             source = 'auto'
           WHERE tag_parents.source <> 'admin'`,
          [String(child), String(parent), new Date().toISOString()]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async setAdminParent(child, parent) {
      try {
        const result = await executor.run(
          `INSERT INTO tag_parents (child, parent, source, created_at)
           VALUES (?, ?, 'admin', ?)
           ON CONFLICT (child) DO UPDATE SET
             parent = excluded.parent,
             source = 'admin'`,
          [String(child), String(parent), new Date().toISOString()]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async deleteParent(child) {
      try {
        const result = await executor.run('DELETE FROM tag_parents WHERE child = ?', [
          String(child),
        ]);
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listRawTags(nodeId) {
      try {
        const { rows } = await executor.query(
          'SELECT tag FROM ai_tag_raw WHERE node_id = ? ORDER BY tag',
          [Number(nodeId)]
        );
        return rows.map((row) => String(row.tag));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async listNodeIdsByRawTag(tag) {
      try {
        const { rows } = await executor.query(
          'SELECT node_id FROM ai_tag_raw WHERE tag = ? ORDER BY node_id',
          [String(tag)]
        );
        return rows.map((row) => Number(row.node_id));
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async replaceRawTags(tx, nodeId, tags) {
      const set = normalizeTagSet(tags);
      try {
        await tx.run('DELETE FROM ai_tag_raw WHERE node_id = ?', [Number(nodeId)]);
        for (const tag of set) {
          await tx.run('INSERT INTO ai_tag_raw (node_id, tag) VALUES (?, ?)', [
            Number(nodeId),
            tag,
          ]);
        }
        return { inserted: set.length };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
