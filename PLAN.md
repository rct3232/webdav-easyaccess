# PLAN: Server Modularization & S3+PostgreSQL Architecture

## Objective

Phase 1–7 completed server modularization (domain-bounded modules, service layer, adapter pattern). Phase 8–16 introduces a fundamental architectural shift: PostgreSQL becomes the filesystem metadata layer (`file_nodes` + `object_map` + `filecache`), and S3 serves as a flat blob store addressed by opaque IDs. Existing WebDAV+PostgreSQL and WebDAV+SQLite backends remain supported with the unified schema; FsJSON mode is deprecated.

## Scope

- **In scope**: DB schema migration (new tables, path→node_id conversion), S3 blob adapter, core service layer (fileNodeService, blobStorageService, uploadService), files/sharing/permissions/recentFiles domain integration, GC + fail-safe mechanisms, legacy cleanup
- **Out of scope**: Client-side refactoring, Redis introduction, WebDAV→S3 data migration tooling (recorded as Future Work)

## Success Criteria

| Metric | Before (Phase 7) | Target After |
|--------|-----------------|--------------|
| Filesystem metadata source | WebDAV server (path-based) / FS JSON files | PostgreSQL `file_nodes` table (single source of truth) |
| Blob storage | WebDAV paths (`/user/doc.pdf`) | S3 opaque keys (`a1b2c3d4-...`) via `object_map` |
| Permission references | TEXT path strings (`folder_path`, `file_path`) | BIGINT `file_node_id` FK references + closure table |
| Share link targets | `file_path TEXT` | `file_node_id BIGINT → file_nodes.id` |
| Directory listing cost | O(n) remote HTTP (WebDAV PROPFIND / S3 ListObjects) | O(1) DB query (`WHERE parent_id = ?`) |
| Move/Rename cost | Blob copy + delete in storage | DB UPDATE only (`parent_id`, `name`) |
| FsJSON backend | Supported | **Deprecated** — PostgreSQL or SQLite only |

---

## Architecture Shift: Path-Based → Node-Based Filesystem

### Before (Phase 1–7)

```
WebDAV Server ────┐
                  ├──→ FileStoreAdapter ───→ fileService.js ───→ routes/
S3 (future)        │                         (path-based ops)
FsJSON metadata ───┘
                     MetadataAdapter
                   (users, permissions, shares as separate stores)
```

### After (Phase 8–16)

```
                    DB Schema (PostgreSQL / SQLite)
                    ╔═══════════════════════════════╗
                    ║ file_nodes    ← filesystem tree ║
                    ║ object_map    ← node → blob map ║
                    ║ filecache     ← metadata cache   ║
                    ║ node_ancestors← closure table    ║
                    ║ permissions_*  ← node_id refs    ║
                    ║ share_links    ← file_node_id FK ║
                    ╚═══════════════════════════════╝
                         ▲              ▲
                         │            S3 Bucket (flat)
                     WebDAV Server     (opaque blob keys)
                         │
             Service Layer (fileNodeService, blobStorageService, uploadService)
                         │
                    Domains (files, permissions, sharing, recentFiles, admin)
```

---

## Database Schema Design

### New Tables

#### `file_nodes` — Filesystem Tree (Inode Equivalent)

Single source of truth for filesystem structure in all backends. Directories exist only as DB rows; S3 remains flat.

```sql
CREATE TABLE file_nodes (
  id            BIGSERIAL PRIMARY KEY,
  parent_id     BIGINT REFERENCES file_nodes(id) ON DELETE CASCADE DEFAULT NULL,
  name          TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('file', 'directory')),
  sync_status   TEXT NOT NULL DEFAULT 'active'
                CHECK (sync_status IN ('active', 'pending_upload', 'orphaned_node')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT file_nodes_unique_name_per_parent UNIQUE (parent_id, name)
);

-- Root-level nodes (parent_id IS NULL) still need unique names
CREATE UNIQUE INDEX file_nodes_root_unique ON file_nodes (name) WHERE parent_id IS NULL;

-- Fast child listing
CREATE INDEX file_nodes_children_idx ON file_nodes (parent_id, created_at DESC);
```

**`sync_status` semantics:**
- `active`: DB row matches actual storage state
- `pending_upload`: Row created but blob not yet uploaded (upload flow step 2)
- `orphaned_node`: DB transaction succeeded but WebDAV/external file op failed; requires fail-safe recovery

