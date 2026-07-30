# Phase 0 Execution Plan: Database Schema Migration — Final State DDL

## Premise

Production runs on PostgreSQL with the current schema (old 001). All phases (0–8) will be completed against a **new instance**, then data is migrated in one shot via migration tooling, and finally deployed. No incremental ALTER-based migration of the live production database occurs.

**Implication:** The DDL represents only the target state. No dual columns, no ALTER statements, no backward-compatibility scaffolding at the schema level.

---

## Strategy: Single Final-State DDL File

The current `001_initial_normalized_schema.sql` is rewritten in place to contain ALL tables in their final form — including new filesystem tables and node_id-based references across all existing tables. No separate `002_*.sql` file exists. This eliminates ALTER fragmentation and provides a single source of truth for the schema.

---

## Table Definitions (Creation Order by FK Dependencies)

### Unchanged from current schema

| # | Table | Foreign Keys | Changes |
|---|-------|---------------|---------|
| 1 | `users` | none | None — identical to current definition |
| 2 | `settings` | none | None — identical |
| 13 | `locks` | none | None — identical |

### New tables

| # | Table | Foreign Keys | Purpose |
|---|-------|---------------|---------|
| 3 | `file_nodes` | self-ref (`parent_id → id`) | Filesystem tree (inode equivalent). Directories exist only as DB rows; S3 remains flat. |
| 4 | `object_map` | `file_node_id → file_nodes(id) ON DELETE CASCADE` | Node-to-blob mapping. Enables multiple storage backends and future version history. |
| 5 | `filecache` | `file_node_id → file_nodes(id) ON DELETE CASCADE` (PK is FK) | Metadata cache: size, mime_type, content_hash. Written on upload completion. |
| 6 | `node_ancestors` | `ancestor_id → file_nodes(id)`, `descendant_id → file_nodes(id)` (both ON DELETE CASCADE) | Closure table for permission inheritance and bulk descendant queries. Maintained by application-level `_updateAncestors(nodeId)` helper in Phase 2 — no DB triggers (SQLite compatibility). See PLAN.md §Phase 2, Task 2.5/2.6. |

### Rewritten tables (path columns removed, replaced with `file_node_id`)

| # | Table | Old Columns Removed | New Column(s) |
|---|-------|---------------------|---------------|
| 7 | `permissions_user_paths` | `folder_path TEXT NOT NULL` | `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Unique index on `(user_id, file_node_id)`. Directory-only constraint enforced at application level. |
| 8 | `permissions_user_files` | `file_path TEXT NOT NULL` | `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Unique index on `(user_id, file_node_id)`. |
| 9 | `permissions_shares` | `root_path TEXT`, `is_directory BOOLEAN` | `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Directory type derivable from `file_nodes.type`. |
| 10 | `share_links` | `file_path TEXT NOT NULL` | `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. |
| 11 | `recent_files` | `path TEXT`, `name TEXT`, `type TEXT` | `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Name derivable from `file_nodes.name`; type derivable from `file_nodes.type`. Unique index on `(user_id, file_node_id)`. |
| 12 | `permission_requests` | `folder_path TEXT`, `file_path TEXT`, `target_type TEXT` | `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Target type (folder vs file) derivable from `file_nodes.type`. Partial unique indexes rewritten to use `file_node_id` instead of path columns. |



## Detailed DDL Content

### `file_nodes`

```sql
CREATE TABLE file_nodes (
  id            BIGSERIAL PRIMARY KEY,
  parent_id     BIGINT DEFAULT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('file', 'directory')),
  sync_status   TEXT NOT NULL DEFAULT 'active'
                CHECK (sync_status IN ('active', 'pending_upload', 'orphaned_node')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT file_nodes_unique_name_per_parent UNIQUE (parent_id, name)
);

CREATE UNIQUE INDEX file_nodes_root_unique ON file_nodes (name) WHERE parent_id IS NULL;
CREATE INDEX file_nodes_children_idx ON file_nodes (parent_id, created_at DESC);
```

