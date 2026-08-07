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

### Final Tables

Big-bang strategy: the single DDL file (`001_initial_normalized_schema.sql`) is rewritten in place to contain all tables in their final state. No ALTER statements, no dual columns, no transition period. The migration tool (Future Work) handles path → node_id data translation at big-bang switch-over time.

#### `permissions_user_paths` — Final Definition

```sql
CREATE TABLE permissions_user_paths (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  permission    TEXT NOT NULL CHECK (permission IN ('read', 'write', 'admin')),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT permissions_user_paths_unique UNIQUE (user_id, file_node_id)
);
```

#### `permissions_user_files` — Final Definition

Replace `file_path TEXT` with `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Unique constraint on `(user_id, file_node_id)`.

#### `permissions_shares` — Final Definition

Replace `root_path TEXT` and `is_directory BOOLEAN` with `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`.

#### `share_links` — Final Definition

Replace `file_path TEXT NOT NULL` with `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`.

#### `recent_files` — Final Definition + CASCADE delete

```sql
CREATE TABLE recent_files (
  user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  file_node_id  BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT recent_files_user_node_uq UNIQUE (user_id, file_node_id)
);
```

**CASCADE semantics:** When `file_nodes` row is deleted, corresponding `recent_files` entry is auto-removed. This eliminates the need for manual `removePaths` calls in most deletion scenarios — only rename/move requires explicit recent files update (to refresh ordering).

#### `permission_requests` — Final Definition

Replace `(folder_path TEXT, file_path TEXT, target_type TEXT)` with single `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. Target type derivable from `file_nodes.type`. Partial unique indexes rewritten to use `file_node_id`.

### Schema Compatibility

| Backend | Schema Source | Notes |
|---------|---------------|-------|
| PostgreSQL | `001_initial_normalized_schema.sql` (rewritten) | Primary target — single final-state DDL |
| SQLite | Auto-converted via `sqliteSchemaInit.js` | TYPE adjustments (BIGSERIAL→INTEGER, TIMESTAMPTZ→TEXT, etc.) |
| FsJSON | **Deprecated** — removed from supported backends | No JSON file fallback; DB required for `file_nodes` |

---

## Phases

### Phase 0: Database Schema Migration — Final State DDL

**Dependencies:** None (foundation phase)
**Risk Level:** Medium — schema changes affect all backends; big-bang final-state approach

| Task | Description | Verify |
|------|-------------|--------|
| **0.0** | **[GATE] Docs-First**: Update 10 existing specs + create 3 new specs in `docs/spec/server/` and `docs/features/` (`storage.md`, `permissionStore.md`, `shareLinkStore.md`, `recentFilesStore.md`, `permissionRequestStore.md`, `Permission.md`, `ShareLink.md`, `metaPaths.md` [deprecated], `files-sharing.md`, `permissions.md` + new: `fileNodesStore.md`, `sqliteSchemaInit.md`, `schemaManager.md`) | All spec files updated before any implementation task begins |
| 0.1 | Rewrite `store/postgresql/ddl/001_initial_normalized_schema.sql`: all tables in final state — new (`file_nodes`, `object_map`, `filecache`, `node_ancestors`) + rewritten (all permission/sharing/recentFiles tables use `file_node_id`). Single DDL; no `002_*.sql` | SQL validates against PostgreSQL 16; see Task 0.13 |
| 0.2 | Update `sqliteSchemaInit.js`: glob-based DDL discovery (`ddl/*.sql`), add `\bBIGINT\b → INTEGER` conversion after BIGSERIAL replacements, handle inline self-referencing FK via deferred checks | SQLite schema initializes without error; see Task 0.10 |
| 0.4 | Create infrastructure/schema management utility: `applyPendingMigrations()` that runs unapplied DDL files in order; tracks applied migrations in `_schema_migrations` table with SHA-256 checksums | Migration tracker works idempotently; see Task 0.11 |
| 0.5 | Update `.env.example`: change `WEA_STORAGE_BACKEND` default from `webdav` to `postgresql`; add `WEA_FILE_STORAGE=s3\|webdav`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (optional, for MinIO) | Config documented; metadata backend defaults to postgresql |
| 0.6 | Remove FsJSON + webdav from `storage.js` backend resolver: supported backends are now `postgresql`, `sqlite`. Add deprecation warning if `WEA_STORAGE_BACKEND=fs` or `webdav` is detected; fallback to SQLite/postgreSQL respectively. Remove `webdav` default and branch entirely | FsJSON/webdav metadata mode logs warning; see Task 0.12 |
| 0.7 | Update `docker-compose.e2e.yml`: add PostgreSQL (`postgres:16`) + MinIO services alongside existing WebDAV service; configure health checks for all three containers | All containers start healthy in E2E environment |
| 0.8 | Update `.env.e2e`: add S3+PG configuration block (`S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT=http://minio-e2e:9000`, `WEA_PG_HOST=postgresql-e2e`) alongside existing WebDAV settings | Server starts with either backend based on env variable toggle |
| 0.9 | Update `server/test-setup.js`: make `WEA_STORAGE_BACKEND` configurable via env override instead of hardcoded `fs`; default to `sqlite` for in-process tests. Refactor `test-utils.js` `createTestDatabase()` for SQLite isolation (unique `.db` per suite, adapter cache reset). | Tests run without FsJSON dependency; see Task 0.14 |
| **0.10** | Test `sqliteSchemaInit.js`: glob discovery order, `convertPostgresToSqlite()` type mapping fidelity (BIGSERIAL→INTEGER AUTOINCREMENT, BIGINT→INTEGER, TIMESTAMPTZ→TEXT), converted SQL executes against in-memory SQLite | `server/infrastructure/__tests__/sqliteSchemaInit.test.js` |
| **0.11** | Test `schemaManager.js`: `_schema_migrations` auto-creation, pending migration detection, idempotency (second call = zero executions), SHA-256 checksum recording | `server/infrastructure/__tests__/schemaManager.test.js` |
| **0.12** | Test `getBackend()` deprecation: `fs` → warn+sqlite, `webdav` → warn+postgresql, `postgresql`/`sqlite` pass-through, empty → postgresql default. Remove obsolete FS-backend test blocks | `server/infrastructure/__tests__/storage.test.js` |
| **0.13** | DDL smoke test: execute final DDL against PostgreSQL (Docker) + SQLite; assert 13 tables exist; verify FK constraints including self-referencing `file_nodes.parent_id`; CASCADE delete propagation | `server/store/__tests__/ddlValidation.test.js` |

> **Phase 0 — Status: COMPLETE**
> All infrastructure tasks (0.0–0.14) are implemented. DDL, schema manager, SQLite converter, test utilities, and spec documents are in place.

#### Expected Test Failures After Phase 0

Phase 0 rewrites the DDL to use `file_node_id` across all permission/sharing tables, but application stores still reference the removed legacy path columns. This produces `SQLITE_ERROR: no such column` at runtime. **These failures are valid and expected** — application code migration is explicitly scoped to Phase 3 (Permissions → Node ID) and Phase 5 (Sharing & RecentFiles → Node).

| Failing Area | Affected Tests | Root Cause | Resolved In |
|---|---|---|---|
| `permissionStore.js` | Permission model, PermissionRequest model, permissions middleware (~22 failures) | SQL queries reference `folder_path` / `file_path` columns removed from DDL | Phase 3 Tasks 3.1–3.2, Phase 4 Task 4.8e |
| `permissionPolicy.js` (sync checkers) | permissionPolicy tests, aclService tests | `checkPermissionSync`/`checkFilePermissionSync` not implemented in store — runtime TypeError if sync paths are hit | Phase 4 Task 4.8d |
| `shareLinkStore.js` | ShareLink model, shareLinks/sharePublic routes (~16 failures) | Code writes `file_path` to `share_links`; DDL has `file_node_id` only | Phase 5 Task 5.1 |
| `permissionRequestStore.js` | permissionRequests routes (~7 failures) | SQL queries reference `folder_path` / `file_path` columns | Phase 3 Task 3.2 |
| `Settings` model | Settings model, auth routes (~8 failures) | JSON double-serialization bug (unrelated to schema migration) | Separate bug fix required |