#### `object_map` — File Node → Storage Blob Mapping

Separates filesystem hierarchy from physical storage. Enables multiple S3 endpoints and future version history.

```sql
CREATE TABLE object_map (
  id              BIGSERIAL PRIMARY KEY,
  file_node_id    BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  s3_key          TEXT DEFAULT NULL,           -- UUID for S3 mode; NULL for WebDAV mode
  storage_backend TEXT NOT NULL DEFAULT 's3'
                 CHECK (storage_backend IN ('s3', 'webdav')),
  version_number  INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending', 'active', 'orphaned')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT object_map_version_unique UNIQUE (file_node_id, version_number)
);

-- Fast active blob lookup
CREATE INDEX object_map_active_idx ON object_map (file_node_id, status) WHERE status = 'active';
```

**Lifecycle per file mutation:**
1. Upload new version → INSERT `object_map` (status=`pending`)
2. S3 PUT succeeds → UPDATE status=`active`; OLD row → status=`orphaned`
3. GC service periodically deletes orphaned rows + corresponding S3 blobs

Version history structure is in place (`version_number` column) but currently only one active version per node is maintained.

#### `filecache` — Metadata Cache

```sql
CREATE TABLE filecache (
  file_node_id    BIGINT PRIMARY KEY REFERENCES file_nodes(id) ON DELETE CASCADE,
  size            BIGINT NOT NULL DEFAULT 0,
  mime_type       TEXT DEFAULT NULL,
  content_hash    TEXT DEFAULT NULL,           -- SHA-256 of blob content; for dedup/future use
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Update policy:** Write on upload completion. Update on mutation event (overwrite). Delete via CASCADE when `file_nodes` row is deleted. No TTL-based invalidation.

#### `node_ancestors` — Closure Table for Permission Inheritance

Enables efficient ancestor queries without recursive CTEs at runtime. Maintained by triggers or application logic on node moves.

```sql
CREATE TABLE node_ancestors (
  ancestor_id     BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  descendant_id   BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  depth           INTEGER NOT NULL CHECK (depth >= 0),
  PRIMARY KEY (ancestor_id, descendant_id),

  CONSTRAINT node_ancestors_valid CHECK (depth >= 0)
);

-- Fast "all ancestors of X" query
CREATE INDEX node_ancestors_descendant_idx ON node_ancestors (descendant_id, depth);

