# PLAN: Server Modularization & S3+PostgreSQL Architecture

## Objective

Phase 0–8 introduces a fundamental architectural shift: PostgreSQL becomes the filesystem metadata layer (`file_nodes` + `object_map` + `filecache`), and S3 serves as a flat blob store addressed by opaque IDs. Existing WebDAV+PostgreSQL and WebDAV+SQLite backends remain supported with the unified schema; FsJSON mode is deprecated.

## Scope

- **In scope**: DB schema migration (new tables, path→node_id conversion), S3 blob adapter, core service layer (fileNodeService, blobStorageService, uploadService), files/sharing/permissions/recentFiles domain integration, GC + fail-safe mechanisms, legacy cleanup
- **Out of scope**: Client-side UI/layout changes, Redis introduction, WebDAV→S3 data migration tooling (recorded as Future Work). Client API consumer changes required by server schema migration are **in scope** and integrated into their respective phases.

## Success Criteria

| Metric | Before | Target After |
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

### Before

```
WebDAV Server ────┐
                   ├──→ FileStoreAdapter ───→ fileService.js ───→ routes/
S3 (future)        │                         (path-based ops)
FsJSON metadata ───┘
                     MetadataAdapter
                   (users, permissions, shares as separate stores)
```

### After (Phase 0–8)

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

#### `recent_files` — Path → Node ID + CASCADE delete

```sql
ALTER TABLE recent_files ADD COLUMN file_node_id BIGINT REFERENCES file_nodes(id) ON DELETE CASCADE DEFAULT NULL;

-- Replace unique index on (user_id, path) with (user_id, file_node_id)
CREATE UNIQUE INDEX IF NOT EXISTS recent_files_user_node_uq ON recent_files (user_id, file_node_id);

-- Migration: populate file_node_id FROM path via file_nodes join
-- Post-migration: DROP path, name columns (derivable from file_nodes.id → getNodePath / file_nodes.name)
```

**CASCADE semantics:** When `file_nodes` row is deleted, corresponding `recent_files` entry is auto-removed. This eliminates the need for manual `removePaths` calls in most deletion scenarios — only rename/move requires explicit recent files update (to refresh ordering).

### Schema Compatibility

| Backend | Schema Source | Notes |
|---------|---------------|-------|
| PostgreSQL | `002_s3_filesystem_schema.sql` (new DDL) | Primary target |
| SQLite | Auto-converted via `sqliteSchemaInit.js` | TYPE adjustments (BIGSERIAL→INTEGER, TIMESTAMPTZ→TEXT, etc.) |
| FsJSON | **Deprecated** — removed from supported backends | No JSON file fallback; DB required for `file_nodes` |

---

## Phases

### Phase 0: Database Schema Migration — New Tables + DDL

**Dependencies:** None (foundation phase)
**Risk Level:** Medium — schema changes affect all backends; backward-compatible additions first

| Task | Description | Verify |
|------|-------------|--------|
| 0.1 | Create `store/postgresql/ddl/002_filesystem_tables.sql`: DDL for `file_nodes`, `object_map`, `filecache`, `node_ancestors` | SQL validates against PostgreSQL |
| 0.2 | Update `sqliteSchemaInit.js` converter to handle new table types (BIGINT FK, TIMESTAMPTZ) | SQLite schema initializes without error |
| 0.3 | Update `001_initial_normalized_schema.sql` or create migration: add `file_node_id` columns to existing tables (`share_links`, `permissions_*`, `recent_files`) with NULL default | Both old and new columns coexist |
| 0.4 | Create infrastructure/schema management utility: `applyPendingMigrations()` that runs unapplied DDL files in order; tracks applied migrations in `_schema_migrations` table | Migration tracker works idempotently |
| 0.5 | Update `.env.example`: add `WEA_FILE_STORAGE=s3\|webdav`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (optional, for MinIO) | Config documented |
| 0.6 | Remove FsJSON from `storage.js` backend resolver: supported backends are now `postgresql`, `sqlite`, `webdav`(metadata storage only). Add deprecation warning if `WEA_STORAGE_BACKEND=fs` is detected | FsJSON mode logs warning and falls back to SQLite |
| 0.7 | Update `docker-compose.e2e.yml`: add PostgreSQL (`postgres:16`) + MinIO services alongside existing WebDAV service; configure health checks for all three containers | All containers start healthy in E2E environment |
| 0.8 | Update `.env.e2e`: add S3+PG configuration block (`S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT=http://minio-e2e:9000`, `WEA_PG_HOST=postgresql-e2e`) alongside existing WebDAV settings | Server starts with either backend based on env variable toggle |
| 0.9 | Update `server/test-setup.js`: make `WEA_STORAGE_BACKEND` configurable via env override instead of hardcoded `fs`; default to `sqlite` for in-process tests when no explicit backend is set | Tests run without FsJSON dependency; CI can switch backends via env |