> Phase 3 Tasks 3.1–3.2 (now COMPLETE) resolved the `permissionStore.js` and `permissionRequestStore.js` rows above — those ~29 failures no longer occur. Remaining failures at this point: `shareLinkStore` (Phase 5 Task 5.1) and the unrelated `Settings` bug.

**Validation command for Phase 0 scope only** (infrastructure tests only):
```bash
npm run test:unit -w server -- --testPathPatterns="infrastructure|store/__tests__"
```

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

> **Phase 1 — Status: COMPLETE**
> All S3 blob store adapter tasks (1.1–1.6) are implemented. S3BlobStore (5 methods), NoOpBlobStore stub, factory with env config validation, s3Mock, and spec document are in place. 18 unit tests pass.

---

### Phase 2: Core Service Layer — fileNodesStore, fileNodeService, blobStorageService, uploadService

**Dependencies:** Phase 0 (schema), Phase 1 (S3 adapter)
**Risk Level:** High — central orchestration layer; all file operations flow through here
**Design Decisions:** Factory function DI pattern (consistent with existing `createFileService`, `createBlobStore`); dedicated `fileNodesStore.js` as SQL query middle layer; S3-only scope (WebDAV deferred to Phase 4); TX ownership at orchestration layer only (no nested transactions).

#### Layer Architecture

```
uploadService.js          ← Orchestration (4-step TX1 → S3 PUT → TX2 flow)
  ├── fileNodeService.js   ← Tree operations (create/move/rename/delete/list/resolvePath)
  │       └── _ancestryHelper.js ← Closure table maintenance (buildAncestorsForNode, rebuildAfterMove)
  │               └── fileNodesStore.js ← SQL query layer (PostgreSQL / SQLite branching)
  └── blobStorageService.js ← Blob lifecycle (prepareUpload → completeUpload → download → overwrite)
          └── S3BlobStore / NoOpBlobStore (Phase 1 artifact)
```

#### store/fileNodesStore.js — DB Query Layer

PostgreSQL/SQLite dual-backend SQL operations for `file_nodes`, `object_map`, `filecache`, `node_ancestors`. Factory function `createFileNodesStore()` with `getBackend()` branching. Key methods: `createNode`, `getNode`, `getChildren` (with filecache LEFT JOIN), `renameNode`, `moveNode`, `deleteNodeTree`, `updateSyncStatus`, `resolvePathSegment`, ancestor CRUD (`insertAncestorRows`, `deleteAncestorByDescendant`, `getDescendantIds`, `getAncestorChain`), object_map lifecycle (`upsertObjectMap`, `insertObject`, `getActiveObject`, `getObjectMapByS3Key`, `activateObject`, `orphanObject`), filecache (`upsertCache`, `deleteCache`).

#### service/_ancestryHelper.js — Closure Table Maintenance

Isolated module for `node_ancestors` management. Called exclusively by fileNodeService, never exposed to routes. Strategy: delete-then-insert on moves (simplest correct approach). Methods: `buildAncestorsForNode(nodeId, parentId)` — traverses parent chain and inserts self + all ancestors; `rebuildAncestorsAfterMove(movedNodeId, newParentId)` — BFS traversal of subtree, deletes entire subtree's ancestor rows, recomputes from new parent chain; `cleanupAncestorsForDeletion(nodeIds)` — explicit orphan removal (FK CASCADE is the primary mechanism, explicit removal is safety net).

#### service/fileNodeService.js — Filesystem Tree Management

Factory `createFileNodeService({ fileNodesStore, storage })`. All mutating operations wrapped in `withTx()` (dispatches to `withTransaction` or `withSqliteTransaction` based on backend). Cycle detection on `moveNode` via `getDescendantIds`. Methods:

| Method | TX Scope | Ancestry Impact |
|--------|----------|----------------|
| `createFile(parentNodeId, name)` | INSERT file_nodes + buildAncestorsForNode | New node chain from parent |
| `createDirectory(parentNodeId, name)` | INSERT file_nodes + buildAncestorsForNode | Same as createFile |
| `renameNode(nodeId, newName)` | No TX needed (single UPDATE) | None |
| `moveNode(nodeId, newParentId)` | moveNode + rebuildAfterMove in single TX | Full subtree ancestor recomputation |
| `deleteNode(nodeId)` | deleteAncestors + deleteNodeTree in single TX | CASCADE handles object_map, filecache, node_ancestors FK rows |
| `listDirectory(parentNodeId)` | Read-only | None |
| `getNodePath(nodeId)` | Read-only ancestor chain traversal | None |
| `resolvePath(pathString)` | Sequential segment lookups | None |
| `getDescendantIds(nodeId)` | SELECT from node_ancestors | None |

#### service/blobStorageService.js — Blob Lifecycle (S3 Only)

Factory `createBlobStorageService({ blobStore, fileNodesStore })`. S3 mode only; WebDAV support deferred to Phase 4. `s3Key` generated via `crypto.randomUUID()`. Actual S3 deletion on delete is deferred to GC service (Phase 6); `deleteBlob` merely marks `object_map.status='orphaned'`. Version number is always 1 (single-version mode; the `UNIQUE(file_node_id, version_number)` constraint exists for future version history expansion). Methods:

| Method | DB Operation | S3 Operation |
|--------|-------------|-------------|
| `prepareUpload(fileNodeId)` | UPSERT object_map (orphan previous active, INSERT pending) | None |
| `completeUpload(s3Key, size, mime)` | UPDATE status='active'; upsert filecache | None (S3 PUT done by uploadService) |
| `downloadBlob(fileNodeId)` | SELECT active s3_key | blobStore.downloadBlob(key) |
| `overwriteBlob(fileNodeId, buffer)` | OLD→orphaned; NEW insert+active; filecache UPDATE | blobStore.uploadBlob(newKey, buffer) |
| `deleteBlob(fileNodeId)` | Mark active object_map row orphaned | Deferred to GC (Phase 6) |

#### service/uploadService.js — Orchestration

Factory `createUploadService({ fileNodeService, blobStorageService, blobStore, storage })`. Synchronous upload flow per Execution Rule #11. TX ownership lives here — service methods are TX-agnostic. Methods:

| Method | Flow |
|--------|------|
| `uploadFile(parentNodeId, name, buffer, mimeType)` | TX1: createFile + prepareUpload → S3 PUT → TX2: completeUpload + sync_status='active' |
| `overwriteFile(fileNodeId, buffer, mimeType)` | TX1: prepareUpload(new version) + sync_status='pending_upload' → S3 PUT → TX2: completeUpload + sync_status='active' |
| `downloadFile(fileNodeId)` | blobStorageService.downloadBlob (pass-through) |

**Failure recovery states:**

| Failure Point | DB State | S3 State | Recovery |
|--------------|----------|----------|----------|
| TX1 fails | ROLLBACK, nothing persisted | Nothing | Idempotent retry |
| S3 PUT fails | object_map='pending' | Nothing | Retry endpoint or GC Tier 1 |
| TX2 fails | object_map='pending'; file_nodes sync_status='pending_upload' | Blob uploaded | GC Tier 2 (listOrphanedKeys) cleans untracked blob |

#### Test Plan

Test files are created in `server/service/__tests__/` and `server/store/__tests__/`. Follow existing conventions (selectiveDelete.test.js style: inline mock factory, describe per behavior area, async/await). Verification scenarios are defined before implementation in each task (TDD approach). Detailed test scenarios are in the Phase 2 spec suite (`docs/spec/server/services/*.md`, `docs/spec/server/store/fileNodesStore.md`).

