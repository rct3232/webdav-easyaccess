'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapQueryParseRow } = require('../queryParsesShared');

/**
 * postgres implementation of QueryParsesRepository (`$n` placeholders).
 * `predicates` binds with an explicit `::jsonb` cast; the pg driver returns
 * JSONB already parsed, so the twin consumes it as an array directly.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createPostgresQueryParsesRepository(executor) {
  return {
    dialect: 'postgres',

    async get(normalizedQuery) {
      try {
        const { rows } = await executor.query(
          `SELECT normalized_query, predicates, vector, hit_count, created_at
             FROM query_parses WHERE normalized_query = $1`,
          [String(normalizedQuery)]
        );
        return rows[0] ? mapQueryParseRow(rows[0]) : null;
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async recordEmbedding({ normalizedQuery, vector, predicates = [] }) {
      try {
        const result = await executor.run(
          `INSERT INTO query_parses (normalized_query, predicates, vector)
           VALUES ($1, $2::jsonb, $3)
           ON CONFLICT (normalized_query) DO UPDATE SET vector = excluded.vector`,
          [
            String(normalizedQuery),
            JSON.stringify(Array.isArray(predicates) ? predicates : []),
            vector ?? null,
          ]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async incrementHitCount(normalizedQuery) {
      try {
        const result = await executor.run(
          'UPDATE query_parses SET hit_count = hit_count + 1 WHERE normalized_query = $1',
          [String(normalizedQuery)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
