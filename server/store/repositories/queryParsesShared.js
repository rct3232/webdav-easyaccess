'use strict';

/**
 * Shared mapping helpers for the `query_parses` twins (searchService.md
 * §2.3 step 4 / §2.8 — the query-embed cache + the NL-parse predicate cache).
 * The JSONB column is mapped at the repository boundary: sqlite stores the
 * JSON string, postgres binds JSON — both twins return the PARSED JSON VALUE
 * verbatim (parse envelope object or array; absent ⇒ `null`). A malformed
 * stored TEXT value is a SQLite raw-row/legacy case (postgres JSONB rejects
 * malformed input at write) and maps to `null`; the store is shape-agnostic,
 * validation lives in the search leg.
 */

/** Column-name → domain-field mapping shared verbatim by both dialects. */
function mapQueryParseRow(row) {
  let predicates = row.predicates;
  if (typeof predicates === 'string') {
    try {
      predicates = JSON.parse(predicates);
    } catch {
      predicates = null;
    }
  }
  // Boundary normalization (§6 — SQL → domain objects): the driver timestamp
  // (pg Date / sqlite TEXT) maps to an ISO string in BOTH twins.
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null);
  return {
    normalizedQuery: String(row.normalized_query),
    predicates: predicates ?? null,
    vector: row.vector ?? null,
    hitCount: Number(row.hit_count ?? 0),
    createdAt,
  };
}

/** Predicates are bound as JSON text on sqlite and `::jsonb` on postgres. */
function serializePredicates(predicates) {
  return JSON.stringify(predicates === undefined || predicates === null ? [] : predicates);
}

module.exports = { mapQueryParseRow, serializePredicates };