-- Fast "all descendants of X" query (for bulk delete/move)
CREATE INDEX node_ancestors_ancestor_idx ON node_ancestors (ancestor_id, depth);
```

**Maintenance strategy:** Application-level cascade on `file_nodes` INSERT/DELETE/UPDATE(parent_id). Self-referential row (`depth=0`) included for every node. No DB triggers (SQLite trigger compatibility concerns).

### Modified Tables

#### `share_links` — Add `file_node_id` Reference

```sql
ALTER TABLE share_links ADD COLUMN file_node_id BIGINT REFERENCES file_nodes(id) ON DELETE CASCADE DEFAULT NULL;
-- Migrate: populate file_node_id from file_path, then drop file_path column in final phase
```

#### `permissions_user_paths` — Path → Node ID

```sql
-- New structure (replaces current path-based table)
CREATE TABLE permissions_user_paths_new (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT permissions_user_paths_unique UNIQUE (user_id, file_node_id),
  CONSTRAINT permissions_user_paths_folder_check CHECK (
    -- This permission is only on directory nodes; enforced at application level
    TRUE
  )
);
```

#### `permissions_user_files` — Path → Node ID

Same pattern as `permissions_user_paths`: replace `file_path TEXT` with `file_node_id BIGINT`.

#### `permissions_shares` — root_path → file_node_id

Replace `root_path TEXT` and `is_directory BOOLEAN` with `file_node_id BIGINT REFERENCES file_nodes(id)`.

#### `recent_files` — Path → Node ID

```sql
ALTER TABLE recent_files ADD COLUMN file_node_id BIGINT REFERENCES file_nodes(id) ON DELETE CASCADE DEFAULT NULL;
-- After migration: drop path, name columns (derivable from file_nodes)
```

### Schema Compatibility

| Backend | Schema Source | Notes |
|---------|---------------|-------|
| PostgreSQL | `002_s3_filesystem_schema.sql` (new DDL) | Primary target |
| SQLite | Auto-converted via `sqliteSchemaInit.js` | TYPE adjustments (BIGSERIAL→INTEGER, TIMESTAMPTZ→TEXT, etc.) |
| FsJSON | **Deprecated** — removed from supported backends | No JSON file fallback; DB required for `file_nodes` |

---

## Phases

### Phase 1–7: Server Modularization ✅ COMPLETE

Phases 0–7 have been completed. Summary of accomplishments:

| Phase | Domain | Key Outcome |
|-------|--------|-------------|
| 0 | Dead Code Cleanup | Removed orphaned `routes/auth.js` |
| 1 | RecentFiles | Extracted to `domains/recentFiles/`, service layer |
| 2 | Thumbnails + CacheAdapter | First adapter interface; thumbnail domain split |
| 3 | Auth | Token store, rate limiting via CacheAdapter |
| 4 | Sharing | Share links + public access separated |
| 5 | Permissions | ACL service, facade pattern, reverse dependency resolved |
| 6 | Files | FileStoreAdapter interface, 1552-line split, batch/download services |
| 7 | Admin + Infrastructure | MetadataAdapter trio (PG/SQLite/FsJSON), lockManager extraction |

**Phase 8–16 build upon this modular foundation.** Domain boundaries established in Phase 5–7 provide the integration points for node-based refactoring.

---

### Phase 8: Database Schema Migration — New Tables + DDL

**Dependencies:** None (foundation phase)
**Risk Level:** Medium — schema changes affect all backends; backward-compatible additions first

| Task | Description | Verify |
|------|-------------|--------|
| 8.1 | Create `store/postgresql/ddl/002_filesystem_tables.sql`: DDL for `file_nodes`, `object_map`, `filecache`, `node_ancestors` | SQL validates against PostgreSQL |
| 8.2 | Update `sqliteSchemaInit.js` converter to handle new table types (BIGINT FK, TIMESTAMPTZ) | SQLite schema initializes without error |
| 8.3 | Update `001_initial_normalized_schema.sql` or create migration: add `file_node_id` columns to existing tables (`share_links`, `permissions_*`, `recent_files`) with NULL default | Both old and new columns coexist |
| 8.4 | Create infrastructure/schema management utility: `applyPendingMigrations()` that runs unapplied DDL files in order; tracks applied migrations in `_schema_migrations` table | Migration tracker works idempotently |
| 8.5 | Update `.env.example`: add `WEA_FILE_STORAGE=s3\|webdav`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (optional, for MinIO) | Config documented |
| 8.6 | Remove FsJSON from `storage.js` backend resolver: supported backends are now `postgresql`, `sqlite`, `webdav`(metadata storage only). Add deprecation warning if `WEA_STORAGE_BACKEND=fs` is detected | FsJSON mode logs warning and falls back to SQLite |

---

### Phase 9: S3 Blob Store Adapter

**Dependencies:** Phase 8 (schema ready)
**Risk Level:** Medium — new dependency (`@aws-sdk/client-s3`); requires AWS credentials or MinIO for testing

| Task | Description | Verify |
|------|-------------|--------|
| 9.1 | Add `@aws-sdk/client-s3` to `server/package.json` dependencies | Module resolves |
| 9.2 | Create `infrastructure/adapters/blobstore/S3BlobStore.js`: implement `uploadBlob(key, buffer)`, `downloadBlob(key)`, `deleteBlob(key)`, `headBlob(key) → {contentLength, contentType}`, `listOrphanedKeys(olderThan)` | Unit tests pass with localstack/MinIO mock |
| 9.3 | Create `infrastructure/adapters/blobstore/index.js` factory: `createBlobStore(config)` returns S3BlobStore or no-op stub (for WebDAV-only mode) | Factory resolves correctly per config |
| 9.4 | Add `.env` config resolution in factory: read `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`; validate required keys present when `WEA_FILE_STORAGE=s3` | Missing config throws clear error at startup |
| 9.5 | Create test fixtures and mocks for S3 operations (Jest mock of `@aws-sdk/client-s3`) | Tests run without real AWS connection |

---

### Phase 10: Core Service Layer — fileNodeService, blobStorageService, uploadService

**Dependencies:** Phase 8 (schema), Phase 9 (S3 adapter)
**Risk Level:** High — central orchestration layer; all file operations flow through here

#### service/fileNodeService.js — Filesystem Tree Management

| Method | Purpose | DB Operation |
|--------|---------|-------------|
| `createFile(parentNodeId, name)` | Create file node | INSERT `file_nodes` (type='file') + `node_ancestors` cascade |
| `createDirectory(parentNodeId, name)` | Create directory node | INSERT `file_nodes` (type='directory') + `node_ancestors` cascade |
| `moveNode(nodeId, newParentId)` | Move to different folder | UPDATE `parent_id`; rebuild `node_ancestors` for subtree |
| `renameNode(nodeId, newName)` | Rename file/directory | UPDATE `name`; updated_at refresh |
| `deleteNode(nodeId)` | Delete file or directory tree | DELETE `file_nodes` CASCADE + descendant `node_ancestors` cleanup |
| `listDirectory(parentNodeId)` | List children of folder | SELECT WHERE parent_id=? ORDER BY name |
| `getNodePath(nodeId)` | Build path string from ancestors | Recursive ancestor join via `node_ancestors` |
| `resolvePath(pathString)` | Path → nodeId lookup | Sequential traversal through `file_nodes` by (parent_id, name) |
| `getDescendantIds(nodeId)` | All descendants of a directory | SELECT descendant_id FROM node_ancestors WHERE ancestor_id=? |

#### service/blobStorageService.js — Blob Lifecycle

| Method | Purpose | Storage Backend |
|--------|---------|----------------|
| `prepareUpload(fileNodeId)` | INSERT object_map (status='pending') → return s3_key | S3 mode only |
| `completeUpload(s3Key, size, mime)` | UPDATE filecache + object_map status='active' | S3 mode |
| `downloadBlob(fileNodeId)` | object_map lookup → S3 GET | S3 mode |
| `overwriteBlob(fileNodeId, buffer)` | OLD→orphaned, NEW pending→active, filecache UPDATE | S3 mode |
| `deleteBlob(fileNodeId)` | Mark object_map row orphaned for GC | S3 mode |

#### service/uploadService.js — Orchestration

```
uploadFile(parentNodeId, name, buffer, mimeType):
  1. BEGIN TX
  2. fileNodeService.createFile(parentId, name) → nodeId (sync_status='pending_upload')
  3. blobStorageService.prepareUpload(nodeId) → s3Key
  4. COMMIT
  5. S3 PUT blob(s3Key, buffer)          ← external, outside TX
  6. BEGIN TX
  7. filecache INSERT/UPDATE (nodeId, size, mime)
  8. object_map UPDATE status='active' WHERE s3Key=?
  9. file_nodes UPDATE sync_status='active', updated_at=NOW()
  10. COMMIT