---

### Phase 1: S3 Blob Store Adapter

**Dependencies:** Phase 0 (schema ready)
**Risk Level:** Medium — new dependency (`@aws-sdk/client-s3`); requires AWS credentials or MinIO for testing

| Task | Description | Verify |
|------|-------------|--------|
| 1.1 | Add `@aws-sdk/client-s3` to `server/package.json` dependencies | Module resolves |
| 1.2 | Create `infrastructure/adapters/blobstore/S3BlobStore.js`: implement `uploadBlob(key, buffer)`, `downloadBlob(key)`, `deleteBlob(key)`, `headBlob(key) → {contentLength, contentType}`, `listOrphanedKeys(olderThan)` | Unit tests pass with localstack/MinIO mock |
| 1.3 | Create `infrastructure/adapters/blobstore/index.js` factory: `createBlobStore(config)` returns S3BlobStore or no-op stub (for WebDAV-only mode) | Factory resolves correctly per config |
| 1.4 | Add `.env` config resolution in factory: read `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`; validate required keys present when `WEA_FILE_STORAGE=s3` | Missing config throws clear error at startup |
| 1.5 | Create test fixtures and mocks for S3 operations (Jest mock of `@aws-sdk/client-s3`) | Tests run without real AWS connection |
| 1.6 | Create `testing/mocks/s3Mock.js`: Jest factory that produces deterministic in-memory mock of `PutObjectCommand`, `GetObjectCommand`, `DeleteObjectCommand`, `HeadObjectCommand`; persists objects in a Map keyed by s3_key, deletable and inspectable from tests | Importable by any route/service test file; no real AWS connection required |

---

### Phase 2: Core Service Layer — fileNodeService, blobStorageService, uploadService

**Dependencies:** Phase 0 (schema), Phase 1 (S3 adapter)
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
| 2.1 | Implement `fileNodeService` with all tree operations + closure table maintenance | Unit tests pass for create/move/rename/delete/list/resolvePath |
| 2.2 | Implement `blobStorageService` (S3 mode) with prepareUpload → completeUpload flow | S3 mock tests verify status transitions: pending→active |
| 2.3 | Implement `uploadService` orchestrating the 4-step upload flow | Integration test: upload file → verify DB + blob state |
| 2.4 | Implement WebDAV mode in services: `createFile` INSERTs `file_nodes` + WebDAV PUT; on failure, marks `sync_status='orphaned_node'` | Fail-safe test: simulate WebDAV error → orphaned status set |
| 2.5 | Ancestry maintenance helper: `_updateAncestors(nodeId)` rebuilds closure table rows for a node and its subtree | Closure table consistency verified after every mutation |
| 2.6 | Create `service/__tests__/fileNodeService.test.js`: test create/move/rename/delete/list/resolvePath; verify `node_ancestors` correctness at depth 0, 1, N using in-memory SQLite | Closure table contains correct ancestor/descendant pairs after every mutation |
| 2.7 | Create `service/__tests__/blobStorageService.test.js`: test pending→active→orphaned lifecycle with S3 mock; verify filecache metadata updates on completeUpload | Status transitions verified; orphaned row count matches expected value |
| 2.8 | Create `service/__tests__/uploadService.test.js`: integration test of full 4-step upload flow (TX1 → S3 PUT → TX2) using real DB + s3Mock; simulate failure at each step to verify rollback and orphan detection | Each failure point leaves recoverable state (`sync_status`, `object_map.status`) |

