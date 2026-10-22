# queryParsesStore Spec

## 1. Overview

| Item | Description                                                                                                                                                                                        |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | The query-embed cache owned by the search leg (`searchService.md` §2.3 step 4). Get-or-embed keyed by the NORMALIZED query text; the primary key IS the normalized text (no separate cache table). |

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

| Method              | Signature                                                                    | Description                                                                                                                                       |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`               | `(normalizedQuery) => Promise<QueryParseRow \| null>`                        | Row lookup by the normalized text; unknown key ⇒ `null`.                                                                                          |
| `recordEmbedding`   | `({ normalizedQuery, vector, predicates? }) => Promise<{ changes: number }>` | INSERT … ON CONFLICT (normalized_query) DO UPDATE SET `vector = excluded.vector`; overwrites NOTHING else (`hit_count` / `created_at` untouched). |
| `incrementHitCount` | `(normalizedQuery) => Promise<{ changes: number }>`                          | Cache-hit accounting; `changes: 0` for an unknown key.                                                                                            |

The facade dispatches to the twin selected by `storage.getExecutor().dialect` and
contains no SQL.

### 2.3 Row Contract and Storage Paths

- **Table:** `query_parses(normalized_query PRIMARY KEY, predicates, vector, hit_count, created_at)`.
  DDL source of truth: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`
  (sqlite conversion mirrors the same columns).
- **`QueryParseRow`:** `{ normalizedQuery: string, predicates: Array, vector: string|null, hitCount: number, createdAt: string|null }`.
- **`vector` envelope:** the stored TEXT is the serialized `{ space, dim, v }` object —
  the query embedding plus the space identity it was produced in. The search leg
  validates the envelope: only a parseable envelope whose `space` equals the CURRENT
  space identity is a cache HIT. Any other shape or model space is a MISS: re-embed
  and overwrite `vector`. The store itself is shape-agnostic and returns the TEXT
  verbatim.
- **`predicates`:** reserved for NL-parse output. The sqlite twin binds the JSON
  string, postgres binds the JSONB value; both twins return a PARSED array at the
  repository boundary (malformed/absent ⇒ `[]`). The search leg stores `[]`.
- **`hit_count`:** incremented by exactly 1 per cache HIT and never by a write; a
  miss/re-embed leaves it unchanged.
- **`created_at`:** database-generated on insert and left unchanged on overwrite.
  Both twins normalize the driver value at the boundary: a postgres `Date` maps to
  `toISOString()`, sqlite TEXT passes through (a missing value maps to `null`), so
  consumers always receive an ISO-8601 string.

### 2.4 Transaction Boundaries

- `recordEmbedding` is one upsert statement (one implicit transaction).
- `incrementHitCount` is one UPDATE statement; the caller treats `changes: 0` as a
  lost race (the row was evicted between `get` and the increment) and re-embeds.

### 2.5 Dependencies

- `server/store/storage` (`getExecutor`, dialect dispatch)
- `server/utils/errorHandler` (`mapDatabaseError` at the twin boundary)
- Consumed by the search leg (`searchService.md` §2.3 step 4, §2.5)

### 2.6 Verification Scenarios

- [ ] `get` on an unknown key → `null`.
- [ ] `recordEmbedding` inserts `vector` verbatim, `predicates` default `[]`, `hit_count` 0 and an ISO `created_at`.
- [ ] `predicates` round-trip as a parsed array on both dialects.
- [ ] Overwriting an existing key changes ONLY `vector` (same `hit_count`, same `created_at` instant).
- [ ] `incrementHitCount` bumps by exactly 1 per call and reports `changes: 0` for an unknown key.
- [ ] Normalized-text keys are byte-exact: distinct spellings are distinct rows; repeated writes keep one row per key.