```

| Task | Description | Verify |
|------|-------------|--------|
| 10.1 | Implement `fileNodeService` with all tree operations + closure table maintenance | Unit tests pass for create/move/rename/delete/list/resolvePath |
| 10.2 | Implement `blobStorageService` (S3 mode) with prepareUpload → completeUpload flow | S3 mock tests verify status transitions: pending→active |
| 10.3 | Implement `uploadService` orchestrating the 4-step upload flow | Integration test: upload file → verify DB + blob state |
| 10.4 | Implement WebDAV mode in services: `createFile` INSERTs `file_nodes` + WebDAV PUT; on failure, marks `sync_status='orphaned_node'` | Fail-safe test: simulate WebDAV error → orphaned status set |
| 10.5 | Ancestry maintenance helper: `_updateAncestors(nodeId)` rebuilds closure table rows for a node and its subtree | Closure table consistency verified after every mutation |

---

### Phase 11: Files Domain Integration

**Dependencies:** Phase 10 (services ready)
**Risk Level:** High — replaces current file operation flow; affects all file routes

| Task | Description | Verify |
|------|-------------|--------|
| 11.1 | Refactor `domains/files/services/fileService.js`: replace direct WebDAV calls with service layer (`fileNodeService` + storage-specific adapter) | File CRUD via new service works identically |
| 11.2 | Update `listDirectoryWithPermissions`: source children from `file_nodes` (DB query) instead of remote listing; enrich with permissions from node_id-based permission store | Response format matches existing API contract |
| 11.3 | Update upload flow: new files create `file_nodes` row + storage blob atomically (via uploadService) | Upload creates DB entry before blob write |
| 11.4 | Update download flow: resolve path→nodeId→object_map→S3 key or WebDAV path | Download returns same content as before |
| 11.5 | Update rename/move/delete: DB-only operations for metadata; storage adapter handles physical move (WebDAV) or no-op (S3, blob stays put) | Rename is instant DB update in S3 mode |
| 11.6 | Batch operations (copy/move/delete): adapt to node-based model — copy = new file_nodes row + new object_map entry referencing same s3_key; delete = recursive descendant removal via closure table | Bulk ops work on node IDs |
| 11.7 | Copy-on-write for S3 mode: copying a file creates new `file_nodes` + `object_map` pointing to the SAME `s3_key` (read-only share); mutation triggers actual blob copy | Two nodes, one blob, zero storage waste |
| 11.8 | Update routes (`crud.js`, `batch.js`, `preview.js`, `folders.js`) to use node_id internally while accepting/returning path strings in API (compatibility layer) | API responses unchanged |

---

### Phase 12: Permissions Domain → Node ID

**Dependencies:** Phase 10 (fileNodeService for ancestor queries), Phase 8 (schema ready)
**Risk Level:** High — largest behavioral change; permission checks called on every file access

| Task | Description | Verify |
|------|-------------|--------|
| 12.1 | Create new `permissions_user_paths` and `permissions_user_files` tables with `file_node_id` column (see schema above); keep old columns during transition period | Tables created, migration script populates new columns from paths |
| 12.2 | Refactor `domains/permissions/services/aclService.js`: replace path-based lookups (`checkPermissionSync(doc, path, action)`) with node_id-based queries using closure table for folder inheritance | Permission checks return same results as before |
| 12.3 | Folder permission check: query `node_ancestors` for all ancestors of target node → join with `permissions_user_paths` → find highest-rank match | Ancestor traversal via closure table, not string prefix matching |
| 12.4 | File permission check: direct lookup in `permissions_user_files` by `file_node_id`; if no match, fall back to folder ancestor check (same as 12.3) | File-level overrides work correctly |
| 12.5 | Permission grant/revoke: operate on node_ids; when granting on a folder, the closure table handles descendant coverage implicitly at query time (no fan-out INSERT needed) | Grant is O(1); check is O(ancestors) via closure table |
| 12.6 | Update `permissionFacade.js` and `permissionStore.js`: all external callers use node_id interface; path-based interface deprecated | Facade exposes both during transition, warns on path usage |
| 12.7 | Middleware `permissions.js`: update to resolve principal's access via node_id (requires path→node resolution from request URL) | Authenticated requests pass permission checks |

---

### Phase 13: Sharing & RecentFiles → Node ID

**Dependencies:** Phase 10 (fileNodeService), Phase 8 (schema)
**Risk Level:** Low — self-contained domains, minimal cross-dependencies

| Task | Description | Verify |
|------|-------------|--------|
| 13.1 | Update `share_links` table: add `file_node_id BIGINT`; new share links store node reference; existing shares retain path for backward compat during transition | Share creation works with both path and nodeId |
| 13.2 | Refactor `domains/sharing/services/shareLinkService.js`: create share → resolve path to nodeId → store nodeId; lookup share → use nodeId for permission checks via closure table | Shared access respects folder permissions via ancestor walk |
| 13.3 | Update `shareAccessService.js` (`collectPathsUnderSharePath`, etc.): replace path-prefix string matching with closure table descendant query (`SELECT descendant_id FROM node_ancestors WHERE ancestor_id = shareNode.id`) | Share scope resolution correct for nested structures |
| 13.4 | Update `recent_files` table: add `file_node_id`; new entries store nodeId; display name derived from `file_nodes.name` (not stored separately) | Recent files list resolves correctly even after file rename/move |
| 13.5 | Refactor `domains/recentFiles/service.js`: access tracking uses nodeId; path display resolved via `getNodePath(nodeId)` at render time (handles renames transparently) | Renamed files show updated names in recent list |

---

### Phase 14: Garbage Collection + Fail-Safe Recovery

**Dependencies:** Phase 10–13 (all services operational)
**Risk Level:** Low — background maintenance, no user-facing behavior change

| Task | Description | Verify |
|------|-------------|--------|
| 14.1 | Implement `gcService`: query `object_map` WHERE status='orphaned' AND created_at < threshold → call S3 deleteBlob for each → DELETE rows from object_map | Orphaned blobs cleaned up after configured interval |
| 14.2 | Add GC trigger: manual endpoint (`/api/admin/maintenance/gc`) + optional cron schedule (configurable via env `GC_INTERVAL_MS`, `GC_ORPHAN_TTL_DAYS`) | Admin can trigger GC on demand |
| 14.3 | Implement fail-safe recovery service: startup hook scans `file_nodes WHERE sync_status='orphaned_node'` → attempt retry or mark for manual review | Orphaned nodes detected and reported at startup |
| 14.4 | Add `/api/admin/maintenance/repair-sync`: admin endpoint to manually resolve orphaned nodes (retry delete, force-mark-active) | Admin can intervene on stuck nodes |
| 14.5 | Update `domains/admin/services/cleanupService.js`: integrate GC trigger and fail-safe reporting into existing cleanup interface | Cleanup endpoint covers new concerns |

---

### Phase 15: Legacy Path-Based Code Removal

**Dependencies:** Phases 10–14 (all new paths functional)
**Risk Level:** Medium — removing fallback code; irreversible without git

| Task | Description | Verify |
|------|-------------|--------|
| 15.1 | Drop `file_path` column from `share_links`; remove path-based share link lookup code | Shares work exclusively via node_id |
| 15.2 | Drop old `permissions_user_paths(folder_path)` and `permissions_user_files(file_path)` tables; all queries use new node_id versions | Permission checks pass via closure table only |
| 15.3 | Remove path-based branches from `recentFilesStore.js` (already migrated to MetadataAdapter in Phase 7) | Recent files resolve via nodeId |
| 15.4 | Delete `FsJsonMetadataAdapter.js` and all FsJSON-related code paths; remove 'fs' option from backend resolver | Backend config only accepts postgresql/sqlite |
| 15.5 | Remove path-based permission check helpers (`checkFolderPermission(path)`, `checkFilePermission(path)`); replace with node_id versions everywhere | No path-string permission checks remain |
| 15.6 | Clean up `store/permissionStore.js` (1290 lines → split into adapter-per-node queries): all backend branching now in MetadataAdapter; store file is thin wrapper | Store file ≤ 300 lines |

---

### Phase 16: Full Test Suite + Integration Verification

**Dependencies:** Phases 8–15 complete
**Risk Level:** Low — validation phase

| Task | Description | Verify |
|------|-------------|--------|
| 16.1 | S3+PostgreSQL integration tests: full upload→list→download→rename→move→delete lifecycle via MinIO test container | All operations succeed end-to-end |
| 16.2 | WebDAV+PostgreSQL integration tests: same lifecycle, verifying file_nodes sync + fail-safe recovery on simulated errors | Orphaned nodes detected and recoverable |
| 16.3 | Permission inheritance tests: grant folder permission → verify descendant access via closure table (depth 0, 1, N) | Ancestor permissions propagate correctly |
| 16.4 | Share link + permission interaction tests: shared node with folder-level restrictions → verify scope enforcement via closure table | Public share doesn't bypass folder locks |
| 16.5 | GC service tests: create→overwrite→delete sequence → verify orphaned blob cleanup after threshold | Orphan blobs deleted, active blobs preserved |
| 16.6 | SQLite compatibility tests: run full suite with `WEA_STORAGE_BACKEND=sqlite` | All tests pass on SQLite backend |
| 16.7 | Update `stryker.config.json`: add new service paths (`domains/files/services/*`, `infrastructure/adapters/blobstore/*`) to mutation scope | Mutation coverage includes new code |
| 16.8 | Run full CI suite: `npm run test:ci -w server` then `npm run test:ci -w client` | **Final gate — all pass** |

---

## Execution Order

```
Phase 0–7 (Modularization) ✅ COMPLETE
        ↓
Phase 8 (Schema Migration) ──────────────────────────────┐
                                                           ├→ Phase 9 (S3 Blob Store)
Phase 10 (Core Services) ← depends on 8 + 9              │
        ↓                                                  │
Phase 11 (Files Domain Integration)                        │
        ↓                                                  │
Phase 12 (Permissions → Node ID) ─────────┐                │
Phase 13 (Sharing & RecentFiles → Node)   │                │
                                           ├→ Phase 14     │
                                           │(GC + Fail-safe)│
                                           │       ↓        │
                                           │   Phase 15     │
                                           │ (Legacy Remove) │
                                           │       ↓         │
                                           └───▶ Phase 16 ◀──┘
                                               (Full Test Suite)
```

---

## Future Work

### Redis Introduction

Replace all in-memory Map instances with `RedisCacheAdapter` implementing the CacheAdapter interface defined in Phase 2. Targets: refresh tokens, login rate limiting, thumbnail cache, operation progress, WebDAV client cache, middleware user cache, permission existence index cache. No route or service code changes required — only adapter swap via environment configuration.

### Thumbnails Domain Consolidation

`/api/files/thumbnail/:hash` and `/api/files/thumbnails/batch` currently live in files domain but delegate to `domains/thumbnails/services/` via the `utils/thumbnail.js` shim. Migrate thumbnail endpoints into `domains/thumbnails/routes.js` under a single mount (`/api/thumbnails`) with batch generation, hash lookup, and extension-based serving consolidated. Remove `server/utils/thumbnail.js` shim after migration.

### Client-Side Modularization

- `FileManager.js` (927 lines): extract state into dedicated store modules, eliminate 500+ lines of prop bundling
- `useExplorerCommands.js` (689 lines): decompose into individual command hooks (upload, rename, delete, move/copy, download)
- Consider Zustand or lightweight state container for cross-component state

### WebDAV → S3 Data Migration Tooling

After S3+PostgreSQL mode is fully operational (Phase 16 complete), build a migration tool that:
1. Exports existing data from old instance DB (users, permissions as node_ids, share links, settings) to new instance DB
2. Iterates WebDAV directory tree → uploads each file to S3 → creates `file_nodes` + `object_map` entries in new DB
3. Validates migration: blob count match, permission integrity check, share link accessibility verification

---

## Execution Rules

1. **One phase at a time.** Phases 8–16 are strictly sequential with no parallel execution (each phase depends on the previous). Exception: Phase 12 and 13 may run in parallel if closure table and schema are stable after Phase 10.
2. **No net behavior change per public API.** Each phase must produce identical external behavior (same API responses, same error codes) for the current backend mode. New S3+PG mode is additive — existing WebDAV modes continue to work until Phase 15 cleanup.
3. **Commit per task.** Small commits with conventional commit messages referencing the phase and task number.
4. **Branch per phase.** Format: `refactor/phase-N-domainname`
5. **Docs first.** Update affected spec files in `docs/spec/server/` before implementation begins for each phase.
6. **Test files move with source.** When a source file is relocated to a new directory, its corresponding `__tests__/` file must be relocated in the same commit.
7. **Update `test-utils.js` imports per phase.** After each phase that restructures directories referenced by `server/test-utils.js`, update its import paths in the same commit.
8. **Test command reference.** Use `npm run test -w server` for full server test suite, `npm run test:unit -w server` for unit tests, `npm run test:integration -w server` for route tests.
9. **Test import paths**: Use `moduleNameMapper` in `jest.config.js` for `@server/*` and `@testing/*` aliases. Update all test imports to use aliases instead of fragile relative paths.
10. **Adapter isolation in service layer.** S3BlobStore, CacheAdapter, MetadataAdapter are internal implementation details. Service functions must not expose adapter types or storage-specific APIs to route handlers. Route handlers call only domain operations (uploadFile, listDirectory, etc.), never raw adapter methods.
11. **Synchronous upload flow.** The upload sequence (DB INSERT → S3 PUT → DB UPDATE) runs synchronously within a single request. No background job queue for uploads. Failure at any step leaves traceable state (`sync_status`, `object_map.status`) for recovery.
12. **FsJSON deprecation.** FsJSON backend is removed in Phase 15. All deployments must use PostgreSQL or SQLite. The `WEA_STORAGE_BACKEND=fs` option triggers a deprecation warning and falls back to SQLite if configured.
