'use strict';

/**
 * QueryParsesRepository — domain interface over the `query_parses` table
 * (docs/spec/server/services/searchService.md §2.3 step 4, §2.5, §2.8): the
 * query-embed cache + the NL-parse predicate cache owned by the search leg.
 * Get-or-embed keyed by the NORMALIZED TEXT — `normalized_query` is the
 * PRIMARY KEY (no separate cache table). `vector` holds the serialized
 * embedding envelope (TEXT, validated against the current space identity by
 * the caller); `predicates` holds the parse envelope written by the `parse.nl`
 * leg (mapped as the parsed JSON value at this boundary — shape-agnostic);
 * `hit_count` increments on embed-cache HITS only (never on writes).
 *
 * @typedef {Object} QueryParseRow
 * @property {string} normalizedQuery
 * @property {unknown} predicates parsed JSON value as stored (embed rows: the
 *   `[]` default; parse rows: the `{ grammar, atoms, vectorQuery }` envelope;
 *   absent ⇒ null; a malformed stored TEXT value — SQLite raw-row/legacy only,
 *   since postgres JSONB rejects malformed writes — also maps to null)
 * @property {string|null} vector
 * @property {number} hitCount
 * @property {string} createdAt
 *
 * @typedef {Object} QueryParsesRepository
 * @property {'sqlite'|'postgres'} dialect
 * @property {(normalizedQuery: string) => Promise<QueryParseRow|null>} get
 * @property {(opts: { normalizedQuery: string, vector: string|null, predicates?: Array }) => Promise<{ changes: number }>} recordEmbedding
 *   INSERT … ON CONFLICT (normalized_query) DO UPDATE SET vector = excluded.vector —
 *   the overwrite touches NOTHING else (predicates / hit_count / created_at untouched).
 * @property {(opts: { normalizedQuery: string, predicates: Object|Array }) => Promise<{ changes: number }>} recordPredicates
 *   INSERT … ON CONFLICT (normalized_query) DO UPDATE SET predicates = excluded.predicates —
 *   the overwrite touches NOTHING else (vector / hit_count / created_at untouched);
 *   a parse-first insert leaves vector NULL.
 * @property {(normalizedQuery: string) => Promise<{ changes: number }>} incrementHitCount
 *   Cache-hit accounting; `changes: 0` for an unknown key.
 *
 * @param {import('../../infrastructure/db/executor').DbExecutor} executor
 * @returns {QueryParsesRepository}
 */
module.exports = function createQueryParsesRepository(executor) {
  if (!executor || (executor.dialect !== 'sqlite' && executor.dialect !== 'postgres')) {
    throw new TypeError('createQueryParsesRepository requires a DbExecutor');
  }
  const impl =
    executor.dialect === 'sqlite'
      ? require('./sqlite/QueryParsesRepository.sqlite')
      : require('./postgres/QueryParsesRepository.postgres');
  return impl(executor);
};
