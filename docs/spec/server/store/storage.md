# storage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Abstraction over metadata backends. Supports `postgresql` and `sqlite`. `fs` and `webdav` are deprecated (fall back to sqlite/postgresql respectively). Provides PostgreSQL pool/transaction helpers and SQLite connection/transaction helpers for relational mode. Also provides legacy filesystem helpers (`ensureDir`, `readFile`, `writeFile`, `deletePath`, `listDir`) for FsJSON metadata — these are deprecated and will be removed in Phase 7. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storage.js`
- **Test file:** `server/infrastructure/__tests__/storage.test.js`

### 2.2 Main Methods

#### Backend Selection

| Method | Signature | Description |
|--------|-----------|-------------|
| getBackend | () => 'postgresql' \| 'sqlite' | Resolved from `WEA_STORAGE_BACKEND`. Accepts aliases: `postgresql`/`postgres`/`pg` → `'postgresql'`; `sqlite` → `'sqlite'`; `fs`/`filesystem` → warns + returns `'sqlite'`; `webdav` or any other value → warns + returns `'postgresql'`; empty/undefined → warns + returns `'postgresql'` (default) |
| isSqliteBackend | () => boolean | Returns `true` if `getBackend() === 'sqlite'` |

#### PostgreSQL Helpers

| Method | Signature | Description |
|--------|-----------|-------------|
| getPgPool | () => Pool | Returns PostgreSQL connection pool when backend is `postgresql` |
| withTransaction | (callback) => Promise\<T\> | Executes callback in single SQL transaction (begin/commit/rollback) |
| closePgPool | () => Promise\<void\> | Close pool (for tests and process shutdown) |

#### SQLite Helpers

| Method | Signature | Description |
|--------|-----------|-------------|
| getSqliteConnection | () => Database | Returns better-sqlite3 Database instance |
| withSqliteTransaction | (callback) => Promise\<T\> | Executes callback in SQLite transaction |
| closeSqliteDb | () => void | Close SQLite database |

#### Legacy Filesystem Helpers (deprecated — Phase 7 removal target)

| Method | Signature | Description |
|--------|-----------|-------------|
| getFsBaseDir | () => string | WEA_FS_DIR or WEA_METADATA_DIR or os.tmpdir() |
| ensureDir | (dirPath) => Promise\<void\> | Create directory recursively |
| ensureDirSafe | (dirPath) => Promise\<void\> | Create directory with safe path validation |
| exists | (filePath) => Promise\<boolean\> | Check if path exists |
| readFile | (filePath) => Promise\<Buffer\> | Read file contents |
| writeFile | (filePath, data) => Promise\<void\> | Write file contents |
| deletePath | (targetPath) => Promise\<void\> | Delete file or directory |
| listDir | (dirPath) => Promise\<Array\> | List directory contents |

### 2.3 Dependencies

- fs, fs/promises, os, path
- pg (Pool), backend-specific SQL helpers
- errorHandler (`createError`, `mapDatabaseError`), SERVER_ERROR_CODES

### 2.4 `WEA_STORAGE_BACKEND` vs `WEA_FILE_STORAGE`

These two environment variables are **completely independent**:

| Variable | Purpose | Values | Handled By |
|----------|---------|--------|------------|
| `WEA_STORAGE_BACKEND` | Metadata persistence layer | `postgresql` (default), `sqlite`, `fs` (deprecated), `webdav` (deprecated) | `storage.js:getBackend()` |
| `WEA_FILE_STORAGE` | File content blob storage | `s3`, `webdav` (default) | Phase 1 S3 adapter (not yet implemented) |

Deprecating `WEA_STORAGE_BACKEND=fs` or `webdav` only affects the metadata layer. File content storage via `WEA_FILE_STORAGE=webdav` (WebDAV) or `WEA_FILE_STORAGE=s3` (S3) is unaffected.

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

### 2.7 Verification Scenarios

- [ ] getBackend: WEA_STORAGE_BACKEND=postgresql → postgresql
- [ ] getBackend: WEA_STORAGE_BACKEND=fs → warns + returns sqlite
- [ ] getBackend: WEA_STORAGE_BACKEND=webdav → warns + returns postgresql
- [ ] getBackend: WEA_STORAGE_BACKEND= (empty) → warns + returns postgresql (default)
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
- PostgreSQL unavailable/timeout (`57P01`/`53300`): mapped to 503 `errorHandler.databaseUnavailable`