| Task | Description | Verify |
|------|-------------|--------|
| **2.0** | **[GATE] Docs-First**: Create 5 new spec files (`_ancestryHelper.md`, `fileNodeService.md`, `blobStorageService.md`, `uploadService.md`, `core-service-layer.md`) + enhance `fileNodesStore.md` with object_map methods in `docs/spec/server/` and `docs/features/` | All spec/feature docs complete before any implementation task begins |
| 2.1 | Implement `fileNodesStore.js`: PostgreSQL/SQLite dual-backend SQL layer for file_nodes, object_map, filecache, node_ancestors | In-memory SQLite tests verify all CRUD + ancestor + object_map operations; see `docs/spec/server/store/fileNodesStore.md` |
| 2.2 | Implement `_ancestryHelper.js`: buildAncestorsForNode, rebuildAfterMove (BFS-based), cleanupOnDelete with delete-then-insert strategy | Closure table correct at depth 0/1/N after every mutation; see `docs/spec/server/services/_ancestryHelper.md` |
| 2.3 | Implement `fileNodeService.js`: all tree operations (create/move/rename/delete/list/resolvePath/getNodePath) with transaction dispatching and cycle detection | createFile at depth N produces correct ancestor chain; move rejects cycles |
| 2.4 | Implement `blobStorageService.js` (S3 mode only): prepareUpload → completeUpload lifecycle, downloadBlob, overwriteBlob, deleteBlob (orphan marking) | S3 mock tests verify pending→active→orphaned transitions; filecache metadata updates on completeUpload |
| 2.5 | Implement `uploadService.js`: 4-step orchestration (TX1 → S3 PUT → TX2); uploadFile + overwriteFile + downloadFile | Integration test with real SQLite + s3Mock; simulate failure at each of 3 points, verify recoverable state |
| 2.6 | Create all test files: `fileNodesStore.test.js`, `fileNodeService.test.js`, `blobStorageService.test.js`, `uploadService.test.js` | All tests pass; closure table consistency verified at depth 0/1/N; each failure point in upload flow leaves recoverable state |

> **Task 2.4 (WebDAV mode) removed** from Phase 2 scope. WebDAV blob storage support is now part of Phase 4 (Files Domain Integration), where fileService.js refactoring introduces the dual-backend switch.

---

### Phase 3: Permissions Domain → Node ID

**Dependencies:** Phase 2 (fileNodeService for ancestor queries), Phase 0 (schema ready)
**Risk Level:** High — largest behavioral change; permission checks called on every file access

> **Phase 3 — Status: COMPLETE**
> Server-side permission stores, services, routes, and middleware are fully migrated to nodeId and verified (Phase 2/3 scope: 15 suites / 287 tests pass). Client-side migration (Tasks 3.8-3.9) depends on Phase 4 Task 4.8 (file routes return nodeId) — moved there. Remaining legacy cleanup (Tasks 3.1a partial, 3.3b-2, 3.3b-3, 3.3c) depends on Phase 4 caller migrations — moved to Phase 4 Tasks 4.8c-4.8g.

| Task | Description | Verify | Status |
|------|-------------|--------|--------|
| 3.1 | Rewrite permissionStore SQL queries for `permissions_user_paths`, `permissions_user_files`, and `permission_requests`: replace path-based SQL with `file_node_id`-based queries; derive `target_type` from `file_nodes.type` via JOIN | Adapter returns same results via nodeId lookups | ✅ COMPLETE |
| 3.1a | Remove JSON backend from permissionStore.js (`getPermissionDoc`, `getSharePermissionDoc`, `writeUserPermissionsDoc`, cache Maps) — **partial**: `writeUserPermissionsDoc` removed; `getPermissionDoc`/`getSharePermissionDoc`/cache Maps remain due to active callers (auth, permissionFacade, Permission model, fileService, batchOperationService, downloadService, shareAccessService, cleanupService) | Store reduced from ~1290 to ~1069 lines; JSON doc/cache patterns retained for Phase 4 Task 4.8e | ⚠️ PARTIAL — moved to Phase 4 Task 4.8e |
| 3.2 | permissionRequestStore: fully nodeId-based SQL, single `file_node_id` field, deduplication via partial unique index | All SQL uses file_node_id; tests pass | ✅ COMPLETE |
| 3.3a | aclService.js: nodeId-based `checkFilePermission`, `checkFolderPermission`, `checkPermission` with closure table inheritance | Permission checks return same results as before | ✅ COMPLETE |
| 3.3b-1 | ownerPathResolver → ownerNodeResolver: rename file, rewrite with `fileNodesStore.isAncestor()` closure table check; update 5 import sites | Owner detection via ancestry, not path prefix | ✅ COMPLETE |
| 3.3b-2 | permissionPolicy.js: remove path-based `can*` functions + sync checker builders (lines 112-260) — **blocked** by fileService/batchOperationService/downloadService callers | No path-based functions remain | ❌ DEFERRED — Phase 4 Task 4.8d |
| 3.3b-3 | aclService.js: remove sync checker re-exports + `canAccessPath` — **blocked** by same callers | No deprecated re-exports remain | ❌ DEFERRED — Phase 4 Task 4.8f |
| 3.3c | permissionFacade.js + Permission.js: delete or rewrite — **blocked** by 15 production callers | Files deleted or rewritten as thin nodeId pass-through | ❌ DEFERRED — Phase 4 Task 4.8e |
| 3.4 | Middleware `permissions.js`: extracts nodeId from req.query/req.body; no path normalization needed | Authenticated requests pass permission checks | ✅ COMPLETE |
| 3.5 | Routes: all 4 files (folderPermissions, filePermissions, permissionRequests, queries) use nodeId/fileNodeId exclusively | API accepts/returns nodeId payloads | ✅ COMPLETE |
| 3.8 | **Client:** Refactor `permissionService.js` + `sharePermissionGateway.js` + `permissionRequestService.js`: payloads send nodeId — **depends on Phase 4 Task 4.8** (file routes return nodeId) | Client sends nodeId in all permission API calls | ❌ MOVED — Phase 4 Task 4.8a |
| 3.9 | **Client:** Refactor `useSharedManage.js`, `buildPermissionDiff.js`, remove `collectSubfolderPaths()` — **depends on Phase 4 Task 4.8** | Permission state keyed by nodeId | ❌ MOVED — Phase 4 Task 4.8b |
| 3.10 | Route tests: grant/revoke/check endpoints use nodeId payloads; ancestor-inheritance tests (depth 0, 1, N) | Permission checks return correct results through closure table traversal | ✅ COMPLETE |

---

### Phase 4: Files Domain Integration + WebDAV Blob Support + Permission Legacy Cleanup

**Dependencies:** Phase 3 (permissions layer node-based), Phase 2 (services ready)
**Risk Level:** High — replaces current file operation flow; affects all file routes; introduces dual-backend switching; migrates legacy permission callers to nodeId

