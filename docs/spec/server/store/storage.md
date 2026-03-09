# storage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Abstraction over metadata backends. Supports `webdav`, `fs`, and `postgresql` selection while preserving store-layer APIs. Provides file-style helpers for `webdav`/`fs` and PostgreSQL pool/transaction helpers for relational mode. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storage.js`
- **Test file:** `server/store/__tests__/storage.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| getBackend | () => 'webdav' \| 'fs' \| 'postgresql' | Resolved from `WEA_STORAGE_BACKEND`; `NODE_ENV=test` defaults to `fs` unless explicitly overridden |
| getFsBaseDir | () => string | WEA_FS_DIR or WEA_METADATA_DIR or os.tmpdir() |
| getPgPool | () => Pool | Returns PostgreSQL connection pool when backend is `postgresql` |
| withTransaction | (callback) => Promise\<T\> | Executes callback in single SQL transaction (begin/commit/rollback) |
| ensureDir | (dirPath) => Promise\<void\> | Create dir (recursive for fs; step-by-step for WebDAV) |
| ensureDirSafe | (dirPath) => Promise\<void\> | Exists check, create, retry on error |
| exists | (p) => Promise\<boolean\> | Path exists |
| readFile | (p) => Promise\<Buffer\> | Read file contents |
| writeFile | (p, data, options?) => Promise\<void\> | Write; overwrite, ifNoneMatchStar, contentType |
| deletePath | (p) => Promise\<void\> | Remove (recursive for fs) |
| listDir | (dirPath) => Promise\<Array\<{ basename, type }\>\> | List directory entries |

### 2.3 writeFile Options

- overwrite (default true), ifNoneMatchStar (412/409 on exists)
- contentType (default application/octet-stream)

### 2.4 Dependencies

- fs, fs/promises, os, path
- utils/webdav (createDirectory, deleteFile, getFileContents, listDirectory, pathExists, putFileContentsAdvanced)
- pg (Pool), backend-specific SQL helpers
- metaPaths.normalizeWebdavPath
- errorHandler (`createError`, `mapDatabaseError`), SERVER_ERROR_CODES

### 2.5 PostgreSQL Infrastructure Contract

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

### 2.6 PostgreSQL v2 Schema Contract

When backend is `postgresql`, storage connects to the normalized schema used by all store modules:
`users`, `settings`, `permissions_*`, `share_links`, `recent_files`, `permission_requests`, `locks`.

Canonical source for table definitions, constraints, and indexes:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

This spec intentionally does not duplicate full DDL text. Store modules consume this schema through
backend selector functions while keeping route-level contracts unchanged.

Permission contract source of truth for `postgresql` backend:

- Runtime: `shared/constants.js` (`PERMISSIONS.ALL`)
- Persistence: `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (`permissions_*` permission checks include `admin`)

### 2.7 Verification Scenarios

- [ ] getBackend: test env → fs; WEA_STORAGE_BACKEND=fs → fs
- [ ] getBackend: WEA_STORAGE_BACKEND=postgresql → postgresql
- [ ] backend parity: shared store-facing behaviors remain consistent across `fs` and `postgresql` for equivalent inputs (shape, ordering, not-found handling)
- [ ] getPgPool: missing env throws `storage.postgresqlNotConfigured`
- [ ] getPgPool: returns singleton pool across repeated calls
- [ ] withTransaction commits on success and rolls back on error
- [ ] withTransaction maps SQL errors with standardized DB error codes/status
- [ ] webdavToFsPath: path stays under base; invalid → 400
- [ ] ensureDir creates dirs; WebDAV MKCOL per segment
- [ ] writeFile ifNoneMatchStar → 412 when exists
- [ ] listDir returns { basename, type }[]
- [ ] writeFile throws on ENOSPC
- [ ] listDir throws on EACCES

### 2.8 Error Cases

- writeFile disk full (ENOSPC): throw; upper layer maps to 500
- WebDAV disconnection: adapter throws; upper layer retries or returns 500
- listDir permission denied (EACCES): throw; upper layer maps to 403
- PostgreSQL unique violation (`23505`): mapped to 409 `errorHandler.databaseConflict`
- PostgreSQL FK/check violations (`23503`/`23514`): mapped to 400 `errorHandler.databaseConstraintViolation`
- PostgreSQL unavailable/timeout (`57P01`/`53300`): mapped to 503 `errorHandler.databaseUnavailable`
