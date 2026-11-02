'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { normalizeTagSet } = require('../aiTagShared');

/**
 * sqlite implementation of AiTagRepository (`?` placeholders).
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteAiTagRepository(executor) {
  return {
    dialect: 'sqlite',

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