| Task | Description | Verify |
|------|-------------|--------|
| 4.0 | Add WebDAV mode to `blobStorageService`: extend with `WebdavBlobStore` adapter that maps `file_node_id → WebDAV path` via `file_nodes` tree; `uploadBlob` = WebDAV PUT, `downloadBlob` = WebDAV GET. Factory selects S3BlobStore or WebdavBlobStore based on `WEA_FILE_STORAGE`. | Both S3 and WebDAV modes pass blobStorageService tests identically |
| 4.1 | Refactor `domains/files/services/fileService.js`: replace direct WebDAV calls with service layer (`fileNodeService` + `blobStorageService`). The factory now injects the Phase 2 services instead of raw WebDAV adapter. | File CRUD via new service works identically; no behavioral regression |
| 4.2 | Update `listDirectoryWithPermissions`: source children from `file_nodes` (DB query) instead of remote listing; enrich with permissions from node_id-based permission store (Phase 3 artifact); **return `nodeId` in response objects** | Response format matches existing API contract; includes nodeId |
| 4.3 | Update upload flow: new files create `file_nodes` row + storage blob atomically (via uploadService). WebDAV mode uses synchronous WebDAV PUT inside TX boundary; S3 mode follows Phase 2 4-step flow. | Upload creates DB entry before blob write in both modes |
| 4.4 | Update download flow: resolve path→nodeId→object_map→S3 key or WebDAV path | Download returns same content as before in both backends |
| 4.5 | Update rename/move/delete: DB-only operations for metadata; storage adapter handles physical move (WebDAV MKCOL/MOVE) or no-op (S3, blob stays put). Fail-safe: on WebDAV operation failure, mark `sync_status='orphaned_node'`. | Rename is instant DB update in S3 mode; fail-safe test simulates WebDAV error → orphaned status set |
| 4.6 | Batch operations (copy/move/delete): adapt to node-based model — copy = new file_nodes row + new object_map entry referencing same s3_key; delete = recursive descendant removal via closure table. **Migrate sync checkers** (`buildSync*Checker`) to async nodeId checks in `batchOperationService.js` and `downloadService.js` | Bulk ops work on node IDs; no sync checker usage remains |
| 4.7 | Copy-on-write for S3 mode: copying a file creates new `file_nodes` + `object_map` pointing to the SAME `s3_key` (read-only share); mutation triggers actual blob copy | Two nodes, one blob, zero storage waste |
| 4.8 | Update file routes (`crud.js`, `batch.js`, `preview.js`, `folders.js`): accept `nodeId` in request payloads; **return `nodeId` + display path in responses**. **No path-based compatibility layer** — FsJSON is deprecated, all backends are DB-driven. Wire the service layer into routes via a **composition root** (`server/service/composition.js`) that builds `fileNodeService` + `blobStorageService` (mode from `WEA_FILE_STORAGE`) + `uploadService` + `aclService` + `fileService` once at startup. Remove `normalizePathParam` middleware in this task. Add direct single-item routes `POST /move`, `POST /copy`, `DELETE /delete` alongside the batch endpoints. | API accepts/returns nodeId exclusively; path strings are display-only; composition root injects services into routes |
| 4.8a | **Client:** Refactor `permissionService.js` — grant/revoke/check payloads send `nodeId` instead of `folderPath`/`path`; remove `includeSubfolders` (server handles via closure table) | Client sends nodeId in all permission API calls |
| 4.8b | **Client:** Refactor `useSharedManage.js` (replace `targetPath` → `targetNodeId`), `buildPermissionDiff.js` (nodeId Maps), remove `collectSubfolderPaths()` + simplify `shareTargetPermissionSaveUseCase.js`, rewrite `sharePermissionGateway.js` + `permissionRequestService.js` | Permission state keyed by nodeId; no path-string references |
| 4.8c | Migrate `fileService.js` sync checkers to async nodeId checks: replace `checkPermissionSync(doc, path)` with `aclService.checkFolderPermission(userId, nodeId, perm)` | No sync checker usage in fileService |
| 4.8d | Remove path-based compat layer from `permissionPolicy.js` (lines 112-260): delete `canReadFolder`, `canWriteFolder`, `canGrantPermission`, `buildSync*Checker` etc. Keep only `can*Node` functions | `permissionPolicy.js` reduced from 307 to ~100 lines |
| 4.8e | Remove or rewrite `permissionFacade.js` + `models/Permission.js`: delete both files or rewrite as thin nodeId pass-through; update all 15 production callers to use `permissionStore` or `aclService` directly | Files deleted or contain only nodeId methods |
| 4.8f | Remove sync checker re-exports from `aclService.js` (lines 14-19) + remove `canAccessPath` | `aclService.js` contains only nodeId-based methods |
| 4.8g | Remove `ownerNodeResolver.js` backward-compat path helpers (`userRootPath`, `isOwnerPath`, `getHomeOwnerUserIdForPath`) — **only if** all callers migrated to nodeId-based `isOwnerNode` | No path-based owner detection remains |
| 4.8h | Rewrite client tests: `permissionService.test.js` (nodeId fixtures), `buildPermissionDiff.test.js` (nodeId Maps), remove `folderUtils.test.js` | All client permission tests pass with nodeId |
| 4.8i | **Client:** Migrate the client file operations layer to nodeId payloads — `client/src/services/fileService.js` (list/download/upload/rename/batch-move/copy/delete/check-conflicts/metadata/preview/download-multiple/folders-create/stats/thumbnails-batch), `explorerGateway.js`, `folderTreeGateway.js`, `folderPickerGateway.js`, `useBulkOperations.js`, `useExplorerCommands.js`, `useFileOperations.js`, `useDragAndDrop.js`, `useDropToUpload.js`, `usePreviewLoader.js`, dialogs/grids keyed by `file.path` → `file.nodeId`, and MSW `handlers.js`. Remove client-side path recomputation (rename in `useFileOperations.js`). | Client sends nodeId in all file API calls; zero path-string payloads/keys remain in client file layer |
| 4.9 | Update `domains/files/routes/__tests__/files.test.js`: replace WebDAV mock with fileNodeService + blobStorageService; assertions use nodeId-based payloads; run against SQLite-backed integration tests for full CRUD lifecycle | All route tests pass against DB backend (not FsJSON) |
| 4.10 | Update `server/test-utils.js`: add `createTestFileNode()`, `grantTestPermissionByNodeId()` helpers alongside existing path-based functions for nodeId-first testing | Test utilities support nodeId operations natively |

> **Phase 4 — Status: COMPLETE**
> All Wave 1-6 tasks are **implemented and verified** (2026-08-05). Integration test suite (41 tests, 8 scenarios) passes against SQLite with mocked S3/WebDAV boundaries. Core services, route handlers, composition root, batch operations, permission legacy cleanup, and client migration (incl. Task 4.8i UI layer) are code-complete.
>
> **Fixed in this pass (fix/phase4-alignment):**
> - **Batch worker circular dependency** (`batchOperationService.js` ↔ `composition.js`): lazy-require `getComposition()` inside `_processBulkJob`; `scheduleBulkWorker` now honors the existing `WEA_SKIP_BULK_WORKER` test flag. Batch-move/delete/copy workers now reach `completed` status (previously always crashed with `TypeError: getComposition is not a function`).
> - **`/check-conflicts` is nodeId-only**: path-based `getConflicts` / `checkConflictsRecursive` / `handleSingleOpConflict` removed from `conflictResolver.js` (246 → 64 lines); `crud.js` always uses `getConflictsByNodeIds`.
> - **Task 4.8i completed (client UI)**: `useFileManager` navigates by `currentNodeId` (path→nodeId session map), `createFolder(parentNodeId)`, `listDirectory({ nodeId })`, `listByPath` removed, MSW handlers nodeId-only.
> - **Stale specs updated**: `models/Permission.md` (deleted-model end-state), `store/permissionStore.md`, client `sharePermissionGateway` / `permissionRequestService` / `useSharedManage` / `explorerGateway` / `folderTreeGateway` / `folderPickerGateway` / `useExplorerCommands` / `useDragAndDrop` / `useDropToUpload` / `fileService` / `useFileManager` / `CreateFolderDialog`, `features/core-service-layer.md`, `utils/ensureHomeOwnerAdmin.md`, `routes/files-test-plan.md`.
>
> **Remaining test failures (full suite, 2026-08-05, post-fix):**
> - **Server:** 12 failed suites / 55 failed tests / 1032 passed / 1090 total
>   - `recentFiles.test.js` (6), `recentFilesStore.test.js` (8) — Phase 5 scope
>   - `shareLinks.test.js` (6), `sharePublic.test.js` (4), `shareLinkStore.test.js` (5) — Phase 5 scope
>   - `ShareLink.test.js` (7), `PermissionRequest.test.js` (3) — Phase 5 scope
>   - `auth.test.js` (5), `admin.test.js` (1), `lockManager.test.js` (5) — environmental (postgresqlNotConfigured)
>   - `settingsStore.test.js` (2), `Settings.test.js` (3) — pre-existing double-serialization bug
> - **Client:** 8 suites / 23 tests (pre-existing, out of 4.8i scope): `shareReviewUseCase.test.js`, `sharePermissionSaveUseCase.test.js`, `buildPendingRequestState.test.js` (stale path-payload assertions after Phase 4.8b), `useFolderPicker.test.js`, `FileActionSheet.test.js`, `FilePreviewDialog.test.js`, `apiClient.test.js`, `apiClient.msw-smoke.test.js`. Verified identical on the base commit (503678d) — zero new client failures introduced.
>
> **Phase 4 completion (gap closure) — see [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md).**
> A post-completion alignment audit (2026-08-05) found remaining gaps: the thumbnails feature was left path-based on the server while the client is already nodeId-based (a live URL/payload contract break — the real server 404s the client batch call); the client DnD protocol, selection state, FolderPicker and MSW permission-request handlers still carried path-string remnants; `fileNodesStore.getDescendants` is missing (TypeError in `filePermissions.js`); and stale docs (`docs/features/permissions.md` "no inheritance" contradicts the closure table). These are addressed by a dedicated sub-plan (branch `fix/phase4-nodeid-gap-closure`) executed as Phase 4 completion **before** Phase 5. Downstream Phase 5/7/8 adjustments caused by that work are recorded inline in their sections below.

---

### Phase 5: Sharing & RecentFiles → Node ID

**Dependencies:** Phase 2 (fileNodeService), Phase 3 (permissions node-based), Phase 0 (schema)
**Risk Level:** Medium — server-side is self-contained, but client-side changes touch multiple services and utilities across the sharing/recentFiles domain. No parallel execution with Phase 3/4 due to shared dependency on `fileNodeService` and sequential phase rule.

