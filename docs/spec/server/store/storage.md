# storage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Abstraction over metadata backends. Supports `postgresql` and `sqlite`. `fs` and `webdav` are deprecated (fall back to sqlite/postgresql respectively). Provides PostgreSQL pool/transaction helpers for relational mode. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storage.js`
- **Test file:** `server/store/__tests__/storage.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| getBackend | () => 'postgresql' \| 'sqlite' | Resolved from `WEA_STORAGE_BACKEND`; when env is set to `fs`, warns and returns `sqlite`; when `webdav`, warns and returns `postgresql` |
| getFsBaseDir | () => string | WEA_FS_DIR or WEA_METADATA_DIR or os.tmpdir() |
| getPgPool | () => Pool | Returns PostgreSQL connection pool when backend is `postgresql` |
| withTransaction | (callback) => Promise\<T\> | Executes callback in single SQL transaction (begin/commit/rollback) |

### 2.3 Dependencies

- fs, fs/promises, os, path
- pg (Pool), backend-specific SQL helpers
- errorHandler (`createError`, `mapDatabaseError`), SERVER_ERROR_CODES

### 2.4 PostgreSQL Infrastructure Contract

- Backend selector accepts `WEA_STORAGE_BACKEND=postgresql`.
- Pool configuration uses environment values:
  - `WEA_PG_HOST`, `WEA_PG_PORT`, `WEA_PG_DATABASE`, `WEA_PG_USER`, `WEA_PG_PASSWORD`
  - optional `WEA_PG_SSL` (`true`/`false`)
  - optional `WEA_PG_MAX`, `WEA_PG_IDLE_TIMEOUT_MS`, `WEA_PG_CONNECTION_TIMEOUT_MS`
- `getPgPool()`:
  - throws standardized `storage.postgresqlNotConfigured` when required connection env is missing
  - returns singleton `pg.Pool` instance
- `withTransaction(callback)`:
  - runs `BEGIN`/`COMMIT`/`ROLLBACK` around callback
  - callback receives a query-capable client
  - SQL errors are converted by shared DB error mapping
- `closePgPool()` is provided for tests and process shutdown hooks.

### 2.5 PostgreSQL v2 Schema Contract

When backend is `postgresql`, storage connects to the normalized schema used by all store modules:
`users`, `settings`, `file_nodes`, `object_map`, `filecache`, `node_ancestors`, `permissions_*`, `share_links`, `recent_files`, `permission_requests`, `locks`.

Canonical source for table definitions, constraints, and indexes:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

This spec intentionally does not duplicate full DDL text. Store modules consume this schema through
backend selector functions while keeping route-level contracts unchanged.

Permission contract source of truth for `postgresql` backend:

- Runtime: `shared/constants.js` (`PERMISSIONS.ALL`)
- Persistence: `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (`permissions_*` permission checks include `admin`)

### 2.6 Verification Scenarios

- [ ] getBackend: WEA_STORAGE_BACKEND=postgresql → postgresql
- [ ] getBackend: WEA_STORAGE_BACKEND=fs → warns + returns sqlite
- [ ] getBackend: WEA_STORAGE_BACKEND=webdav → warns + returns postgresql
- [ ] backend parity: shared store-facing behaviors remain consistent across `sqlite` and `postgresql` for equivalent inputs (shape, ordering, not-found handling)
- [ ] getPgPool: missing env throws `storage.postgresqlNotConfigured`
- [ ] getPgPool: returns singleton pool across repeated calls
- [ ] withTransaction commits on success and rolls back on error
- [ ] withTransaction maps SQL errors with standardized DB error codes/status

### 2.7 Error Cases

- PostgreSQL unique violation (`23505`): mapped to 409 `errorHandler.databaseConflict`
- PostgreSQL FK/check violations (`23503`/`23514`): mapped to 400 `errorHandler.databaseConstraintViolation`
- PostgreSQL unavailable/timeout (`57P01`/`53300`): mapped to 503 `errorHandler.databaseUnavailable`