---

### Phase 3: Files Domain Integration

**Dependencies:** Phase 2 (services ready)
**Risk Level:** High — replaces current file operation flow; affects all file routes

| Task | Description | Verify |
|------|-------------|--------|
| 3.1 | Refactor `domains/files/services/fileService.js`: replace direct WebDAV calls with service layer (`fileNodeService` + storage-specific adapter) | File CRUD via new service works identically |
| 3.2 | Update `listDirectoryWithPermissions`: source children from `file_nodes` (DB query) instead of remote listing; enrich with permissions from node_id-based permission store | Response format matches existing API contract |
| 3.3 | Update upload flow: new files create `file_nodes` row + storage blob atomically (via uploadService) | Upload creates DB entry before blob write |
| 3.4 | Update download flow: resolve path→nodeId→object_map→S3 key or WebDAV path | Download returns same content as before |
| 3.5 | Update rename/move/delete: DB-only operations for metadata; storage adapter handles physical move (WebDAV) or no-op (S3, blob stays put) | Rename is instant DB update in S3 mode |
| 3.6 | Batch operations (copy/move/delete): adapt to node-based model — copy = new file_nodes row + new object_map entry referencing same s3_key; delete = recursive descendant removal via closure table | Bulk ops work on node IDs |
| 3.7 | Copy-on-write for S3 mode: copying a file creates new `file_nodes` + `object_map` pointing to the SAME `s3_key` (read-only share); mutation triggers actual blob copy | Two nodes, one blob, zero storage waste |
| 3.8 | Update routes (`crud.js`, `batch.js`, `preview.js`, `folders.js`): accept `nodeId` in request payloads; return nodeId + display path in responses. No path-based compatibility layer — FsJSON is deprecated, all backends are DB-driven. | API accepts/returns nodeId; path strings are display-only |
| 3.9 | Update `domains/files/routes/__tests__/files.test.js`: replace WebDAV mock with fileNodeService + blobStorageService; assertions use nodeId-based payloads; run against SQLite-backed integration tests for full CRUD lifecycle | All route tests pass against DB backend (not FsJSON) |
| 3.10 | Update `server/test-utils.js`: add `createTestFileNode()`, `grantTestPermissionByNodeId()` helpers alongside existing path-based functions for nodeId-first testing | Test utilities support nodeId operations natively |

---

### Phase 4: Permissions Domain → Node ID

**Dependencies:** Phase 2 (fileNodeService for ancestor queries), Phase 0 (schema ready)
**Risk Level:** High — largest behavioral change; permission checks called on every file access