### `object_map`

```sql
CREATE TABLE object_map (
  id              BIGSERIAL PRIMARY KEY,
  file_node_id    BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  s3_key          TEXT DEFAULT NULL,
  storage_backend TEXT NOT NULL DEFAULT 's3' CHECK (storage_backend IN ('s3', 'webdav')),
  version_number  INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'orphaned')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT object_map_version_unique UNIQUE (file_node_id, version_number)
);

CREATE INDEX object_map_active_idx ON object_map (file_node_id, status) WHERE status = 'active';
```

### `filecache`

```sql
CREATE TABLE filecache (
  file_node_id    BIGINT PRIMARY KEY REFERENCES file_nodes(id) ON DELETE CASCADE,
  size            BIGINT NOT NULL DEFAULT 0,
  mime_type       TEXT DEFAULT NULL,
  content_hash    TEXT DEFAULT NULL,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### `node_ancestors`

```sql
CREATE TABLE node_ancestors (
  ancestor_id     BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  descendant_id   BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  depth           INTEGER NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (ancestor_id, descendant_id)
);

CREATE INDEX node_ancestors_descendant_idx ON node_ancestors (descendant_id, depth);
CREATE INDEX node_ancestors_ancestor_idx ON node_ancestors (ancestor_id, depth);
```

### Rewritten `permissions_user_paths`

```sql
CREATE TABLE permissions_user_paths (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT permissions_user_paths_unique UNIQUE (user_id, file_node_id)
);
```

### Rewritten `permissions_user_files`

```sql
CREATE TABLE permissions_user_files (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT permissions_user_files_unique UNIQUE (user_id, file_node_id)
);
```

### Rewritten `permissions_shares`

```sql
CREATE TABLE permissions_shares (
  token         TEXT PRIMARY KEY,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Rewritten `share_links`

```sql
CREATE TABLE share_links (
  token         TEXT PRIMARY KEY,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  created_by    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at    TIMESTAMPTZ NULL,
  download_count INTEGER NOT NULL DEFAULT 0 CHECK (download_count >= 0)
);

CREATE INDEX share_links_created_by_created_idx ON share_links (created_by, created_at DESC);
```

### Rewritten `recent_files`

```sql
CREATE TABLE recent_files (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT recent_files_user_node_uq UNIQUE (user_id, file_node_id)
);

CREATE INDEX recent_files_user_last_accessed_idx ON recent_files (user_id, last_accessed DESC);
```

### Rewritten `permission_requests`

```sql
CREATE TABLE permission_requests (
  id                    BIGSERIAL PRIMARY KEY,
  requester_id          BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  requester_username    TEXT NOT NULL,
  owner_id              BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_username        TEXT NOT NULL,
  file_node_id          BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  requested_permission  TEXT NOT NULL CHECK (requested_permission IN ('read', 'write')),
  status                TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  message               TEXT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at           TIMESTAMPTZ NULL,
  resolved_by           BIGINT NULL
);

CREATE UNIQUE INDEX permission_requests_pending_dedupe_uq
  ON permission_requests (requester_id, owner_id, requested_permission, file_node_id)
  WHERE status = 'pending';

CREATE INDEX permission_requests_owner_status_created_idx
  ON permission_requests (owner_id, status, created_at DESC);

CREATE INDEX permission_requests_requester_status_created_idx
  ON permission_requests (requester_id, status, created_at DESC);
```

---

## Task Dependency Graph

```
GATE: Must complete before any implementation task.
└── 0.0  Docs-First: Update/create affected spec documents (10 update + 2 create)

After 0.0 — Independent batch (launch concurrently):
├── 0.1  Rewrite DDL (001_initial_normalized_schema.sql)
├── 0.4  schemaManager.js — applyPendingMigrations() utility
└── 0.5  .env.example — change WEA_STORAGE_BACKEND default to postgresql; add S3 + WEA_FILE_STORAGE config

After 0.1:
└── 0.2  Update sqliteSchemaInit.js — glob-based DDL discovery, BIGINT conversion

After 0.2:
└── 0.10 Test sqliteSchemaInit.js — glob discovery order, convertPostgresToSqlite() type mapping fidelity

After 0.4:
└── 0.11 Test schemaManager — applyPendingMigrations() idempotency + checksum tracking

After 0.5:
├── 0.7  docker-compose.e2e.yml — add PostgreSQL-e2e + MinIO services
└── 0.8  .env.e2e — add S3+PG configuration block

Independent (any time, after 0.0):
├── 0.9  test-setup.js — default backend 'fs' → 'sqlite', env-overridable
│   └── Also refactor test-utils.js createTestDatabase() for SQLite isolation (Task 0.14)
└── 0.6  storage.js + metadata/index.js — FsJSON/webdav deprecation (RUN LAST)

After 0.6:
└── 0.12 Test getBackend() rejection — fs/webdav warn+fallback; postgresql/sqlite pass-through

Independent (after all implementation tasks):
└── 0.13 DDL smoke test — execute final DDL against PG + SQLite, assert table count + FK integrity
```

### Task Details

#### Task 0.0: Docs-First — Update/Create Spec Documents (GATE)

**Mandatory before any implementation task.** Per AGENTS.md §2.1, all affected spec documents must be updated before code changes begin.

##### A. Update existing `docs/spec/server/store/` specs

| File | Changes |
|------|---------|
| **storage.md** | ① `getBackend()` return type: `'webdav'\|'fs'\|'postgresql'` → `'postgresql'\|'sqlite'`. ② Remove FS/webdav method signatures (`ensureDir`, `readFile`, `writeFile`, `deletePath`, `listDir`, `webdavToFsPath`). ③ Test-mode default: `fs` → `sqlite`. ④ Verification Scenarios: remove webdav/FS scenarios; add deprecation warning + fallback tests. ⑤ Add `WEA_FILE_STORAGE` vs `WEA_STORAGE_BACKEND` distinction note (file content blob store is unaffected). |
| **permissionStore.md** | ① All method signatures: path parameters → `fileNodeId`. E.g., `grant(userId, folderPath, permission)` → `grant(userId, fileNodeId, permission)`. ② Remove "Storage Paths" section (JSON docs in webdav/fs are deprecated). ③ Rewrite "PostgreSQL v2 Table Mapping": replace `(user_id, folder_path, ...)` with `(user_id, file_node_id, ...)`. New table: `permissions_user_paths(user_id, file_node_id, permission, updated_at)`, `permissions_user_files(user_id, file_node_id, permission, updated_at)`, `permissions_shares(token, file_node_id, permission, updated_at)`. ④ Verification Scenarios: all path-based scenarios rewritten for node_id. |
| **shareLinkStore.md** | ① Method signatures unchanged (token-based), but link shape changes: `filePath` → `fileNodeId`. ② Remove "Storage Paths" section. ③ Rewrite Table Mapping: `(token, file_node_id, created_by, ...)` replacing `(token, file_path, ...)`. ④ Dependencies: remove storage/metaPaths; add PostgresqlMetadataAdapter/SqliteMetadataAdapter. |
| **recentFilesStore.md** | ① Method signatures: path-based parameters → `fileNodeId`. E.g., `addRecentFile(userId, {path, name, type})` → `addRecentFile(userId, fileNodeId)`. Name and type derivable from `file_nodes`. ② Remove "Storage Paths" section. ③ Rewrite Table Mapping: `(user_id, file_node_id, last_accessed)` replacing `(user_id, path, name, type, ...)`. ④ Dependencies: remove storage/metaPaths; add adapter-based store. |
| **permissionRequestStore.md** | ① Request shape: `folder_path`, `file_path`, `target_type` → single `file_node_id`. Target type derivable from `file_nodes.type`. ② Remove "Storage Paths" section. ③ Rewrite Table Mapping: add `file_node_id REFERENCES file_nodes(id) ON DELETE CASCADE`; remove path columns. ④ Dependencies: remove storage/metaPaths; add adapter-based store. |

##### B. Update existing `docs/spec/server/models/` specs

| File | Changes |
|------|---------|
| **Permission.md** | All method signatures with path parameters → node_id parameters. E.g., `grant(userId, folderPath, permission)` → `grant(userId, fileNodeId, permission)`. Remove any reference to JSON-doc storage paths. |
| **ShareLink.md** | `create(filePath, createdBy, expiresInDays?)` → `create(fileNodeId, createdBy, expiresInDays?)`. All downstream delegation updated accordingly. |

##### C. Deprecate `docs/spec/server/store/metaPaths.md`

Add deprecation notice at top of file:

```markdown
> **DEPRECATED** — FsJSON/webdav metadata storage removed in Phase 0.
> This module is no longer used by the application. The spec is retained for historical reference only.
> All WebDAV path constants and helpers are superseded by `file_nodes` table + node_id-based references.
```

##### D. Update existing feature docs

| File | Changes |
|------|---------|
| **features/files-sharing.md** | ① "Server-facing capabilities" section: all path-based API parameters → node_id where applicable. ② Batch move/recent files flow description updated for node_id references. ③ Permission grant/revoke endpoints updated to use `fileNodeId` instead of `folderPath`/`filePath`. ④ Recent files API: `POST /api/recent-files` body changes from `{path, name?, type?}` → `{fileNodeId}`. |
| **features/permissions.md** | ① ACL storage description: "stored under `/.wea` on WebDAV or local FS" → "stored in PostgreSQL/sqlite via normalized permission tables". ② Owner exception and policy rules unchanged (business logic remains the same). |

##### E. Create new spec files

| File | Content |
|------|---------|
| **docs/spec/server/store/fileNodesStore.md** | Role: Filesystem tree management via `file_nodes`, `object_map`, `filecache`, `node_ancestors`. Tables: `file_nodes` (inode equivalent, self-referencing FK), `object_map` (node-to-blob mapping, multi-backend + version history), `filecache` (size/mime_type/content_hash cache, PK is FK), `node_ancestors` (closure table for permission inheritance). Maintenance strategy: application-level cascade via `_updateAncestors(nodeId)` helper — no DB triggers (SQLite trigger compatibility). Self-referential `depth=0` row included for every node. Verification: tree operations (create/move/delete/rename) maintain closure table correctness; CASCADE deletes propagate properly. |
| **docs/spec/server/infrastructure/sqliteSchemaInit.md** | Role: DDL discovery + PostgreSQL→SQLite conversion for SQLite schema initialization. Methods: `initSqliteSchema()`, `convertPostgresToSqlite()`. Dependencies: glob-based DDL file discovery, `better-sqlite3`. Verification: table count matches PG, type mappings correct, FK enforcement works with `PRAGMA defer_foreign_keys = ON`. |
| **docs/spec/server/infrastructure/schemaManager.md** | Role: Pending migration detection + idempotent application across backends. Methods: `applyPendingMigrations(backend)`, `_schema_migrations` tracking table. Dependencies: glob DDL discovery, SHA-256 checksums, transaction support. Verification: idempotency, checksum-based file change detection, correct pending/already-applied classification. |

**Verification of Task 0.0:** All listed spec files exist and contain updated content reflecting the Phase 0 final state. No implementation task may begin until this is confirmed.

#### Task 0.1: Rewrite `001_initial_normalized_schema.sql`

**Input:** All DDL definitions above.  
**Output:** Single file at `server/store/postgresql/ddl/001_initial_normalized_schema.sql`.  
**Scope:** Replace entire file content with the final-state schema (all 13 tables).  
**Verification:** Validate against PostgreSQL 16 container:
```bash
docker run --rm -i postgres:16 psql -U postgres < server/store/postgresql/ddl/001_initial_normalized_schema.sql
```
See also Task 0.13 for automated DDL smoke test (table count, FK integrity on both PG and SQLite).

#### Task 0.2: Update `sqliteSchemaInit.js`

**Current state (line 8):** Hard-coded path to single DDL file.  
**Required changes:**
1. Replace `DDL_PATH` constant with glob-based discovery — read all `server/store/postgresql/ddl/*.sql` files sorted alphabetically, concatenate contents in order.
2. Add `\bBIGINT\b → INTEGER` conversion to `convertPostgresToSqlite()`. Must be placed **after** the `BIGSERIAL PRIMARY KEY` and standalone `BIGSERIAL` replacements to avoid partial match corruption (e.g., `BIGSERIAL` becoming `INTEGERER PRIMARY KEY AUTOINCREMENT`).
3. The existing conversions already handle all other new types:
   - `BIGSERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT` ✓
   - `TIMESTAMPTZ` → `TEXT` ✓
   - `CHECK` constraints pass through (SQLite supports them) ✓
   - Partial indexes (`WHERE ...`) pass through (SQLite 3.9.0+) ✓
   - Self-referencing FK: inline syntax (`parent_id BIGINT DEFAULT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`) works on both PostgreSQL and SQLite (with `PRAGMA defer_foreign_keys = ON`). No separate `ALTER TABLE` needed — a single CREATE TABLE per table suffices for both backends.

**Verification:** After running `initSqliteSchema()`, all tables exist with correct column types in an in-memory SQLite DB. Foreign keys enforced via `PRAGMA foreign_keys = ON`. Automated by Task 0.10 tests.

#### Task 0.4: Schema Manager (`server/infrastructure/schemaManager.js`)

**Design:**
```javascript
// _schema_migrations table (auto-created)
// filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), checksum TEXT NOT NULL

async function applyPendingMigrations(backend) {
  // 1. Create _schema_migrations if not exists
  // 2. Glob all ddl/*.sql files, sorted alphabetically
  // 3. For each file NOT in _schema_migrations:
  //    a. Read DDL content
  //    b. Compute SHA-256 checksum
  //    c. If sqlite: convertPostgresToSqlite()
  //    d. Execute statements in transaction
  //    e. INSERT into _schema_migrations { filename, applied_at, checksum }
}
```

**Key properties:** Idempotent (running twice produces no changes). Called during server startup from `storage.js` connection initialization. Automated by Task 0.11 tests.

#### Task 0.5: Update `.env.example`

**Note:** All variables in `.env.example` are commented out (`#`). New additions must also be commented.

Add after existing PostgreSQL block (Section 3, ~line 56):
```bash
# --- File Storage Mode: 's3' or 'webdav' (default: webdav) ---
# WEA_FILE_STORAGE=webdav

# S3 Configuration (required when WEA_FILE_STORAGE=s3)
# WEA_FILE_STORAGE is independent of WEA_STORAGE_BACKEND.
# WEA_STORAGE_BACKEND governs metadata (PostgreSQL/SQLite).
# WEA_FILE_STORAGE governs file content blob storage (S3/WebDAV).
# S3_BUCKET=your-bucket-name
# AWS_REGION=us-east-1
# AWS_ACCESS_KEY_ID=minioadmin
# AWS_SECRET_ACCESS_KEY=minioadmin
# S3_ENDPOINT=http://localhost:9000  # optional, for MinIO/compatible services
```

Also update Section 3 header comment from:
`# Storage backend: 'webdav' (default), 'fs' (local filesystem), 'postgresql', or 'sqlite'`
to:
`# Storage backend: 'postgresql' (default), 'sqlite', 'fs' (deprecated, falls back to sqlite), 'webdav' (deprecated, falls back to postgresql)`

#### Task 0.6: Deprecate FsJSON + webdav metadata in `storage.js` + metadata factory

**File:** `server/store/storage.js:21-29`  
**Change 1 — `getBackend()`:** When `'fs'` or `'webdav'` is detected, log deprecation warning and return `'sqlite'`. Remove `'webdav'` branch entirely; change default fallback from `'webdav'` to `'postgresql'`:
```javascript
if (forced === 'fs' || forced === 'filesystem') {
  console.warn('DEPRECATION: WEA_STORAGE_BACKEND=fs is deprecated. Falling back to sqlite.');
  return 'sqlite';
}
// Remove webdav branch; it now falls through to the unrecognized handler below
if (!['postgresql', 'sqlite'].includes(forced)) {
  console.warn(`DEPRECATION: WEA_STORAGE_BACKEND=${forced || '(default)'} is deprecated. Falling back to postgresql.`);
  return 'postgresql';
}
```

**Change 2 — Test-mode default:** Line 27, `return 'fs'` → `return 'sqlite'`.

**File:** `server/infrastructure/adapters/metadata/index.js`  
**Change:** Remove FsJson fallback branch. Throw on unrecognized backend:
```javascript
if (backend === 'postgresql') return require('./PostgresqlMetadataAdapter')();
if (backend === 'sqlite') return require('./SqliteMetadataAdapter')();
throw new Error(`Unsupported metadata backend: ${backend}`);
```

**Note:** This task runs **last** on the main agent because it modifies the live runtime code path. All other tasks can be validated before this one touches production behavior. Automated by Task 0.12 tests.

**Caution — `WEA_FILE_STORAGE` vs `WEA_STORAGE_BACKEND`:**
- `WEA_STORAGE_BACKEND` = metadata persistence layer (PostgreSQL/SQLite). This is what's being deprecated for `fs`/`webdav`.
- `WEA_FILE_STORAGE` = file content blob storage (S3/WebDAV). **Not implemented yet.** Planned for Phase 1. Completely independent of metadata backend.
- The `ensureDir`/`readFile`/`writeFile`/`deletePath`/`listDir` functions in `storage.js` are **metadata-only** — they operate on JSON files under `/.wea/`. They do NOT handle user file content (that's `utils/webdav.js` → `WebdavFileStoreAdapter`). These functions can be removed after Phase 7 when FsJSON is fully deleted.

#### Task 0.7: Update `docker-compose.e2e.yml`

Add two services alongside existing `webdav-test`:
```yaml
postgresql-e2e:
  image: postgres:16
  container_name: webdav-pg-e2e
  environment:
    POSTGRES_DB: webdav_e2e
    POSTGRES_USER: e2etest
    POSTGRES_PASSWORD: e2etest
  ports:
    - "5433:5432"
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U e2etest"]
    interval: 3s
    timeout: 2s
    retries: 10

minio-e2e:
  image: minio/minio:latest
  container_name: webdav-minio-e2e
  environment:
    MINIO_ROOT_USER: minioadmin
    MINIO_ROOT_PASSWORD: minioadmin
  command: server /data --console-address ":9001"
  ports:
    - "9010:9000"
    - "9011:9001"
  healthcheck:
    test: ["CMD", "mc", "ready", "local"]
    interval: 3s
    timeout: 2s
    retries: 10
```

#### Task 0.8: Update `.env.e2e`

Append to existing content:
```bash
WEA_FILE_STORAGE=s3
S3_BUCKET=e2e-test-bucket
AWS_ACCESS_KEY_ID=minioadmin
AWS_SECRET_ACCESS_KEY=minioadmin
S3_ENDPOINT=http://minio-e2e:9000
WEA_PG_HOST=postgresql-e2e
WEA_PG_PORT=5432
WEA_PG_DATABASE=webdav_e2e
WEA_PG_USER=e2etest
WEA_PG_PASSWORD=e2etest
```

#### Task 0.9: Update `server/test-setup.js`

**Scope:** Only `test-setup.js`. Does NOT touch `test-utils.js`.

**Current:** Hard-coded `process.env.WEA_STORAGE_BACKEND = 'fs';`  
**New:** `process.env.WEA_STORAGE_BACKEND = process.env.WEA_STORAGE_BACKEND || 'sqlite';`

Allows CI to override via environment variable; defaults to SQLite for in-process tests.

#### Task 0.10: Test `sqliteSchemaInit.js` (glob discovery + type conversion)

**File:** `server/infrastructure/__tests__/sqliteSchemaInit.test.js`  
**Test targets:**
- Glob-based DDL discovery reads all `ddl/*.sql` files in alphabetical order (mock 2+ files, verify concatenation order)
- `convertPostgresToSqlite()` type mapping fidelity:
  - `BIGSERIAL PRIMARY KEY` → `INTEGER PRIMARY KEY AUTOINCREMENT`
  - `\bBIGINT\b` → `INTEGER` (executed **after** BIGSERIAL replacement to avoid partial match corruption)
  - `TIMESTAMPTZ` → `TEXT`, `JSONB` → `TEXT`, `BOOLEAN` → `INTEGER`
  - `BEGIN;`/`COMMIT;` stripped; CHECK constraints and partial indexes (`WHERE ...`) pass through unchanged
- Converted SQL executes without error against in-memory SQLite DB

#### Task 0.11: Test `schemaManager.js` (applyPendingMigrations)

**File:** `server/infrastructure/__tests__/schemaManager.test.js`  
**Test targets:**
- `_schema_migrations` table auto-created if missing
- Pending migration detection: compare available DDL files vs applied records; only unapplied ones execute
- Idempotency: second call produces no SQL execution (mock query runner, assert zero calls)
- SHA-256 checksum recorded for each applied file

#### Task 0.12: Test `getBackend()` deprecation logic

**File:** `server/infrastructure/__tests__/storage.test.js` (modify existing)  
**Test targets:**
- `WEA_STORAGE_BACKEND=fs` → console.warn + return `'sqlite'`
- `WEA_STORAGE_BACKEND=webdav` → console.warn + return `'postgresql'`
- `WEA_STORAGE_BACKEND=postgresql` → pass through unchanged
- Empty/undefined value → default to `'postgresql'`
- Remove obsolete FS-backend test blocks (`ensureDir`, `readFile`, `writeFile`, `deletePath`, `listDir`)

#### Task 0.13: DDL Smoke Test (PostgreSQL + SQLite)

**File:** `server/store/__tests__/ddlValidation.test.js`  
**Prerequisite:** Create `server/store/__tests__/` directory if it doesn't exist (currently absent).  
**Test targets:**
- **SQLite path (always runs):** Execute converted DDL against file-based temp SQLite DB; assert 13 tables exist; verify FK constraints via `PRAGMA foreign_key_list(table)` for self-referencing `file_nodes.parent_id`; insert parent→child node pair, delete parent, assert CASCADE removes child
- **PostgreSQL path (Docker required):** Execute DDL against PG 16 container; same assertions as SQLite. Skip if Docker unavailable (`jest.skipIf(!process.env.DOCKER_AVAILABLE)`)

#### Task 0.14: Refactor `test-utils.js` for SQLite isolation

**Scope:** Only `test-utils.js`. Does NOT touch `test-setup.js`.

**File:** `server/test-utils.js`  
**Changes to `createTestDatabase()`:**
- Detect backend via `storage.getBackend()`; branch logic accordingly:
  - `'sqlite'`: generate `/tmp/wea-test-{uuid}.db`, set `WEA_SQLITE_PATH`, call `initMetadataStore()`. Return cleanup function that removes `.db` file and resets adapter cache.
  - `'postgresql'`: unchanged (use existing PG connection).
- Remove FS directory creation/cleanup logic entirely.
- **Critical:** Do NOT use shared in-memory DB (`:memory:`) — Jest parallel execution causes data races. Each test suite must have its own isolated file-based SQLite DB.
- After `jest.resetModules()`, force adapter cache reset by calling `createTestDatabase()` again so fresh SqliteMetadataAdapter instances are created.

**File:** `server/infrastructure/__tests__/storage.test.js`  
**Changes:** Remove describe blocks for FS-backend operations (no longer relevant after Task 0.6). Retain only postgresql infrastructure helper tests and sqlite integration paths.

---

## Execution Rules (from PLAN.md, applicable to Phase 0)

1. **Commit per task.** Small commits with conventional commit messages referencing phase and task number.
2. **Branch:** `refactor/phase-0-db-schema-migration` (to be created from `dev`).
3. **Docs first (mandatory).** Task 0.0 must complete before any implementation task begins. All affected spec documents in `docs/spec/server/` and `docs/features/` must be updated to reflect the final state. See [AGENTS.md §2.1](../../../../../AGENTS.md) for the docs-first workflow.
4. **Test command reference:** `npm run test -w server` for full suite, `npm run test:unit -w server` for unit tests.
5. **Test isolation per backend.** SQLite tests must use unique file-based DB paths (`/tmp/wea-test-{uuid}.db`). Shared in-memory DB (`:memory:`) is forbidden — Jest parallel execution causes data races.
6. **Module cache reset strategy.** After `jest.resetModules()`, re-call `createTestDatabase()` to initialize fresh adapter instances. Adapter caches must not persist across test boundaries.

## Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|-------------|
| Self-referencing FK syntax differs between PG and SQLite | Schema init fails on one backend | Task 0.13 smoke test validates both backends; inline syntax verified before commit |
| Spec documents not updated before implementation | Code changes drift from docs; future regressions | Task 0.0 GATE blocks all implementation tasks until confirmed complete |
| `sqliteSchemaInit.js` glob pattern misses files | New tables not created in SQLite mode | Task 0.10 tests verify file ordering + count assertion |
| FsJSON + webdav metadata deprecation breaks existing deployments | Users with `WEA_STORAGE_BACKEND=webdav` or `fs` get unexpected fallback | Graceful warning + SQLite/PostgreSQL fallback; migration script (`migrateMetadataToPostgresql.js`) available for one-shot transition |
| `createTestDatabase()` sqlite isolation failure | Parallel tests share state, CI flaky | Task 0.14: unique `.db` per suite + adapter cache reset on module reload |
| DDL smoke test requires Docker | Local dev without Docker cannot run full validation | SQLite path always runs; PG path skips gracefully via `jest.skipIf` |

## Existing Tests Requiring Modification

After Phase 0 implementation, the following existing tests must be updated to replace fs/webdav references with sqlite:

| Test File | Required Change | Related Task |
|---|---|---|
| `server/infrastructure/__tests__/storage.test.js` | Remove FS-backend describe blocks (`ensureDir`, `readFile`, etc.); retain postgresql helper tests | 0.12, 0.14 |
| `server/domains/sharing/__tests__/shareLinkStore.test.js` | Replace `createFsShareLinkStorageMock()` with sqlite mock; update "backend parity" test to compare sqlite vs postgresql | 0.12 |
| `server/domains/admin/routes/__tests__/admin.test.js:33` | Change `process.env.WEA_STORAGE_BACKEND = 'fs'` → `'sqlite'` | 0.9 |
| All tests using `createTestDatabase()` (27 files) | No code change needed if Task 0.14 properly refactors test-utils.js to be backend-aware | 0.14 |

---

## Architecture Notes

### `WEA_STORAGE_BACKEND` vs `WEA_FILE_STORAGE`

These two settings are **completely independent**:
- `WEA_STORAGE_BACKEND`: Metadata persistence (PostgreSQL/SQLite). Used by `storage.js:getBackend()`.
- `WEA_FILE_STORAGE`: File content blob storage (S3/WebDAV). Not yet implemented. Planned for Phase 1.

### `node_ancestors` maintenance strategy

Closure table is maintained at **application level** via `_updateAncestors(nodeId)` helper (Phase 2 Task 2.5/2.6). No DB triggers, due to SQLite trigger compatibility concerns. Self-referential `depth=0` row included for every node.

### `storage.js` functions removal timeline

`ensureDir`, `readFile`, `writeFile`, `deletePath`, `listDir` are **metadata-only** (operate on `/.wea/` JSON files). They are NOT used for file content storage. Removal path:
1. Phase 0 Task 0.6: Add deprecation warning + fallback to SQLite/PostgreSQL
2. Phase 7: Delete FsJSON adapter → all fs/webdav branches become dead code → remove functions entirely