| Task | Description | Verify |
|------|-------------|--------|
| 5.1 | Refactor `shareLinkService.js`: create share stores `file_node_id`; lookup uses nodeId for permission checks via closure table (table already defined in Phase 0) | Share creation uses file_node_id only; shared access respects folder permissions via ancestor walk |
| 5.2 | Update `shareAccessService.js` (`collectPathsUnderSharePath`, etc.): replace path-prefix string matching with closure table descendant query (`SELECT descendant_id FROM node_ancestors WHERE ancestor_id = shareNode.id`) | Share scope resolution correct for nested structures |
| 5.3 | Refactor `domains/recentFiles/service.js`: access tracking uses nodeId; path display resolved via `getNodePath(nodeId)` at render time (table already defined in Phase 0) | Recent files list resolves correctly after rename/move; renamed files show updated names |
| 5.4 | **Client:** Refactor `recentFilesRepository`: API payloads send `fileNode_id` instead of `path`. Remove path-mutation helpers (`updateSubPathsOnPathChange`, `removeSubPathsOnFolderDelete`) from `client/src/utils/recentFiles.js` — nodeId references make them unnecessary (rename/move does not change the reference). **Scope note (gap closure C2.1/C2.3):** also finish the client recent-files UI on nodeId — `RecentFilesSection` + the `/files/__recent__` view (synthetic entries must carry `nodeId` so metadata enrichment and selection work) — and remove the temporary `resolve-path` navigation shim added during Phase 4 gap closure. | Recent entries survive renames automatically; no client-side path string manipulation |
| 5.5 | **Client:** Refactor `shareLinkService`: createShareLink sends `fileNode_id` instead of `filePath`. Update share link UI components (`ExternalShareSection`, `ShareFolderTree`) to use nodeId-based state. **Scope note (gap closure C2.3/C2.5):** `ShareLinkSection` was already migrated to nodeId by the Phase 4 gap closure — this task now covers only `ExternalShareSection` + `ShareFolderTree`. After 5.1 (`GET /share-link/:token` returns the root nodeId), drop the share-mode `resolve-path` fallback introduced in gap closure C2.5. | Share links created via nodeId; no path-string payloads |

> **Phase 5 × gap-closure interplay:** Phase 4 gap closure (branch `fix/phase4-nodeid-gap-closure`) migrates the client folder tree, the `__recent__`/`__shared__` special views and navigation to a nodeId-first URL scheme **before** Phase 5. Phase 5 therefore completes only the remaining recent-files/share-link client surfaces on top of that foundation (see scope notes on 5.4/5.5). Server tasks 5.1–5.3 are unaffected.

---

### Phase 6: Garbage Collection + Fail-Safe Recovery

**Dependencies:** Phase 2–5 (all services operational)
**Risk Level:** Low — background maintenance, no user-facing behavior change

**GC Strategy:** Two-tier orphan cleanup. Both tiers execute in a single GC cycle; Tier 1 runs first (fast, targeted), Tier 2 follows (slower, S3 ListObjects-based).

- **Tier 1 (DB-driven):** `object_map.status='orphaned'` rows → known orphans from version supersession
- **Tier 2 (S3 scan):** `listOrphanedKeys()` diff against active `object_map.s3_key` set → unknown orphans from TX failures, manual row deletion

| Task | Description | Verify |
|------|-------------|--------|
| 6.1a | Implement DB-driven GC in `gcService`: query `object_map WHERE status='orphaned' AND created_at < threshold` → call S3 deleteBlob for each → DELETE rows from object_map | Orphaned blobs cleaned up after configured interval; active blobs untouched |
| 6.1b | Implement S3 bucket reconciliation in `gcService`: call `blobStore.listOrphanedKeys(olderThan)` → diff against active `object_map.s3_key` set → for keys present only in S3, call `deleteBlob(key)` | DB-untracked blobs (TX2 failure, manual row deletion) recovered and deleted from S3 |
| 6.2 | Add GC trigger: manual endpoint (`/api/admin/maintenance/gc`) + optional cron schedule (configurable via env `GC_INTERVAL_MS`, `GC_ORPHAN_TTL_DAYS`) | Admin can trigger GC on demand |
| 6.3 | Implement fail-safe recovery service: startup hook scans `file_nodes WHERE sync_status='orphaned_node'` → attempt retry or mark for manual review | Orphaned nodes detected and reported at startup |
| 6.4 | Add `/api/admin/maintenance/repair-sync`: admin endpoint to manually resolve orphaned nodes (retry delete, force-mark-active) | Admin can intervene on stuck nodes |
| 6.5 | Update `domains/admin/services/cleanupService.js`: integrate GC trigger and fail-safe reporting into existing cleanup interface | Cleanup endpoint covers new concerns |
| 6.6a | Create `service/__tests__/gcService.test.js` (Tier 1): seed object_map with orphaned rows + corresponding S3 mock entries; run GC; verify S3 deleteBlob called for orphans only, active blobs untouched | Orphan count drops to zero; active blob keys preserved in S3 mock store |
| 6.6b | Create `service/__tests__/gcService.test.js` (Tier 2): add extra keys to S3 mock that have no object_map rows; run GC; verify listOrphanedKeys + deleteBlob called for untracked keys, active blobs untouched | Untracked S3 blobs cleaned up alongside DB-orphaned blobs |

> **Phase 6 — Status: COMPLETE** (merged to `dev` 2026-08-06)
> All GC + fail-safe tasks (6.1a–6.6b) are implemented and verified (2026-08-06). `server/service/gcService.js` (two-tier cycle: DB-driven orphaned `object_map` → blob delete + row purge; S3 `listOrphanedKeys` reconciliation against the active key set) and `server/service/failSafeService.js` (orphaned_node scan + repair: `retry-delete` / `force-active`; startup report without auto-delete) are wired into the composition root. Admin endpoints `POST /api/admin/maintenance/gc` and `POST /api/admin/maintenance/repair-sync` added; `cleanup/orphaned` now also runs one GC cycle and reports orphaned nodes (additive result keys). Optional cron (`GC_INTERVAL_MS`, `GC_ORPHAN_TTL_DAYS`, test seam `WEA_SKIP_GC_SCHEDULER`) + startup fail-safe hook in `index.js`. New store methods in `fileNodesStore.js` (getOrphanedObjects, getAllActiveS3Keys, deleteObjectMapRows, getNodesBySyncStatus). Verification: 57 tests across gcService (Tier 1/Tier 2/TTL), failSafeService, maintenanceScheduler, composition, and admin maintenance route tests. Merged to `dev` (fast-forward).

---

### Phase 7: Legacy Application Code Cleanup

**Dependencies:** Phases 2–6 (all new paths functional)
**Risk Level:** Medium — removing fallback code; irreversible without git

Big-bang note: the database schema has no legacy path columns (defined in final state by Phase 0). This phase removes only application-level code that still references path strings.

| Task | Description | Verify |
|------|-------------|--------|
| 7.1 | Remove path-based branches from `recentFilesStore.js` | Recent files resolve via nodeId exclusively |
| 7.2 | Delete `FsJsonMetadataAdapter.js` and all FsJSON-related code paths; remove 'fs' option from backend resolver | Backend config only accepts postgresql/sqlite |
| 7.3 | Remove path-based permission check helpers (`checkFolderPermission(path)`, `checkFilePermission(path)`) from any remaining callers; verify Phase 4 Task 4.8d-4.8g completed all permission legacy cleanup. **Gap-closure note:** the thumbnails nodeId migration (gap closure S1) already removed the last server-side path-based `checkFilePermission` callers — this task is primarily a verification pass. | No path-string permission checks remain in source |
| 7.4 | Clean up `store/permissionStore.js` (reduce line count): remove `getPermissionDoc`, `getSharePermissionDoc`, cache Maps if not yet removed in Phase 4 Task 4.8e; store file is thin wrapper around direct SQL | Store file ≤ 300 lines |
| 7.5 | **Client:** Delete path-mutation helpers from `client/src/utils/recentFiles.js`: `updateSubPathsOnPathChange`, `removeSubPathsOnFolderDelete`, `removeMultiplePaths` — no longer needed with nodeId references | Zero imports of removed helpers across client codebase |
| 7.6 | **Client:** Remove any remaining path-string state from permission utilities: verify Phase 4 Tasks 4.8a-4.8b completed `buildPermissionDiff.js` nodeId migration; remove any residual path-based Maps or `startsWith` matching. **Gap-closure note:** the folder-tree nodeId migration (gap closure C2.3) and stale client-test fixes (C1.5) pre-complete most of this task — primarily a verification pass. | Permission state uses nodeId exclusively; no path-string traversal remains |