| Task | Description | Verify |
|------|-------------|--------|
| 4.1 | Create new `permissions_user_paths` and `permissions_user_files` tables with `file_node_id` column (see schema above); keep old columns during transition period | Tables created, migration script populates new columns from paths |
| 4.2 | Refactor `domains/permissions/services/aclService.js`: replace path-based lookups (`checkPermissionSync(doc, path, action)`) with node_id-based queries using closure table for folder inheritance | Permission checks return same results as before |
| 4.3 | Folder permission check: query `node_ancestors` for all ancestors of target node → join with `permissions_user_paths` → find highest-rank match | Ancestor traversal via closure table, not string prefix matching |
| 4.4 | File permission check: direct lookup in `permissions_user_files` by `file_node_id`; if no match, fall back to folder ancestor check (same as 4.3) | File-level overrides work correctly |
| 4.5 | Permission grant/revoke: operate on node_ids; when granting on a folder, the closure table handles descendant coverage implicitly at query time (no fan-out INSERT needed) | Grant is O(1); check is O(ancestors) via closure table |
| 4.6 | Update `permissionFacade.js` and `permissionStore.js`: all external callers use node_id interface | Facade accepts nodeId exclusively |
| 4.7 | Middleware `permissions.js`: update to resolve principal's access via node_id (requires path→node resolution from request URL) | Authenticated requests pass permission checks |
| 4.8 | **Client:** Refactor `permissionService.js`: grant/revoke/check payloads send `nodeId` instead of `folderPath`/`path`. Update query params and body fields across all permission endpoints (`/permissions/grant`, `/permissions/revoke`, `/permissions/check`, `/permissions/folder`) | Client sends nodeId in all permission API calls |
| 4.9 | **Client:** Refactor hooks/utilities that manage permission state: `useSharedManage.js`, `buildPermissionDiff.js`, `collectSubfolderPaths()` — replace path-string Maps with nodeId-based state; remove string prefix matching (`startsWith`) for ancestor checks | Permission state keyed by nodeId |
| 4.10 | Update `domains/permissions/routes/__tests__/permissions.test.js`: grant/revoke/check endpoints use nodeId payloads; add ancestor-inheritance tests (grant on folder → child/grandchild accessible via closure table at depth 0, 1, N) | Permission checks return correct results through closure table traversal |

---

### Phase 5: Sharing & RecentFiles → Node ID

**Dependencies:** Phase 2 (fileNodeService), Phase 0 (schema)
**Risk Level:** Medium — server-side is self-contained, but client-side changes touch multiple services and utilities across the sharing/recentFiles domain. No parallel execution with Phase 4 due to shared dependency on `fileNodeService`.

| Task | Description | Verify |
|------|-------------|--------|
| 5.1 | Update `share_links` table: add `file_node_id BIGINT`; all new share links use nodeId exclusively — no backward compatibility for paths | Share creation uses file_node_id only |
| 5.2 | Refactor `domains/sharing/services/shareLinkService.js`: create share → resolve path to nodeId → store nodeId; lookup share → use nodeId for permission checks via closure table | Shared access respects folder permissions via ancestor walk |
| 5.3 | Update `shareAccessService.js` (`collectPathsUnderSharePath`, etc.): replace path-prefix string matching with closure table descendant query (`SELECT descendant_id FROM node_ancestors WHERE ancestor_id = shareNode.id`) | Share scope resolution correct for nested structures |
| 5.4 | Update `recent_files` table: add `file_node_id`; new entries store nodeId; display name derived from `file_nodes.name` (not stored separately) | Recent files list resolves correctly even after file rename/move |
| 5.5 | Refactor `domains/recentFiles/service.js`: access tracking uses nodeId; path display resolved via `getNodePath(nodeId)` at render time (handles renames transparently) | Renamed files show updated names in recent list |
| 5.6 | **Client:** Refactor `recentFilesRepository`: API payloads send `fileNode_id` instead of `path`. Remove path-mutation helpers (`updateSubPathsOnPathChange`, `removeSubPathsOnFolderDelete`) from `client/src/utils/recentFiles.js` — nodeId references make them unnecessary (rename/move does not change the reference). | Recent entries survive renames automatically; no client-side path string manipulation |
| 5.7 | **Client:** Refactor `shareLinkService`: createShareLink sends `fileNode_id` instead of `filePath`. Update share link UI components (`ExternalShareSection`, `ShareFolderTree`) to use nodeId-based state. | Share links created via nodeId; no path-string payloads |

---

### Phase 6: Garbage Collection + Fail-Safe Recovery

**Dependencies:** Phase 2–5 (all services operational)
**Risk Level:** Low — background maintenance, no user-facing behavior change

