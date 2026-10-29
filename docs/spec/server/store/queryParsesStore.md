# queryParsesStore Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | The query-embed cache owned by the search leg (`searchService.md` §2.3 step 4), extended with the NL-parse predicate-set cache (`predicates` — `searchService.md` §2.8). Get-or-embed keyed by the NORMALIZED query text; the primary key IS the normalized text (no separate cache table); the parse envelope shares the same row. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Facade:** `server/store/queryParsesStore.js`
- **Repository factory:** `server/store/repositories/QueryParsesRepository.js`
- **Shared mapping:** `server/store/repositories/queryParsesShared.js`
- **Twins:** `server/store/repositories/sqlite/QueryParsesRepository.sqlite.js`,
  `server/store/repositories/postgres/QueryParsesRepository.postgres.js`
- **Conformance test:** `server/store/repositories/__tests__/QueryParsesRepository.conformance.test.js`
  (sqlite default leg + real-PostgreSQL adapter leg)

### 2.2 Main Methods

| Method              | Signature                                                                    | Description                                                                                                                                                                                                        |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `get`               | `(normalizedQuery) => Promise<QueryParseRow \| null>`                        | Row lookup by the normalized text; unknown key ⇒ `null`.                                                                                                                                                           |
| `recordEmbedding`   | `({ normalizedQuery, vector, predicates? }) => Promise<{ changes: number }>` | INSERT … ON CONFLICT (normalized_query) DO UPDATE SET `vector = excluded.vector`; overwrites NOTHING else (`predicates` / `hit_count` / `created_at` untouched).                                                   |
| `recordPredicates`  | `({ normalizedQuery, predicates }) => Promise<{ changes: number }>`          | INSERT … ON CONFLICT (normalized_query) DO UPDATE SET `predicates = excluded.predicates`; overwrites NOTHING else (`vector` / `hit_count` / `created_at` untouched); inserts a parse-first row with NULL `vector`. |
| `incrementHitCount` | `(normalizedQuery) => Promise<{ changes: number }>`                          | Cache-hit accounting; `changes: 0` for an unknown key.                                                                                                                                                             |

The facade dispatches to the twin selected by `storage.getExecutor().dialect` and
contains no SQL.

### 2.3 Row Contract and Storage Paths

- **Table:** `query_parses(normalized_query PRIMARY KEY, predicates, vector, hit_count, created_at)`.
  DDL source of truth: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
  (sqlite conversion mirrors the same columns).
- **`QueryParseRow`:** `{ normalizedQuery: string, predicates: unknown, vector: string|null, hitCount: number, createdAt: string|null }`.
- **`vector` envelope:** the stored TEXT is the serialized `{ space, dim, v }` object —
  the query embedding plus the space identity it was produced in. The search leg
  validates the envelope: only a parseable envelope whose `space` equals the CURRENT
  space identity is a cache HIT. Any other shape or model space is a MISS: re-embed
  and overwrite `vector`. The store itself is shape-agnostic and returns the TEXT
  verbatim.
- **`predicates`:** the NL-parse cache (searchService.md §2.8). The parse leg writes the
  parse envelope `{ grammar: "nl1", atoms: [ …shared-grammar atoms… ], vectorQuery:
string|null }`; an embed-first row carries the `[]` default (= never parsed). The
  sqlite twin binds the JSON string, postgres binds the JSONB value; both twins return
  the PARSED JSON value verbatim at the repository boundary — object or array, exactly
  as stored (absent ⇒ `null`). A malformed stored string is a SQLite-only read case:
  PostgreSQL's JSONB column rejects malformed input at write time, so the postgres twin
  never observes it. The shared mapper still maps a malformed string to `null` for
  SQLite raw rows and legacy data. The store is shape-agnostic: envelope validation and
  cache-hit rules live in the search leg, never here.
- **`hit_count`:** incremented by exactly 1 per cache HIT and never by a write; a
  miss/re-embed leaves it unchanged.
- **`created_at`:** database-generated on insert and left unchanged on overwrite.
  Both twins normalize the driver value at the boundary: a postgres `Date` maps to
  `toISOString()`, sqlite TEXT passes through (a missing value maps to `null`), so
  consumers always receive an ISO-8601 string.

### 2.4 Transaction Boundaries

- `recordEmbedding` is one upsert statement (one implicit transaction).
- `recordPredicates` is one upsert statement (one implicit transaction).
- `incrementHitCount` is one UPDATE statement; the caller treats `changes: 0` as a
  lost race (the row was evicted between `get` and the increment) and re-embeds.

### 2.5 Dependencies

- `server/store/storage` (`getExecutor`, dialect dispatch)
- `server/utils/errorHandler` (`mapDatabaseError` at the twin boundary)
- Consumed by the search leg (`searchService.md` §2.3 step 4, §2.5, §2.8)

### 2.6 Verification Scenarios

- [ ] `get` on an unknown key → `null`.
- [ ] `recordEmbedding` inserts `vector` verbatim, `predicates` default `[]`, `hit_count` 0 and an ISO `created_at`.
- [ ] `predicates` round-trips as the parsed JSON value on both dialects: array default `[]`, parse-envelope object verbatim; a malformed stored string ⇒ `null` on the SQLite raw-row case (PostgreSQL JSONB rejects malformed input at write).
- [ ] Overwriting an existing key via `recordEmbedding` changes ONLY `vector` (same `predicates`, same `hit_count`, same `created_at` instant).
- [ ] `recordPredicates` writes ONLY `predicates` (existing row keeps its `vector` and `hit_count`; a parse-first insert leaves `vector` NULL).
- [ ] `incrementHitCount` bumps by exactly 1 per call and reports `changes: 0` for an unknown key.
- [ ] Normalized-text keys are byte-exact: distinct spellings are distinct rows; repeated writes keep one row per key (embed and parse writes share the ONE row).