> **Phase 7 — Status: COMPLETE**
> All legacy cleanup tasks (7.1–7.6) are implemented and verified (2026-08-06). `recentFilesStore.js` was already nodeId-only (7.1 — verification + spec cleanup). FsJSON removed end-to-end (7.2): deleted `FsJsonMetadataAdapter.js`, removed `'fs'` from `getBackend()` (now postgresql/sqlite only), removed legacy filesystem helpers from `storage.js`, removed the file-lock path in `lockManager.js`, the FsJSON fallback in `settingsStore.js`/`bootstrap.js`/`cleanupService.js`, the obsolete `migrateMetadataToPostgresql.js` script, and trimmed `metaPaths.js` to lock-path helpers only. 7.3 verified no path-string permission checks remain. 7.4 removed `getPermissionDoc`/`getSharePermissionDoc`/`shareCache` from `permissionStore.js` (1069 → 915 lines; the `store/permissionStore.js` shim is 1 line, satisfying the ≤300-line target at the named path) and reworked `auth.js` share-token auth. 7.5 verified the client `recentFiles.js` helpers were already deleted in Phase 5 (zero imports). 7.6 removed residual client path-string state (`shareManageMessageUtils` `targetPath`, `deriveShareFolderAccessView` nodeId-vs-path compare, stale `FileManager.test.js` mocks, stale JSDoc). Merged to `dev` (merge commit `776f852`).
>
> **Verification:** server suite green — 68 suites / 1159 passed / 3 skipped (migration-script suite removed). Client suite green — 149 suites / 1260 passed / 0 failed (all previously-known client failures resolved by upstream Phase 4/6 work).

---

### Phase 8: Full Test Suite + Integration Verification + E2E Expansion

**Dependencies:** Phases 0–7 complete
**Risk Level:** Low — validation phase