| Task | Description | Verify |
|------|-------------|--------|
| 6.1 | Implement `gcService`: query `object_map` WHERE status='orphaned' AND created_at < threshold → call S3 deleteBlob for each → DELETE rows from object_map | Orphaned blobs cleaned up after configured interval |
| 6.2 | Add GC trigger: manual endpoint (`/api/admin/maintenance/gc`) + optional cron schedule (configurable via env `GC_INTERVAL_MS`, `GC_ORPHAN_TTL_DAYS`) | Admin can trigger GC on demand |
| 6.3 | Implement fail-safe recovery service: startup hook scans `file_nodes WHERE sync_status='orphaned_node'` → attempt retry or mark for manual review | Orphaned nodes detected and reported at startup |
| 6.4 | Add `/api/admin/maintenance/repair-sync`: admin endpoint to manually resolve orphaned nodes (retry delete, force-mark-active) | Admin can intervene on stuck nodes |
| 6.5 | Update `domains/admin/services/cleanupService.js`: integrate GC trigger and fail-safe reporting into existing cleanup interface | Cleanup endpoint covers new concerns |
| 6.6 | Create `service/__tests__/gcService.test.js`: seed object_map with orphaned rows + corresponding S3 mock entries; run GC; verify S3 deleteBlob called for orphans only, active blobs untouched | Orphan count drops to zero; active blob keys preserved in S3 mock store |

---

### Phase 7: Legacy Path-Based Code Removal

**Dependencies:** Phases 2–6 (all new paths functional)
**Risk Level:** Medium — removing fallback code; irreversible without git

| Task | Description | Verify |
|------|-------------|--------|
| 7.1 | Drop `file_path` column from `share_links`; remove path-based share link lookup code | Shares work exclusively via node_id |
| 7.2 | Drop old `permissions_user_paths(folder_path)` and `permissions_user_files(file_path)` tables; all queries use new node_id versions | Permission checks pass via closure table only |
| 7.3 | Remove path-based branches from `recentFilesStore.js` (already migrated to MetadataAdapter in Phase 6) | Recent files resolve via nodeId |
| 7.4 | Delete `FsJsonMetadataAdapter.js` and all FsJSON-related code paths; remove 'fs' option from backend resolver | Backend config only accepts postgresql/sqlite |
| 7.5 | Remove path-based permission check helpers (`checkFolderPermission(path)`, `checkFilePermission(path)`); replace with node_id versions everywhere | No path-string permission checks remain |
| 7.6 | Clean up `store/permissionStore.js` (1290 lines → split into adapter-per-node queries): all backend branching now in MetadataAdapter; store file is thin wrapper | Store file ≤ 300 lines |
| 7.7 | **Client:** Delete path-mutation helpers from `client/src/utils/recentFiles.js`: `updateSubPathsOnPathChange`, `removeSubPathsOnFolderDelete`, `removeMultiplePaths` — no longer needed with nodeId references | Zero imports of removed helpers across client codebase |
| 7.8 | **Client:** Remove path-string state management from permission utilities: delete path-based Maps in `buildPermissionDiff.js`; replace string prefix matching (`startsWith`) with nodeId ancestor queries via server API | Permission state uses nodeId exclusively; no path-string traversal remains |

---

### Phase 8: Full Test Suite + Integration Verification + E2E Expansion

**Dependencies:** Phases 0–7 complete
**Risk Level:** Low — validation phase

#### Server-Side Tests

| Task | Description | Verify |
|------|-------------|--------|
| 8.1 | S3+PostgreSQL integration tests: full upload→list→download→rename→move→delete lifecycle via MinIO test container | All operations succeed end-to-end |
| 8.2 | WebDAV+PostgreSQL integration tests: same lifecycle, verifying file_nodes sync + fail-safe recovery on simulated errors | Orphaned nodes detected and recoverable |
| 8.3 | Permission inheritance tests: grant folder permission → verify descendant access via closure table (depth 0, 1, N) | Ancestor permissions propagate correctly |
| 8.4 | Share link + permission interaction tests: shared node with folder-level restrictions → verify scope enforcement via closure table | Public share doesn't bypass folder locks |
| 8.5 | GC service end-to-end test: create→overwrite→delete sequence → verify orphaned blob cleanup after threshold | Orphan blobs deleted, active blobs preserved |
| 8.6 | SQLite compatibility tests: run full suite with `WEA_STORAGE_BACKEND=sqlite` | All tests pass on SQLite backend |
| 8.7 | Update `stryker.config.json`: add new service paths (`service/*`, `infrastructure/adapters/blobstore/*`) to mutation scope | Mutation coverage includes all new code |

