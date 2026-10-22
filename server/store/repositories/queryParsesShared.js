'use strict';

/**
 * Shared mapping helpers for the `query_parses` twins (searchService.md
 * §2.3 step 4 — the query-embed cache). The JSONB column is mapped at the
 * repository boundary: sqlite stores the JSON string, postgres binds JSON —
 * every twin returns `predicates` as a PARSED array.
 */

/** Column-name → domain-field mapping shared verbatim by both dialects. */
function mapQueryParseRow(row) {
  let predicates = row.predicates;
  if (typeof predicates === 'string') {
    try {
      predicates = JSON.parse(predicates);
    } catch {
      predicates = [];
    }
  }
  if (!Array.isArray(predicates)) predicates = [];
  // Boundary normalization (§6 — SQL → domain objects): the driver timestamp
  // (pg Date / sqlite TEXT) maps to an ISO string in BOTH twins.
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null);
  return {
    normalizedQuery: String(row.normalized_query),
    predicates,
    vector: row.vector ?? null,
    hitCount: Number(row.hit_count ?? 0),
    createdAt,
  };
}

/** Predicates are bound as JSON text on sqlite and `::jsonb` on postgres. */
function serializePredicates(predicates) {
  return JSON.stringify(Array.isArray(predicates) ? predicates : []);
}

module.exports = { mapQueryParseRow, serializePredicates };
