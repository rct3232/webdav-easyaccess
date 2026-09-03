# storage Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                          |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Abstraction over metadata backends. Supports `postgresql` and `sqlite` only (FsJSON `fs` and legacy `webdav` metadata backends were removed in Phase 7). Provides PostgreSQL pool/transaction helpers and SQLite connection/transaction helpers for relational mode. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storage.js`
- **Test file:** `server/infrastructure/__tests__/storage.test.js`

### 2.2 Main Methods

#### Backend Selection

| Method          | Signature                      | Description                                                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| getBackend      | () => 'postgresql' \| 'sqlite' | Resolved from `WEA_STORAGE_BACKEND`. Accepts aliases: `postgresql`/`postgres`/`pg` → `'postgresql'`; `sqlite` → `'sqlite'`; empty/undefined → `'sqlite'` (default). **Any other value throws a terminal `Error`** (e.g. removed `fs`/`filesystem`/`webdav`, or a typo) — the boot path (`runBoot().catch`) exits with `process.exit(1)`. No silent fallback (F6). |
| isSqliteBackend | () => boolean                  | Returns `true` if `getBackend() === 'sqlite'`                                                                                                                                                                                                                                                                                                                     |

#### PostgreSQL Helpers

| Method          | Signature                  | Description                                                         |
| --------------- | -------------------------- | ------------------------------------------------------------------- |
| getPgPool       | () => Pool                 | Returns PostgreSQL connection pool when backend is `postgresql`     |
| withTransaction | (callback) => Promise\<T\> | Executes callback in single SQL transaction (begin/commit/rollback) |
| closePgPool     | () => Promise\<void\>      | Close pool (for tests and process shutdown)                         |

#### SQLite Helpers

| Method                | Signature                  | Description                              |
| --------------------- | -------------------------- | ---------------------------------------- |
| getSqliteConnection   | () => Database             | Returns better-sqlite3 Database instance |
| withSqliteTransaction | (callback) => Promise\<T\> | Executes callback in SQLite transaction  |
| closeSqliteDb         | () => void                 | Close SQLite database                    |

#### Legacy Filesystem Helpers

**Removed in Phase 7:** `getFsBaseDir`, `webdavToFsPath`, `ensureDir`, `ensureDirSafe`, `exists`, `readFile`, `writeFile`, `deletePath`, `listDir` — FsJSON metadata support is removed; `storage.js` no longer exposes filesystem helpers.

### 2.3 Dependencies

- fs, path
- pg (Pool), backend-specific SQL helpers
- errorHandler (`createError`, `mapDatabaseError`), SERVER_ERROR_CODES

### 2.4 `WEA_STORAGE_BACKEND` vs `WEA_FILE_STORAGE`

These two environment variables are **completely independent**:

| Variable              | Purpose                    | Values                           | Handled By                |
| --------------------- | -------------------------- | -------------------------------- | ------------------------- |
| `WEA_STORAGE_BACKEND` | Metadata persistence layer | `sqlite` (default), `postgresql` | `storage.js:getBackend()` |
| `WEA_FILE_STORAGE`    | File content blob storage  | `s3` (default), `webdav`         | Phase 1 S3 adapter        |

`WEA_STORAGE_BACKEND` no longer accepts `fs` or `webdav` metadata values (removed in Phase 7); any unrecognized **non-empty** value is a terminal boot error (no silent `sqlite` fallback, F6). An unset/empty value defaults to `sqlite`. File content storage via `WEA_FILE_STORAGE=webdav` (WebDAV) or `WEA_FILE_STORAGE=s3` (S3) is unaffected.

**D6 boot rule:** the DB connection is `.env`-owned. When `WEA_STORAGE_BACKEND=postgresql`, the boot pre-flight (`runBoot`, `server/index.js`) requires `WEA_PG_HOST/PORT/DATABASE/USER/PASSWORD`; any missing key → `console.error('[config] … requires <keys> …')` + `process.exit(1)`. `resolvePgConfig`'s `storage.postgresqlNotConfigured` throw remains as a runtime guard.

### 2.4 PostgreSQL Infrastructure Contract

- Backend selector accepts `WEA_STORAGE_BACKEND=postgresql`.
- Pool configuration uses environment values:
  - `WEA_PG_HOST`, `WEA_PG_PORT`, `WEA_PG_DATABASE`, `WEA_PG_USER`, `WEA_PG_PASSWORD`
  - optional `WEA_PG_SSL` (`true`/`false`)
  - optional `WEA_PG_MAX`, `WEA_PG_IDLE_TIMEOUT_MS`, `WEA_PG_CONNECTION_TIMEOUT_MS`
  - optional `WEA_PG_QUERY_TIMEOUT_MS` (client-side pg `query_timeout`, default 60_000; `0` disables). Bounds every statement client-side so a mid-session DB drop (silent network partition) errors out instead of hanging the request indefinitely. Set `0` only for unusually long maintenance queries.
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

The schema is applied at startup: `server/store/bootstrap.js` `initMetadataStore()` calls `applyPendingMigrations('postgresql')` (see `docs/spec/server/infrastructure/schemaManager.md`) for the non-SQLite branch before `ensureDefaultAdmin()`. The DDL is intended for a **fresh empty database only** — a misconfigured app pointed at an existing/old DB must fail loudly at boot; no "already exists" tolerance is added.

This spec intentionally does not duplicate full DDL text. Store modules consume this schema through
backend selector functions while keeping route-level contracts unchanged.

Permission contract source of truth for `postgresql` backend:

- Runtime: `shared/constants.js` (`PERMISSIONS.ALL`)
- Persistence: `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (`permissions_*` permission checks include `admin`)

### 2.7 Verification Scenarios

- [ ] getBackend: WEA_STORAGE_BACKEND=postgresql → postgresql
- [ ] getBackend: WEA_STORAGE_BACKEND=fs → throws (fs removed in Phase 7)
- [ ] getBackend: WEA_STORAGE_BACKEND=webdav → throws
- [ ] getBackend: WEA_STORAGE_BACKEND= (empty) → sqlite (default)
- [ ] getBackend: WEA_STORAGE_BACKEND=postgres → postgresql (alias)
- [ ] getBackend: WEA_STORAGE_BACKEND=pg → postgresql (alias)
- [ ] getBackend: WEA_STORAGE_BACKEND=sqlite → sqlite
- [ ] backend parity: shared store-facing behaviors remain consistent across `sqlite` and `postgresql` for equivalent inputs (shape, ordering, not-found handling)
- [ ] getPgPool: missing env throws `storage.postgresqlNotConfigured`
- [ ] getPgPool: returns singleton pool across repeated calls
- [ ] withTransaction commits on success and rolls back on error
- [ ] withTransaction maps SQL errors with standardized DB error codes/status

### 2.7 Error Cases

- PostgreSQL unique violation (`23505`): mapped to 409 `errorHandler.databaseConflict`
- PostgreSQL FK/check violations (`23503`/`23514`): mapped to 400 `errorHandler.databaseConstraintViolation`
- PostgreSQL unavailable/timeout (`57P01`/`53300`), client `query_timeout` expiry ("Query read timeout"), and reachability/system errors (`ECONNREFUSED`/`ENOTFOUND`/`EAI_AGAIN`/`ETIMEDOUT`/`ECONNRESET`): mapped to 503 `errorHandler.databaseUnavailable`
- PostgreSQL auth failures (`28P01`/`28000`): mapped to 503 `errorHandler.databaseUnavailable`