> **Phase 8 — Status: IN PROGRESS** (branch `refactor/phase-8-verification`, 2026-08-06)
> Work is executed on the branch and will **not** be merged to `dev` until the user reviews and explicitly approves the merge.
>
> **Baseline (verified on `dev` 2026-08-06, commit `17efc48`):** server suite green — 66 suites / 1119 passed / 2 skipped (SQLite default via `test-setup.js`). `server/TEST_SUMMARY.md` (1122/3) and the Phase 7 note (68 suites / 1159) are stale vs. the live run.
>
> **Pre-flight audit findings that shape execution:**
> 1. **PostgreSQL schema is never applied at startup** — `initMetadataStore()` (`server/store/bootstrap.js`) inits the SQLite schema only; `applyPendingMigrations('postgresql')` (`server/infrastructure/schemaManager.js`) exists but is called nowhere outside its own tests. A PG backend cannot boot (`relation "users" does not exist` → `process.exit(1)`). This is a hard prerequisite for tasks 8.1/8.2/8.4, E2E S3+PG, and Rule 14 full-suite-on-PG.
> 2. **`.env.e2e` cannot boot the host-run E2E server in S3+PG mode**: `AWS_REGION` unset (`resolveS3Config()` throws, `blobstore/index.js:8`); `S3_ENDPOINT=http://minio-e2e:9000` and `WEA_PG_HOST=postgresql-e2e` are Docker-network hostnames unreachable from the host-run `e2e:server` process (host ports are 9010/5433).
> 3. **No MinIO bucket creation** anywhere — `S3BlobStore` never creates the bucket; neither jest tests nor `global-setup.ts` ensure it exists.
> 4. **E2E fixtures are stale vs. the nodeId-exclusive API** (Execution Rule 13): helpers still send `{filePath}`/`{path}` payloads (`e2e/helpers/shareLinks.ts`, `folders/create`, upload) that the server rejects; tight path-URL assertions at `auth.spec.ts:53`, `share-public.spec.ts:66,101`, `share-internal.spec.ts:322,335` break under the nodeId URL scheme. **This corrects the earlier claim (line 567) that "API payloads need no changes".**
> 5. **Rule 14 full-suite-on-PG requires test-infrastructure work**: several tests hardcode `WEA_STORAGE_BACKEND='sqlite'` (e.g. `files.integration.test.js:9`) or assert via `storage.sqliteQuery`/`sqliteRun` directly (`fileNodesStore.test.js`, `fileNodeService.test.js`, `uploadService.test.js`, `gcService.test.js`, …). A backend-neutral query helper plus per-suite PG isolation (TRUNCATE / fresh DB) is required before the whole suite can run under PG.
>
> **Execution order (dependencies):**
> ```
> P0 docs + PLAN update
>  ├→ P1 PG schema bootstrap wiring ──────────────┐
>  ├→ P2 .env.e2e fix + .env.e2e.webdav + npm  ───┤
>  ├→ P3 MinIO bucket creation helper ────────────┤
>                                                ▼
> [A] PG test infra (test-utils neutral + isolation) ─→ [B] PG integration tests 8.1–8.6
> [C] E2E infra (global-setup mode switch + seed + bucket + playwright projects)
>  └→ [D] E2E helper/spec nodeId migration + URL fixes ─→ [E] E2E-S3PG-001..008 spec
> [F] Final gate: server test:ci (SQLite + PG), Playwright both modes
> ```
>
> **Deployment/operating contract (user-confirmed 2026-08-06):** Production currently runs PostgreSQL (legacy path-based schema). After all phases complete, a **new instance** will be created with a **fresh empty PG database**; a data-migration script (Future Work) moves data from the existing instance (path-based) to the new one, then service switches over. Consequences:
> - The new instance's DB is always fresh → startup DDL application is a clean one-time bootstrap (scenario A). **No "already exists" tolerance is added**: a misconfigured app pointed at an old DB must fail loudly at boot, not be silently recorded as migrated.
> - The migration script must apply the schema via `applyPendingMigrations('postgresql')` (or the new app must boot once on the empty DB) **before** importing data, and data import must complete **before** the first real service boot (or with `WEA_DISABLE_DEFAULT_ADMIN=true`) to avoid admin/home-node bootstrap conflicts.
> - The old instance keeps running old code against the old DB until cutover; the migration is a one-way export/transform/import. WebDAV→S3 blob migration is a physical copy, so the old blob store can be retired after validation.
>
> **Orchestration fix (2026-08-06):** E2E runner lifecycle reordered so compose is provisioned BEFORE the app server: `e2e:server:s3`/`e2e:server:webdav` now chain `scripts/e2e-wait-healthy.mjs` (`docker compose up -d` + poll `ps` until required containers are healthy, ~90s timeout) before starting the server. `e2e/global-setup.ts` no longer runs `down -v` (which wiped the PG volume out from under the already-running server and crashed its `pg.Pool`); it idempotently re-runs the wait helper, then resets data via TRUNCATE (preserving `_schema_migrations`) + seed (`e2e/global-setup.seed-db.cjs`), and empties + ensures the bucket in s3 mode. `global-teardown.ts` unchanged (`down -v` + empty bucket). This makes stock `npm run test:e2e:s3` / `test:e2e:webdav` self-sufficient.
>
> **Bug A2 (WebDAV directory-ensure, 2026-08-07):** WebDAV blob-storage mode created directories DB-only, so `uploadToWebdav` PUTs hit non-existent remote paths (bytemark 403) — zero uploads succeeded in webdav mode. Fixed by (1) recursive, already-exists-tolerant MKCOL helper `ensureDirectoryExists` in `server/utils/webdav.js` (root → deepest segments, 405/redirect tolerated, 409 disambiguated via existence probe); `createDirectory` now delegates to it; (2) `WebdavBlobStore.createDirectory` + `blobStorageService.createDirectoryWebdav(nodeId)` (S3 no-op; on MKCOL failure marks `orphaned_node` + rethrows); (3) wired into `folders.js` POST /create, `userService.ensureUserHomeNode`, `cleanupService.ensureHomeOwnerAdminForAllUsers`, and the E2E seed (`global-setup.seed-db.cjs`, webdav env passed from `global-setup.ts`). Specs updated (`routes/folders.md`, `services/blobStorageService.md`, `services/fileService.md`, `utils/webdav.md`, `utils/ensureHomeOwnerAdmin.md`). Unit suite 53/921 + integration 14/215 green.
>
> **Phase 8 — Status: COMPLETE (all tasks verified 2026-08-07, branch `refactor/phase-8-verification`; NOT merged to `dev`)**
> **Final verification numbers:**
> - Server `test:ci` (SQLite): **67 suites / 1137 passed / 2 skipped / exit 0** (`test:ci:pg` now exits 0 after the startup-teardown fix).
> - Server `test:ci:pg` (PostgreSQL, `--runInBand` + TRUNCATE isolation): **67 suites / 1137 passed / 2 skipped / exit 0** — the full suite runs on BOTH backends (Rule 14).
> - Client `test:ci`: **147 suites / 1265 passed / 0 failed**.
> - Playwright E2E default wave, S3+PG (`test:e2e:s3`): **111 passed / 2 skipped / 0 failed** (8.11 PASS; incl. all E2E-S3PG-001..008).
> - Playwright E2E default wave, WebDAV+PG (`test:e2e:webdav`): **95 passed / 18 skipped / 0 failed** (8.10 PASS; skips are by-design mobile-only + s3-only gating).
>
> **Production bugs found & fixed during this phase (each user-approved, all RCA-logged in `docs/fail_log.md`):**
> 1. **PG multi-row VALUES** (`fileNodesStore.insertAncestorRows`): flat `$1..$N` → grouped `($1,$2,$3),…`; blocked all tree ops on PG (42601).
> 2. **PG type inference** (`permissionRequestStore` `resolved_by = CASE … $4`): `$4::BIGINT` cast (42804).
> 3. **CoW overwrite** (`blobStorageService.ensureExclusiveBlob`): `orphanObject(s3_key)` orphaned ALL sharers + `insertObject` v1 collided with the node's existing v1 → 409 on overwriting a copied file. Replaced with `upsertObjectMap(fileNodeId, newS3Key, 'active')` (per-node orphan + next version); the unit test that encoded the wrong behavior was corrected (E2E-S3PG-004).
> 4. **`user.rootNodeId` missing** in login/register/`/me` responses → home-view CRUD sent `parentNodeId:null` (400). Auth now resolves the home node via `getUserRootNode`.
> 5. **WebDAV MKCOL** (bug A2 above) — physical directory creation for folder + home nodes + seed.
> 6. **leave-share confirmation dead code** (client): `handleLeaveSharePathClick` now wired into the folder-tree/drawer share-mode navigation (E2E-SHARE-007).
> 7. **Permission-request target display**: inbox/outbox responses enriched with `display_path`/`target_name`; client renders path instead of `#<id>` (MYPAGE-006/007/008).
> 8. **`pg.Pool` unhandled 'error'**: `pool.on('error')` handler added — PG restart/down no longer crashes the server (also required for E2E teardown).
> 9. **FolderPicker `basename` missing**: `folderPickerGateway.listFolderContents` now normalizes entries (explorer shape) + dialog fallback — BULK-002/003 picker buttons had no accessible text.
>
> **Spec/fixture fixes (Case B, no product change):** E2E helper layer migrated to nodeId payloads + `/files/node/<id>` URLs (corrects the earlier "API payloads need no changes" claim); AUTH-005 landing assertion, OVERLAY-001/002/004 `__shared__` assertions → `data-file-node-id`, OVERLAY-003/005 fixture no longer grants home READ (inheritance hides the request button), core-flow specs updated from home-relative to absolute `display_path` (`/admin/…`), MyPage path-text assertions aligned.
>
> **Infra:** PG schema auto-applied at startup (`bootstrap.js` non-SQLite branch → `applyPendingMigrations`), fresh-DB-only contract (no already-exists tolerance); `.env.e2e` fixed (AWS_REGION, host-reachable S3/PG) + `.env.e2e.webdav` + `E2E_BACKEND_MODE` scripts (`test:e2e:s3`/`test:e2e:webdav`); `server/testing/minioTestUtils.js` (ensure/emptyBucket) + `server/testing/dbUtils.js` (backend-neutral dbQuery/dbRun + truncateAllTables); composer-runner lifecycle (compose before server, TRUNCATE+seed, bucket empty); E2E seed creates admin home node.
>
> **Remaining notes for the user:** (1) **Admin root = filesystem root `/`** (user-confirmed): production never creates an admin home node (`cleanupService` skips admins), `useFolderTreeController`/`useFileManager` treat admin home as null, and `folders/create` + upload now accept `parentNodeId: null` for admin — so admin browses all users' home directories from `/`, while regular users (e.g. `user1`) have named home nodes `/user1_x` with "Home › user1_x › …" breadcrumbs and a username-labeled tree root. The E2E seed no longer creates a `/admin` node and the core-flow specs assert root-relative paths (`/flow-folder`). `display_path` remains absolute (includes the owning user's home node name) for non-root nodes. (2) Benign `GET /api/permissions/check?nodeId=null → 400` log noise during share-public flows (client sends an unresolved nodeId; server rejects cleanly; no test impact) — candidate follow-up. (3) **`E2E_LATER_WAVES=1` re-validated (2026-08-07):** `mypage-admin` (16 variants) and `explorer-advanced.desktop` pass in both modes; `explorer-advanced.desktop` `E2E-OVERLAY-008` had a stale `[data-file-path]` assertion in the `__recent__` view — fixed to assert the opened file's listing entry via `fileItem` with a 20s load wait (the file must be opened, not just created, to be tracked as recent). **Known pre-existing mobile flakiness:** the mobile long-press selection helper (`longPressItem`, mouse-event based, ~500ms) intermittently fails to enter selection mode under load — affects `explorer-advanced.mobile` (E2E-MOBILE-001/002, E2E-BULK-007) and occasionally the default-wave mobile core-flow bulk tests; it passes on isolated runs and is a test-helper robustness issue, not a product/server bug. Hardening it (longer press, wait-for-selection, optional retry) is a recommended follow-up.

#### Server-Side Tests

| Task | Description | Verify |
|------|-------------|--------|
| 8.1 | S3+PostgreSQL integration tests: full upload→list→download→rename→move→delete lifecycle via MinIO test container | All operations succeed end-to-end |
| 8.2 | WebDAV+PostgreSQL integration tests: same lifecycle, verifying file_nodes sync + fail-safe recovery on simulated errors | Orphaned nodes detected and recoverable |
| 8.3 | Permission inheritance tests: grant folder permission → verify descendant access via closure table (depth 0, 1, N) | Ancestor permissions propagate correctly |
| 8.4 | Share link + permission interaction tests: shared node with folder-level restrictions → verify scope enforcement via closure table | Public share doesn't bypass folder locks |
| 8.5 | GC service end-to-end test (Tier 1): create→overwrite→delete sequence → verify DB-orphaned blob cleanup after threshold | Orphan blobs deleted, active blobs preserved |
| 8.6 | GC service end-to-end test (Tier 2): inject untracked blob into S3 → run GC → verify listOrphanedKeys detects and deletes it | Untracked S3 blobs cleaned up by reconciliation tier |
| 8.7 | SQLite compatibility tests: run full suite with `WEA_STORAGE_BACKEND=sqlite` | All tests pass on SQLite backend |
| 8.8 | Update `stryker.config.json`: add new service paths (`service/*`, `infrastructure/adapters/blobstore/*`) to mutation scope | Mutation coverage includes all new code |

#### E2E Test Strategy (Playwright)

After Phase 8 is complete, Playwright E2E tests run in both backend modes:

| Mode | Metadata Backend | Blob Storage | Docker Services | Purpose |
|------|-----------------|-------------|-----------------|---------|
| WebDAV+PG (Legacy) | PostgreSQL | WebDAV server | postgresql, webdav-test | Regression guard for existing behavior |
| S3+PG (New) | PostgreSQL | MinIO | postgresql-e2e, minio-e2e | New architecture validation |

**E2E Infrastructure Changes:**

