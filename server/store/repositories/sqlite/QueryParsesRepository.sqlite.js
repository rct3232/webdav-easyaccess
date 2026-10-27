'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapQueryParseRow, serializePredicates } = require('../queryParsesShared');

/**
 * sqlite implementation of QueryParsesRepository (`?` placeholders).
 * `predicates` binds as the JSON string (JSONB → TEXT in the sqlite
 * conversion); the twins map it back to a parsed array at this boundary.
 * @param {import('../../../infrastructure/db/executor').DbExecutor} executor
 */
module.exports = function createSqliteQueryParsesRepository(executor) {
  return {
    dialect: 'sqlite',

    async get(normalizedQuery) {
      try {
        const { rows } = await executor.query(
          `SELECT normalized_query, predicates, vector, hit_count, created_at
             FROM query_parses WHERE normalized_query = ?`,
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
           VALUES (?, ?, ?)
           ON CONFLICT (normalized_query) DO UPDATE SET vector = excluded.vector`,
          [String(normalizedQuery), serializePredicates(predicates), vector ?? null]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async recordPredicates({ normalizedQuery, predicates }) {
      try {
        const result = await executor.run(
          `INSERT INTO query_parses (normalized_query, predicates)
           VALUES (?, ?)
           ON CONFLICT (normalized_query) DO UPDATE SET predicates = excluded.predicates`,
          [String(normalizedQuery), serializePredicates(predicates)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    async incrementHitCount(normalizedQuery) {
      try {
        const result = await executor.run(
          'UPDATE query_parses SET hit_count = hit_count + 1 WHERE normalized_query = ?',
          [String(normalizedQuery)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