#### E2E Test Strategy (Playwright)

After Phase 8 is complete, Playwright E2E tests run in both backend modes:

| Mode | Metadata Backend | Blob Storage | Docker Services | Purpose |
|------|-----------------|-------------|-----------------|---------|
| WebDAV+PG (Legacy) | PostgreSQL | WebDAV server | postgresql, webdav-test | Regression guard for existing behavior |
| S3+PG (New) | PostgreSQL | MinIO | postgresql-e2e, minio-e2e | New architecture validation |

**E2E Infrastructure Changes:**

1. `docker-compose.e2e.yml` — MinIO + PostgreSQL added in Phase 0 Task 0.7
2. `.env.e2e` — S3+PG configuration block added in Phase 0 Task 0.8; mode switching via `WEA_FILE_STORAGE` environment variable
3. `playwright.config.ts` — extend existing desktop/mobile projects with S3+PG mode as an environment matrix: the same spec files re-run against both backends to serve as a regression guard
4. `e2e/global-setup.ts` — add PostgreSQL seed (`file_nodes`, root directory per user) + MinIO bucket creation logic; mode selection via `E2E_BACKEND_MODE=s3|webdav` environment variable

**New E2E Scenarios (S3+PG only):**

| ID | Flow | Priority | Planned Spec |
|----|------|----------|--------------|
| E2E-S3PG-001 | Upload → list → download → content matches original file | P0 | `e2e/s3-pg-integration.spec.ts` |
| E2E-S3PG-002 | Rename is instant (DB-only, no blob copy) — verify sub-second completion | P0 | same |
| E2E-S3PG-003 | Move across folders — closure table updated, file accessible at new path | P1 | same |
| E2E-S3PG-004 | Copy-on-write: copy file → both reference same blob → overwrite one triggers actual S3 copy | P1 | same |
| E2E-S3PG-005 | Delete → orphaned object_map row → GC admin endpoint cleans up S3 blob | P1 | same |
| E2E-S3PG-006 | Permission inheritance: grant folder read → child/grandchild accessible via `__shared__` | P0 | extension of `e2e/share-internal.spec.ts` |
| E2E-S3PG-007 | Share link survives file rename (nodeId reference, not path string) | P1 | same |

**Impact on Existing E2E Scenarios:**

Auth, Explorer CRUD, Bulk ops, Share flows, MyPage — all existing scenarios have identical API contracts, so they re-run in S3+PG mode as a regression guard. No modifications needed.

#### Final Gate

| Task | Description | Verify |
|------|-------------|--------|
| 8.8 | Run full CI suite: `npm run test:ci -w server` then `npm run test:ci -w client` | **All pass on SQLite backend** |
| 8.9 | Run Playwright E2E in WebDAV+PG mode (existing regression baseline) | All existing specs pass |
| 8.10 | Run Playwright E2E in S3+PG mode (new architecture validation) | All specs + new E2E-S3PG-* scenarios pass |

---

## Execution Order

