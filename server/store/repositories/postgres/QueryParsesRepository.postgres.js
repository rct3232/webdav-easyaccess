'use strict';

const { mapDatabaseError } = require('../../../utils/errorHandler');
const { mapQueryParseRow, serializePredicates } = require('../queryParsesShared');

/**
 * postgres implementation of QueryParsesRepository (`$n` placeholders).
 * `predicates` binds with an explicit `::jsonb` cast; the pg driver returns
 * JSONB already parsed, so the twin passes the stored value through at the
 * boundary (shape-agnostic — the search leg validates the parse envelope).
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
           VALUES ($1, $2::jsonb)
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
          'UPDATE query_parses SET hit_count = hit_count + 1 WHERE normalized_query = $1',
          [String(normalizedQuery)]
        );
        return { changes: result.changes };
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },

    /**
     * Bounded keyset scan for the search leg's restart replay-derivation
     * fallback (searchService.md §2.4/§2.9). Ascending by the primary key so
     * `afterNormalizedQuery` pages never skip/duplicate rows.
     */
    async listAll({ afterNormalizedQuery = null, limit = 500 } = {}) {
      const size =
        Number.isFinite(Number(limit)) && Number(limit) > 0 ? Math.floor(Number(limit)) : 500;
      try {
        const { rows } = await executor.query(
          `SELECT normalized_query, predicates, vector, hit_count, created_at
             FROM query_parses
            WHERE normalized_query > $1
            ORDER BY normalized_query ASC
            LIMIT $2`,
          [String(afterNormalizedQuery ?? ''), size]
        );
        return rows.map(mapQueryParseRow);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    },
  };
};