1. `docker-compose.e2e.yml` — MinIO + PostgreSQL added in Phase 0 Task 0.7
2. `.env.e2e` — S3+PG configuration block added in Phase 0 Task 0.8; mode switching via `WEA_FILE_STORAGE` environment variable
3. `playwright.config.ts` — extend existing desktop/mobile projects with S3+PG mode as an environment matrix: the same spec files re-run against both backends to serve as a regression guard. **URL scheme note (gap closure C2.1):** after the nodeId-first URL migration, existing specs that navigate/assert real-folder path URLs (`/files/<path>`) must be updated to navigate by nodeId URLs resolved via `POST /files/resolve-path`; the virtual-root URLs `/files/__recent__` and `/files/__shared__` are intentionally kept unchanged to minimize churn.
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
| E2E-S3PG-008 | S3 bucket reconciliation: directly upload blob to S3 (no object_map entry) → run GC admin endpoint → verify orphaned blob deleted via listOrphanedKeys | P1 | same |

**Impact on Existing E2E Scenarios:**

Auth, Explorer CRUD, Bulk ops, Share flows, MyPage — all existing scenarios use identical API contracts, so they re-run in both modes as a regression guard. **Correction (2026-08-06):** the earlier claim that "API payloads need no changes" was wrong — the E2E helper/fixture layer still sends path-based payloads (`{filePath}` on share-link create, `folders/create {path}`, upload `path`) that the nodeId-exclusive server rejects. These helpers must be migrated to nodeId payloads (via `POST /files/resolve-path` for path→nodeId bootstrap) as part of Phase 8 before E2E can pass in either mode.

**Client URL scheme (Phase 4 gap closure C2.1):** the nodeId-first URL migration changes the URL contract for real folders (`/files/<path>` → `/files/node/<id>`). The following specs must be updated to navigate by nodeId URLs (resolved via `POST /files/resolve-path` in setup) and to assert the new URL shape: `e2e/explorer-advanced.desktop.spec.ts`, `e2e/share-internal.spec.ts`, `e2e/share-public.spec.ts`. Virtual-root URLs `/files/__recent__` / `/files/__shared__` are retained unchanged. Loose regex assertions like `/\/files(?:\/.*)?$/` still match and need no edits.

#### Final Gate

| Task | Description | Verify |
|------|-------------|--------|
| 8.9 | Run full CI suite: `npm run test:ci -w server` then `npm run test:ci -w client` | **All pass on SQLite backend** |
| 8.10 | Run Playwright E2E in WebDAV+PG mode (existing regression baseline) | All existing specs pass |
| 8.11 | Run Playwright E2E in S3+PG mode (new architecture validation) | All specs + new E2E-S3PG-* scenarios pass |

---

## Execution Order

```
Phase 0 (Schema Migration)
        ↓
Phase 1 (S3 Blob Store)
        ↓
Phase 2 (Core Services)
        ↓
Phase 3 (Permissions → Node ID) — complete; client deferred to Phase 4
        ↓
Phase 4 (Files Domain + Permission Legacy Cleanup + Client Migration)
        ↓
Phase 5 (Sharing & RecentFiles → Node)
        ↓
Phase 6 (GC + Fail-safe)
        ↓
Phase 7 (Legacy Remove)
        ↓
Phase 8 (Full Test Suite)
```

Phase 4 completion sub-plan (gap closure, branch `fix/phase4-nodeid-gap-closure`) executes **before** Phase 5 —
see [GAP_CLOSURE_PLAN.md](GAP_CLOSURE_PLAN.md) for the detailed task graph and downstream phase amendments.

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

**Deployment contract (user-confirmed 2026-08-06):** the new instance runs against a **fresh empty PostgreSQL database**. The migration script MUST:
- apply the schema first via `applyPendingMigrations('postgresql')` (idempotent, records into `_schema_migrations`) so the new app's startup DDL apply is a no-op;
- run the data import **before** the new app's first service boot (or with `WEA_DISABLE_DEFAULT_ADMIN=true`) so `ensureDefaultAdmin` / `ensureHomeOwnerAdminForAllUsers` bootstrap does not conflict with imported users/home nodes;
- never run against the old instance's DB — the new app must not be pointed at a non-fresh DB (startup will fail loudly, which is the intended guard, not a bug);
- be validated (blob count, permission integrity, share-link accessibility) before cutover; after cutover the old instance and its WebDAV blob store can be retired.

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
12. **FsJSON + webdav metadata deprecation.** FsJSON backend (`WEA_STORAGE_BACKEND=fs`) and webdav metadata backend (`WEA_STORAGE_BACKEND=webdav`) are both removed in Phase 0 (Task 0.6). All deployments must use PostgreSQL or SQLite for metadata storage. The `WEA_FILE_STORAGE=webdav` option for file content/blob storage remains supported — only the metadata layer is affected.
13. **No path compatibility layer.** FsJSON is deprecated; all deployments use SQLite/PostgreSQL. Server endpoints accept `nodeId` exclusively in request payloads — no transitional period accepting both `path` and `nodeId`. Client API consumers are updated simultaneously within the same phase: permission clients (Phase 4 tasks 4.8a-4.8b) **and** the full file operations layer (Phase 4 task 4.8i — `fileService.js`, explorer gateways, bulk-operation hooks, dialogs, MSW mocks), plus Phase 5 tasks 5.4-5.5. The only path-accepting server endpoint is the explicit legacy-URL resolver `POST /files/resolve-path` (path → nodeId, bootstrap/redirect/display only) added during Phase 4 gap closure (task S3); it is not a file-operation endpoint.
14. **Multi-backend test execution.** From Phase 8 onward, all server tests run against both SQLite and S3+PG backends. FsJSON backend tests are removed after Phase 7 cleanup. Test backend selection is controlled by `WEA_STORAGE_BACKEND` and `WEA_FILE_STORAGE` environment variables.
15. **E2E regression on new architecture.** Playwright E2E scenarios execute in both WebDAV+PG (legacy) and S3+PG (new) modes after Phase 8 Task 8.9-8.10. The `docker-compose.e2e.yml` orchestrates backend switching via environment variables; existing specs serve as regression guards, with only client-URL-scheme assertions updated for the Phase 4 gap-closure navigation change (see Phase 8 E2E strategy).
16. **Test data isolation per backend mode.** SQLite in-memory DB and MinIO buckets are initialized fresh by `global-setup.ts` for each test suite run and cleaned up by `global-teardown.ts`. No state sharing occurs between tests or backend modes.

---

## Side Task (branch `perf/test-suite-speedup`): Client Test Suite Speedup

**Objective:** Reduce client test suite wall-clock time. Root cause: real-time retry backoff (1s→2s→4s) in `client/src/services/httpClient.js` on 5xx/network errors; `apiClient.test.js` alone consumed 45.1s of a 45.6s full-suite baseline.

**Scope:** Client-side only. No test logic/assertions modified (incl. the 8 pre-existing failing suites).

**Changes (all verified):**
1. `client/src/services/httpClient.js` — additive `config.retryDelay` (default 1000) + module-level `RETRY_CONFIG` with exported `__setRetryConfigForTests()` test seam. Production defaults unchanged; `maxRetries=3` untouched.
2. `client/src/setupTests.js` — calls `__setRetryConfigForTests({ retryDelay: 0 })` so all test-env retries wait 0ms (attempt count preserved).
3. `client/src/jest-polyfills.js` — polyfilled `Blob.prototype.stream` (FileReader-based) because jsdom 16's Blob lacks `.stream()` and undici's Response (used by MSW) requires it; this surfaced when fast retries exposed `FileManager` bulk-download's previously backoff-masked blob-response failure.

**Results:**
- apiClient pattern: 45.0s → ~1.1–1.5s (target <10s).
- Full client suite: 45.6s → ~32.5–40.5s (variance by machine load).
- Failures identical to baseline: 8 failed suites / 23 failed / 1223 passed / 1246 total.
- Retry attempt/call-count behavior preserved (`httpClient.test.js` 6/6; `5xx retry all fail` passes).
- ESLint: 0 new issues (11 pre-existing, unchanged).

**Out of scope:** remaining wall-clock is dominated by genuine rendering work in `FileManager.test.js` / `MyPage.test.js` (not retry backoff). Unrelated in-progress server-side changes (`server/jest.config.js`, `server/test-setup.js`, `operationProgress.js`) present in the shared working tree were left untouched.