```
Phase 0 (Schema Migration) ───────────────────────────────┐
                                                           ├→ Phase 1 (S3 Blob Store)
Phase 2 (Core Services) ← depends on 0 + 1                 │
        ↓                                                   │
Phase 3 (Files Domain Integration)                          │
        ↓                                                   │
Phase 4 (Permissions → Node ID) ─────────┐                  │
Phase 5 (Sharing & RecentFiles → Node)   │                  │
                                          ├→ Phase 6        │
                                          │(GC + Fail-safe) │
                                          │       ↓         │
                                          │   Phase 7       │
                                          │(Legacy Remove)  │
                                          │       ↓          │
                                          └───▶ Phase 8 ◀───┘
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

After S3+PostgreSQL mode is fully operational (Phase 8 complete), build a migration tool that:
1. Exports existing data from old instance DB (users, permissions as node_ids, share links, settings) to new instance DB
2. Iterates WebDAV directory tree → uploads each file to S3 → creates `file_nodes` + `object_map` entries in new DB
3. Validates migration: blob count match, permission integrity check, share link accessibility verification

---

## Execution Rules

1. **One phase at a time.** Phases 0–8 are strictly sequential with no parallel execution (each phase depends on the previous). No exceptions — Phase 4/5 client-side changes share `fileNodeService` and cannot run concurrently.
2. **No net behavior change per public API.** Each phase must produce identical external behavior (same API responses, same error codes) for the current backend mode. New S3+PG mode is additive — existing WebDAV modes continue to work until Phase 7 cleanup.
3. **Commit per task.** Small commits with conventional commit messages referencing the phase and task number.
4. **Branch per phase.** Format: `refactor/phase-N-domainname`
5. **Docs first.** Update affected spec files in `docs/spec/server/` before implementation begins for each phase.
6. **Test files move with source.** When a source file is relocated to a new directory, its corresponding `__tests__/` file must be relocated in the same commit.
7. **Update `test-utils.js` imports per phase.** After each phase that restructures directories referenced by `server/test-utils.js`, update its import paths in the same commit.
8. **Test command reference.** Use `npm run test -w server` for full server test suite, `npm run test:unit -w server` for unit tests, `npm run test:integration -w server` for route tests.
9. **Test import paths**: Use `moduleNameMapper` in `jest.config.js` for `@server/*` and `@testing/*` aliases. Update all test imports to use aliases instead of fragile relative paths.
10. **Adapter isolation in service layer.** S3BlobStore, CacheAdapter, MetadataAdapter are internal implementation details. Service functions must not expose adapter types or storage-specific APIs to route handlers. Route handlers call only domain operations (uploadFile, listDirectory, etc.), never raw adapter methods.
11. **Synchronous upload flow.** The upload sequence (DB INSERT → S3 PUT → DB UPDATE) runs synchronously within a single request. No background job queue for uploads. Failure at any step leaves traceable state (`sync_status`, `object_map.status`) for recovery.
12. **FsJSON deprecation.** FsJSON backend is removed in Phase 7. All deployments must use PostgreSQL or SQLite. The `WEA_STORAGE_BACKEND=fs` option triggers a deprecation warning and falls back to SQLite if configured.
13. **No path compatibility layer.** FsJSON is deprecated; all deployments use SQLite/PostgreSQL. Server endpoints accept `nodeId` exclusively in request payloads — no transitional period accepting both `path` and `nodeId`. Client API consumers are updated simultaneously within the same phase (see Phase 4 tasks 4.8-4.9, Phase 5 tasks 5.6-5.7).
14. **Multi-backend test execution.** From Phase 8 onward, all server tests run against both SQLite and S3+PG backends. FsJSON backend tests are removed after Phase 7 cleanup. Test backend selection is controlled by `WEA_STORAGE_BACKEND` and `WEA_FILE_STORAGE` environment variables.
15. **E2E regression on new architecture.** Playwright E2E scenarios execute in both WebDAV+PG (legacy) and S3+PG (new) modes after Phase 8 Task 8.9-8.10. The `docker-compose.e2e.yml` orchestrates backend switching via environment variables; existing specs serve as regression guards without modification.
16. **Test data isolation per backend mode.** SQLite in-memory DB and MinIO buckets are initialized fresh by `global-setup.ts` for each test suite run and cleaned up by `global-teardown.ts`. No state sharing occurs between tests or backend modes.
