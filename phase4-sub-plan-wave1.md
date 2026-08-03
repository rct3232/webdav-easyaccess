# Phase 4 — Wave 1: Docs-First Gate + Test Scaffolding

## Objective

Wave 1 establishes the complete specification suite and test skeleton for all Phase 4 tasks before any implementation code is written. Every service method, route contract, permission migration step, and legacy removal target must be documented in a spec file with enough detail that a sub-agent can implement it without asking clarifying questions. Every test scaffold defines `describe()` blocks and `it()` cases so the test runner produces failing tests immediately, confirming the scaffolding is wired correctly.

## Execution Rules

- **Docs first**: No implementation code may be written until all spec documents listed below exist with required sections.
- **One phase at a time**: Wave 1 (docs + test scaffolds) must complete before Wave 2 (implementation begins).
- **Branch per wave**: Work on `refactor/phase4-wave1-docs-tests` branch. Merge to `dev` after all specs and scaffolds are verified.
- **Test files move with source**: When a new service file is created, its `__tests__/` sibling must be co-located in the same commit.
- **No net behavior change**: Specs must document that existing API contracts (status codes, response shapes) remain identical for current backend mode; nodeId additions are additive.

## Prerequisites

The following files and infrastructure must exist before starting Wave 1:
- `docs/spec/server/services/blobStorageService.md` — existing S3-only spec (will be updated with WebDAV section)
- `docs/spec/server/routes/files.md` — existing route spec (will be updated with nodeId contracts)
- `docs/spec/server/utils/permissionPolicy.md` — existing policy spec (will be updated for Tier 1 only)
- `server/testing/mocks/s3Mock.js` — S3 mock factory from Phase 1
- `server/test-utils.js` — existing test utilities with `createTestDatabase`, `createAuthenticatedTestUser`, etc.
- `PLAN.md` — Phase 4 task definitions (Tasks 4.0–4.10)

---

## Task W1.0: Spec Document Updates

### W1.0-1: fileService.md

- **Path:** `docs/spec/server/services/fileService.md`
- **Action:** CREATE
- **Sections Required:**
  1. Overview — role, factory signature, position in architecture (replaces path-based fileService.js with service-layer dispatch)
  2. Factory Function Signature — `createFileService({ fileNodeService, blobStorageService, uploadService, aclService, fileStorageMode })` — `fileStorageMode: 's3' | 'webdav'`
  3. Methods — each method documented with params, returns, DB operations, storage operations:
     - `listDirectoryWithPermissions(userId, parentNodeId, user)` — children from `file_nodes`, permission flags via closure table + `aclService.checkFolderPermission(userId, childNodeId, READ)` / `aclService.checkFilePermission(userId, childNodeId, READ|WRITE)`, admin bypass flag, response shape with `nodeId` field per item
     - `uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict)` — dispatches to `uploadService.uploadFile()` for S3 mode; for WebDAV mode, creates `file_nodes` row + synchronous WebDAV PUT via `blobStorageService.uploadToWebdav()`; sync_status fail-safe semantics on failure
     - `downloadFile(fileNodeId, userId, user)` — permission gate (`aclService.checkFilePermission`), then resolves `object_map` → S3 key or WebDAV path → returns buffer
     - `renameNode(nodeId, newName, userId, user)` — DB-only metadata update via `fileNodeService.renameNode()`; for WebDAV mode, attempts storage-side MOVE as best-effort fail-safe (marks `sync_status='orphaned_node'` on failure); for S3 mode, no storage operation needed
     - `moveNode(nodeId, newParentNodeId, userId, user)` — DB move + closure table rebuild; same fail-safe semantics as rename
     - `deleteNode(nodeId, userId, user)` — permission gate, enumerates descendants via `fileNodeService.getDescendantIds()` (closure table), best-effort storage DELETE for WebDAV (bottom-up, `blobStorageService.deleteBlob`), then `fileNodeService.deleteNode()`; FK CASCADE handles `object_map`/`filecache`/`node_ancestors`
     - `copyFile(sourceNodeId, destinationParentNodeId, newName, userId, user)` — [RECTIFIED: D6] 5 args; S3 mode: copy-on-write via `blobStorageService.getActiveS3Key` + shared/duplicate key logic + `blobStorageService.linkObject`; WebDAV mode: actual blob copy (download + `uploadToWebdav`)
  4. Permission Integration — how each method calls `aclService` or uses admin/owner bypass before proceeding
  5. Sync Status Fail-Safe Semantics — definition of `active`, `pending_upload`, `orphaned_node`; when each is set; recovery expectations (Phase 6 GC)
  6. Error Cases — permission denied → 403, node not found → 404, storage failure → orphaned status + error response
  7. Verification Scenarios — checklist of testable behaviors per method

- **Key Content:**
  - Factory must accept both S3 and WebDAV modes; mode determined by injected `blobStorageService` (not hardcoded)
  - `listDirectoryWithPermissions` returns `{ nodeId, name, type, size, mimeType, modifiedAt, hasReadPermission, hasWritePermission }` per item
  - Admin users bypass all permission checks in list (all items returned with `hasReadPermission=true`, `hasWritePermission=true`)
  - Upload flow: S3 mode follows Phase 2 TX1 → blobStore.uploadBlob → TX2 pattern; WebDAV mode does single synchronous create + PUT
  - Rename is instant DB update for S3; for WebDAV, best-effort storage rename with fail-safe marking

- **Verification:** Spec file exists at path, contains all 7 sections listed above, each method has params/returns/error cases documented. Cross-reference: every method maps to a Task 4.x in PLAN.md.

---

### W1.0-2: blobStorageService.md (WebDAV section)

- **Path:** `docs/spec/server/services/blobStorageService.md`
- **Action:** UPDATE — append Section 3 "WebDAV Mode" and update Section 2 factory signature
- **Sections to Add/Modify:**

  1. Update Factory Function Signature (Section 2.2): [RECTIFIED: D5] Remove `webdavClient` parameter:
     ```js
     function createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService }) {
       // fileStorageMode: 's3' | 'webdav'
       // fileNodeService: needed for WebDAV path resolution (getNode, getNodePath)
     }
     ```

  2. New Section 3 — WebDAV Mode (`WebdavBlobStore` adapter):
     - Interface methods (S3-uniform names via `WebdavBlobStore` adapter — D1):
       - `uploadBlob(filepath, buffer)` → Promise<void> — PUT to WebDAV server at resolved path via `adapter.putFileContents()`
       - `downloadBlob(filepath)` → Promise<Buffer | null> — GET via `adapter.getFileContents()`; returns null if 404
       - `deleteBlob(filepath)` → Promise<void> — DELETE via `adapter.deleteFile()`; idempotent for missing resources
       - `headBlob(filepath)` → Promise<{ contentLength: number, contentType: string } | null> — HEAD via `adapter.getFileMetadata()`; maps `mime → contentType`
       - `listOrphanedKeys()` → Promise<string[]> — returns `[]` (no orphan tracking in WebDAV)
     - Path resolution: `file_node_id` → guard via `fileNodeService.getNode(nodeId)` (returns null if missing) → reconstruct display path via `fileNodeService.getNodePath(nodeId)` → pass to adapter methods
     - Factory dispatch logic: `createBlobStore()` (parameterless, reads `process.env.WEA_FILE_STORAGE || 's3'`) → `webdav` → `new WebdavBlobStore(createFileStoreAdapter())`; `s3` → `new S3BlobStore(resolveS3Config())`

  3. New Section 4 — Dual-Backend Dispatch Table (service-level methods, not adapter methods):
     | Operation | S3 Mode | WebDAV Mode |
     |-----------|---------|-------------|
     | prepareUpload(fileNodeId) | upsert pending object_map → return s3Key | returns `null` (synchronous) |
     | completeUpload(s3Key, size, mimeType) | getObjectMapByS3Key → activate → upsertCache | throws `'completeUpload is not applicable in WebDAV mode'` |
     | downloadBlob(fileNodeId) | active s3_key → `blobStore.downloadBlob(key)` | delegates to `downloadBlobWebdav(fileNodeId)` |
     | overwriteBlob(fileNodeId, buffer) | orphan old, upload new, insert active | delegates to `uploadToWebdav(fileNodeId, buffer)` |
     | deleteBlob(fileNodeId) | orphan current active | resolve path (guard node), `blobStore.deleteBlob(path)` |
     | getActiveS3Key(fileNodeId) | active s3_key or null | always `null` |
     | countActiveObjectsByS3Key(s3Key) | `fileNodesStore.countActiveObjectsByS3Key` | returns `0` |
     | duplicateBlob(sourceS3Key) | `blobStore.copyBlob(source, newKey)` → newKey | throws `'duplicateBlob is not applicable in WebDAV mode'` |
     | linkObject(fileNodeId, s3Key) | `fileNodesStore.insertObject(fileNodeId, s3Key, 'active')` | throws `'linkObject is not applicable in WebDAV mode'` |
     | ensureExclusiveBlob(fileNodeId) | if count>1: duplicate + orphan + insert active → newKey | returns `null` |
     | uploadToWebdav(fileNodeId, buffer, mimeType) | n/a | resolve path → `blobStore.uploadBlob(path, buffer)` → `upsertCache(...)` |
     | downloadBlobWebdav(fileNodeId) | n/a | guard node → `blobStore.downloadBlob(path)` or null |

  4. Update Section 5 — Error Cases: Add WebDAV-specific errors (connection refused, timeout, 404 on remote). WebDAV path resolution guards on `fileNodeService.getNode(nodeId)` — returns null when node is missing. WebDAV errors during file metadata operations set `sync_status='orphaned_node'` rather than throwing.

- **Key Content:**
  - `WebdavBlobStore` uses the S3-uniform interface (`uploadBlob/downloadBlob/deleteBlob/headBlob/listOrphanedKeys`) — constructed with a file-store adapter from `createFileStoreAdapter()` (D1)
  - The factory at `infrastructure/adapters/blobstore/index.js` is parameterless; reads `process.env.WEA_FILE_STORAGE` (D2)
  - `NoOpBlobStore` is removed — webdav mode returns a real `WebdavBlobStore` instance
  - No behavioral change for S3 mode — all existing tests continue passing

- **Verification:** Spec contains Section 3 (WebDAV Mode) with interface definition, Section 4 (Dispatch Table), updated factory signature. Existing verification checklist items in Section 2.7 remain valid for S3 mode.

---

### W1.0-3: batchOperationService.md

- **Path:** `docs/spec/server/services/batchOperationService.md`
- **Action:** CREATE
- **Sections Required:**
  1. Overview — nodeId-based batch operations replacing path-based bulk workers; async permission gates replace sync checkers; per-item operations delegate to `fileService` so subtree/closure-table handling stays in one place
  2. Factory Function Signature — `createBatchOperationService({ fileNodeService, fileService, aclService })`
  3. Methods:
     - `batchDelete(nodeIds, userId)` — async write permission per top-level nodeId, then delegate to `fileService.deleteNode(nodeId, userId, user)` (which enumerates descendants via `getDescendantIds` and deletes through `fileNodeService.deleteNode`); returns `{ deletedCount, errors[] }`
     - `batchMove(moves[], userId)` — each move = `{ sourceNodeId, destinationParentNodeId }`; async write permission on source and dest parent; `fileService.moveNode(sourceNodeId, destinationParentNodeId, userId, user)` per item; returns `{ movedCount, errors[] }`
     - `batchCopy(copies[], userId)` — copy semantics delegated to `fileService.copyFile(sourceNodeId, destinationParentNodeId, userId, user)`: S3 mode copy-on-write (new `file_nodes` + `object_map` referencing SAME `s3_key` unless shared, then duplicated); WebDAV mode actual blob copy; async permission checks on source read and destination write; returns `{ copiedCount, errors[] }`
  4. Permission Gate Strategy — all checks are async (`aclService.checkFolderPermission(userId, nodeId, 'write')` / `aclService.checkFilePermission(userId, nodeId, 'read'|'write')`) instead of sync checker functions from pre-Phase 3 code. No `buildSync*Checker` calls remain.
  5. Closure Table Awareness — `fileService.deleteNode`/`moveNode` handle `node_ancestors` internally (`getDescendantIds`, `fileNodeService.moveNode` rebuild). The batch service does not duplicate ancestry logic.
  6. Worker Integration — the existing job system is preserved: `opStore.createJob(...)` + `scheduleBulkWorker(jobId)` create jobs, and `runBulkJobWorker(jobId)` becomes a thin dispatcher that reads `job.payload.nodeIds`/`moves`/`copies` and calls `createBatchOperationService(...)` methods per item, writing progress via the operation-progress store. Payloads are nodeId-only (no path fields).
  7. Error Cases — partial failures: operations that pass permission checks but fail at storage layer are recorded in `errors[]` with nodeId and reason; transaction rolled back per-item, not all-or-nothing
  8. Verification Scenarios

- **Key Content:**
  - Copy-on-write for S3: `fileService.copyFile` creates a new file_node + object_map row; if the source blob is exclusively owned, both rows reference the SAME s3_key (zero-copy); if already shared, `blobStorageService.duplicateBlob` splits it before linking (Phase 4 Task 4.7)
  - Delete semantics: `fileService.deleteNode` uses `getDescendantIds()` for subtree enumeration, then `fileNodeService.deleteNode()`; CASCADE on `file_nodes.id` removes `object_map`, `filecache`, `node_ancestors` rows automatically via FK constraints
  - No path-based payloads: `resolvePathsToNodeIds` backward-compat helper is NOT included — server accepts nodeId exclusively (PLAN.md Rule 13)
  - No sync checker usage anywhere — all `buildSync*Checker` references eliminated (Task 4.8d dependency)

- **Verification:** Spec file exists with all 7 sections. Copy semantics clearly distinguish S3 vs WebDAV modes. Permission gate strategy explicitly rejects sync checkers.

---

### W1.0-4: downloadService.md

- **Path:** `docs/spec/server/services/downloadService.md`
- **Action:** CREATE
- **Sections Required:**
  1. Overview — nodeId-based multi-file ZIP download with async permission checks per file; replaces path-based `selectiveDownload.js` where paths are resolved to nodeIds before entering service
  2. Factory Function Signature — `createDownloadService({ fileNodeService, blobStorageService, aclService })`
  3. Methods:
     - `downloadMultiple(nodeIds, userId, user)` → `{ zipStream, totalFiles, downloadId }` — assembles ZIP archive from multiple files; async permission check per nodeId before including in ZIP; progress tracking via `downloadId`
     - `getDownloadProgress(downloadId)` → `{ completed, total, percentage }` — reads from operation progress store (in-memory Map or future Redis)
  4. Permission Check Per File — for each nodeId in input, call `aclService.checkFolderPermission(userId, nodeId, 'read')` asynchronously; files failing permission check are excluded from ZIP with entry in `errors[]`; if ALL fail, return 403
  5. ZIP Assembly Flow — iterate nodeIds → resolve active object_map per nodeId → stream blob content into archiver (JSZip or similar) → pipe to response; for each file, include display name from `file_nodes.name`
  6. Progress Tracking — write progress entries keyed by `downloadId`; pollable via GET endpoint; TTL-based cleanup after completion
  7. Error Cases — nodeId not found → skip with error entry; blob download fails → record in errors[]; permission denied for all → 403 response

- **Key Content:**
  - No sync checker usage: all permission gates are `await aclService.checkFolderPermission(userId, nodeId, 'read')`
  - ZIP assembly is streaming — does not buffer entire archive in memory
  - For S3 mode, blobs retrieved via `blobStorageService.downloadBlob(nodeId)` → follows object_map → s3_key chain
  - For WebDAV mode, blobs retrieved via `blobStorageService.downloadBlob(nodeId)` → path resolved from nodeId via fileNodeService
  - **Implementation is Task W4.2 (Wave 4)**: current `downloadService.js` is an Express-style `downloadMultiple(req, res, opStore)` module; W4.2 rewrites it into this `createDownloadService` factory and integrates progress via `operationProgress` store (`setDownloadProgress`/`getDownloadProgress`)

- **Verification:** Spec file exists with all 7 sections. Permission check per file is async (not sync). ZIP assembly flow describes streaming approach. Error cases cover partial failures.

---

### W1.0-5: files.md (route updates)

- **Path:** `docs/spec/server/routes/files.md`
- **Action:** UPDATE — add Section 3 "Phase 4 nodeId Contracts" and update existing sections
- **Sections to Add/Modify:**

  1. New Section 3 — Phase 4 nodeId Contracts: **All endpoints accept `nodeId` exclusively.** Path strings are display-only (responses) and are never accepted in request payloads (PLAN.md Rule 13 — no backward-compat layer). Response objects include `nodeId` field for every file/folder entry.

  2. Updated Route List with nodeId contracts:

     | Method | Path | Request Payload (nodeId only) | Response |
     |--------|------|------------------------------|----------|
     | GET `/list` | Query: `nodeId` (required) | `?nodeId=5`; missing/invalid → 400 | Each item: `{ nodeId, display_path, ... }` |
     | GET `/download` | Query: `nodeId` (required) | `?nodeId=5`; 404 if not found | File buffer + `X-Node-ID` header |
     | POST `/upload` | multipart + `parentNodeId` | `parentNodeId` + file field; overwrite via `onConflict: 'overwrite'` against `(parent_id, name)` | `{ nodeId, display_path }`; `{ nodeId, skipped: true }` for skip |
     | PUT `/rename` | Body: `{ nodeId, newName }` | `sourceNodeId` replaced by `nodeId` | `{ nodeId, new_display_path }` |
     | POST `/move` | Body: `{ nodeId, destinationParentNodeId }` | Single-item move (new route) | `{ nodeId, new_display_path }` |
     | POST `/copy` | Body: `{ nodeId, destinationParentNodeId, newName? }` | Single-item copy (new route); S3 = copy-on-write | `{ nodeId, display_path }` |
     | DELETE `/delete` | Body: `{ nodeId }` | Single-item delete (new route) | `{ deletedCount }` |
     | POST `/batch-move` | Body: `{ moves[] }` | moves = `{ sourceNodeId, destinationParentNodeId }` | jobId; results keyed by nodeId |
     | POST `/batch-copy` | Body: `{ copies[] }` | copies = `{ sourceNodeId, destinationParentNodeId, newName? }` | jobId; results keyed by nodeId |
     | POST `/batch-delete` | Body: `{ nodeIds[] }` | `nodeIds` array (no `paths`) | jobId; deleted nodeIds |
     | POST `/download-multiple` | Body: `{ nodeIds[], downloadId }` | `nodeIds` array (no `paths`) | Unchanged |

  3. Updated Route Module Mapping — note which route file handles each endpoint after Phase 4:
     - `crud.js`: list, download, upload, rename, move, copy, delete, check-conflicts, metadata
     - `batch.js`: batch-move, batch-copy, batch-delete, bulk-operation/:jobId, cancel
     - `preview.js`: preview-ticket, preview-stream, download-multiple, download-progress, thumbnail, thumbnails/batch

  4. folders.js Updates — `POST /create` accepts `{ parentNodeId, name }`; response includes created node's `nodeId` + `display_path`. `GET /stats` accepts `nodeId` query param. Both endpoints are nodeId-only.

  5. Middleware Removal — `normalizePathParam` middleware is deleted in Task 4.8. Routes validate `nodeId`/`parentNodeId` as positive integers (400 on missing/invalid).

- **Key Content:**
  - All response objects that represent files/folders include `{ nodeId: number, display_path: string }` at minimum
  - Path strings in responses are display-only — not used as primary identifiers
  - Route handlers delegate to `fileService` (Task 4.1) instead of calling WebDAV directly
  - No `resolvePath`/path fallback anywhere in route handlers — nodeId is mandatory

- **Verification:** Spec updated with Section 3 covering all route modules. Each endpoint has a nodeId-only request/response contract. Direct move/copy/delete routes defined. No "backward compatibility" / path-fallback language remains.

---

### W1.0-6: permissionPolicy.md (Tier removal)

- **Path:** `docs/spec/server/utils/permissionPolicy.md`
- **Action:** UPDATE — document removal of Tiers 2 and 3; retain only Tier 1
- **Sections to Modify/Add:**

  1. Update Section 1 Overview — current state reflects Phase 3 completion: nodeId-based functions are primary. Add note that path-based compat layer (Tier 2) and sync checker builders (Tier 3) are scheduled for removal in Phase 4 Tasks 4.8d-4.8f.

  2. New Section 2 — Tier Classification (Pre-Removal):
     - **Tier 1 (Retained):** nodeId-based functions only: `canReadNode(userId, nodeId)`, `canWriteNode(userId, nodeId)`, `isAdminUser(user)`
     - **Tier 2 (Removing in Task 4.8d):** path-based compat layer — `canReadFolder(principalId, folderPath)`, `canReadFile(principalId, filePath)`, `canWriteFolder(user, folderPath)`, `canWriteFileByParent(user, filePath)`, `hasDirectFolderPermission(userId, folderPath)`
     - **Tier 3 (Removing in Task 4.8d):** sync checker builders — `buildSyncWriteChecker(user, doc)`, `buildSyncReadChecker(user, doc)`, `buildSyncReadFileChecker(user, doc)`, `buildSyncWriteFileByParentChecker(user, doc)`

  3. New Section 3 — Callers That Must Migrate Before Removal:
     | Tier 2 Function | Current Callers | Migration Target | Phase 4 Task |
     |-----------------|-----------------|------------------|--------------|
     | `canReadFolder` | fileService.listDirectoryWithPermissions, downloadService.downloadMultiple | `aclService.checkFolderPermission(userId, nodeId, 'read')` | 4.1, 4.6 |
     | `canWriteFolder` | batchOperationService.batchMove, batchOperationService.batchDelete | `aclService.checkFolderPermission(userId, nodeId, 'write')` | 4.6 |
      | `canReadFile` | fileService.downloadFile | `aclService.checkFilePermission(userId, nodeId, 'read')` | 4.1 |
     | `buildSyncWriteChecker` | batchOperationService (pre-migration) | async gate per item | 4.8c |
     | `buildSyncReadChecker` | downloadService (pre-migration) | async gate per file | 4.6 |

  4. New Section 4 — Post-Removal State: After Tasks 4.8d-4.8g, `permissionPolicy.js` contains only Tier 1 functions + re-exports from `ownerNodeResolver`, `inheritancePolicy`, `permissionRank`. Expected line count reduction from ~307 to ~100 lines.

- **Key Content:**
  - Removal is safe only after ALL callers in the table above have migrated to async nodeId checks
  - Tasks 4.8c (fileService sync→async), 4.6 (batchOperationService, downloadService) must complete before 4.8d can remove Tier 2/3

- **Verification:** Spec contains Tier Classification table with all current callers listed. Post-Removal State section defines expected final shape of `permissionPolicy.js`. Caller migration table maps each function to its Phase 4 task.

---

### W1.0-7: permissionService.md (client)

- **Path:** `docs/spec/client/services/permissionService.md`
- **Action:** CREATE (if not exists) / UPDATE (if exists)
- **Sections Required:**
  1. Overview — client-side permission service; sends nodeId payloads to server endpoints; no path-based lookups
  2. Methods:
     - `getUserPermissions(userId)` → GET `/permissions/user/:userId`; returns array of `{ fileNodeId, permission }` objects (no `folderPath`)
     - `getFolderPermissions(nodeId, fileNodeId?)` → GET `/permissions/folder?nodeId=...` (+ optional `fileNodeId`); replaces `path` and `includeSubfolders` params; server handles inheritance via closure table automatically
     - `grantPermission({ userId, nodeId, permission, target? })` → POST `/permissions/grant`; body contains `userId`, `nodeId`, `permission`, optional `target`; no `folderPath`, no `includeSubfolders`
     - `revokePermission({ userId, nodeId, scope? })` → DELETE `/permissions/revoke?userId=...&nodeId=...`; no `includeSubfolders` param; server handles descendant permissions via closure table or FK CASCADE
     - `checkPermission(nodeId)` → GET `/permissions/check?nodeId=...`; replaces path-based check
     - `listFilePermissions(parentNodeId?)` → GET `/permissions/file/list?parentNodeId=...`; optional parent nodeId scope filter
  3. Cache Invalidation — grant/revoke invalidate getUserPermissions cache for affected userId (unchanged from current behavior)
  4. Removed Parameters — `includeSubfolders`, `folderPath`/`filePath`/`path` as request identifiers; all replaced by `nodeId`/`parentNodeId` (permission route contracts were already nodeId-based in Phase 3; client params must match them exactly)

- **Key Content:**
  - `includeSubfolders` removal: server handles permission inheritance via closure table automatically; client no longer sends this parameter
  - Payload shape change: `{ folderPath: '/a/b' }` → `{ nodeId: 123 }`
  - Response shape change: `{ folderPath, permission }` → `{ fileNodeId, nodeId, display_path, permission }`

- **Verification:** Spec exists with all methods documented using nodeId payloads. `includeSubfolders` explicitly marked as removed. Cache invalidation behavior preserved from current implementation.

---

### W1.0-8: buildPermissionDiff.md (client update)

- **Path:** `docs/spec/client/utils/buildPermissionDiff.md`
- **Action:** UPDATE — migrate to nodeId-based Maps
- **Sections to Modify:**

  1. Update Overview — diff computation now operates on nodeId-keyed permission maps instead of path-string maps
  2. Input Format Change — input arrays use `{ fileNodeId, userId, permission }` tuples; no `folderPath` field
  3. Output Format — returns `{ added: [{ fileNodeId, userId, permission }]`, removed: [...], unchanged: [...] } keyed by nodeId
  4. Removed Functionality — `collectSubfolderPaths()` is eliminated; inheritance handled server-side via closure table

- **Verification:** Spec documents nodeId-based input/output format. `collectSubfolderPaths` explicitly marked removed.

---

## Task W1.1: Test Scaffolds

### W1.1-1: WebdavBlobStore.test.js

- **Path:** `server/infrastructure/adapters/blobstore/__tests__/WebdavBlobStore.test.js`
- **Action:** CREATE
- **describe() blocks:** [RECTIFIED: D1] S3-uniform method names, adapter-shaped mock

  ```
  describe('WebdavBlobStore', setup with jest.resetModules + adapter mock)
    describe('uploadBlob', test PUT via adapter.putFileContents)
      it('uploads buffer to WebDAV path via putFileContents successfully')
      it('throws descriptive error for empty/null/undefined filepath')
      it('throws descriptive error for null or empty buffer')
      it('propagates WebDAV server errors with original message')
    describe('downloadBlob', test GET via adapter.getFileContents)
      it('retrieves content and returns Buffer')
      it('returns null for 404 (file not found)')
      it('throws on non-404 HTTP errors')
    describe('deleteBlob', test DELETE via adapter.deleteFile)
      it('deletes resource successfully')
      it('is idempotent for already-deleted resources (404 → no throw)')
      it('propagates server errors')
    describe('headBlob', test HEAD via adapter.getFileMetadata)
      it('returns { contentLength, contentType } mapping mime->contentType')
      it('returns null for 404')
      it('throws on non-404 HTTP errors')
  ```

- **Mock factories needed:**
  - `createAdapterMock(overrides)` — returns `{ putFileContents, getFileContents, deleteFile, getFileMetadata }` with jest.fn() defaults
  - Do NOT `jest.mock('../../../../utils/webdav')` — the adapter mock replaces raw webdav
  - Each test resets mocks via `beforeEach(jest.clearAllMocks)`

- **Verification:** `npm run test -w server -- --testPathPatterns="WebdavBlobStore" --no-coverage` — all 13 tests fail initially (implementation doesn't exist), confirming scaffold is wired correctly.

---

### W1.1-2: fileService.test.js

- **Path:** `server/domains/files/services/__tests__/fileService.test.js`
- **Action:** CREATE
- **describe() blocks:**

  ```
  describe('fileService', setup with mock factories for fileNodeService, blobStorageService, uploadService, aclService)
    describe('listDirectoryWithPermissions')
      it('returns children with nodeId and permission flags for given parentId')
      it('includes size and mimeType from filecache LEFT JOIN')
      it('sets hasReadPermission=false when user lacks read access on child node')
      it('admin user bypass: all items return hasRead=true, hasWrite=true regardless of permissions')
      it('returns empty array for leaf directory (no children)')
      it('throws 404-style error when parent nodeId does not exist')

    describe('uploadFile — S3 mode')
      it('creates file_node via uploadService.uploadFile and returns new nodeId')
      it('sets sync_status=active on successful upload')
      it('marks sync_status=pending_upload if TX1 succeeds but blob upload fails')
      it('rolls back file_nodes row if createNode throws in TX1')

    describe('uploadFile — WebDAV mode')
      it('creates file_node and performs synchronous WebDAV PUT in single flow')
      it('marks sync_status=orphaned_node if WebDAV PUT fails after DB commit')

    describe('downloadFile')
      it('returns buffer for S3 mode via blobStorageService.downloadBlob')
      it('returns buffer for WebDAV mode via webdav path resolution')
      it('returns null when no active object_map entry exists')
      it('throws permission denied if user lacks read access (non-admin)')

    describe('renameNode')
      it('updates name in file_nodes DB only for S3 mode (no storage operation)')
      it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure')
      it('throws if newName is empty or contains invalid characters')
      it('throws if new name conflicts with existing sibling node')

    describe('moveNode')
      it('updates parent_id and rebuilds closure table via fileNodeService.moveNode')
      it('no storage operation for S3 mode (blob stays at same s3_key)')
      it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure')
      it('rejects move that would create a cycle (target is descendant of source)')

    describe('deleteNode')
      it('deletes leaf node via fileNodeService.deleteNode after write-permission gate')
      it('enumerates descendants via getDescendantIds for directory nodes')
      it('WebDAV mode: storage DELETE bottom-up, marks orphaned_node on per-node failure, DB delete proceeds')
      it('S3 mode: DB-only deletion, no blobStorageService calls')

    describe('copyFile — S3 mode')
      it('zero-copy: new file_node + object_map row referencing same s3_key when blob not shared')
      it('duplicates blob to new key via blobStorageService.duplicateBlob when source blob is shared')
      it('checks read on source and write on destination parent before copying')

    describe('copyFile — WebDAV mode')
      it('performs actual blob copy (download + uploadToWebdav) into destination parent')
  ```

- **Mock factories needed:**
  - `fileNodeService` mock: `createFile`, `createDirectory`, `renameNode`, `moveNode`, `deleteNode`, `listDirectory`, `getNodePath`, `getDescendantIds`, `updateSyncStatus` — each as independent Jest mock functions
  - `blobStorageService` mock: `downloadBlob`, `prepareUpload`, `completeUpload`, `overwriteBlob`, `deleteBlob`, `uploadToWebdav`, `getActiveS3Key`, `duplicateBlob`, `linkObject` — matching dual-backend interface
  - `uploadService` mock: `uploadFile`, `overwriteFile`, `downloadFile`
  - `aclService` mock: `checkFolderPermission(userId, nodeId, perm)`, `checkFilePermission(userId, nodeId, perm)`, `isAdminUser(user)` — returning configurable values per call

- **Verification:** `npm run test -w server -- --testPathPatterns="fileService"` — all 33 tests fail. The scaffold was rewritten to import the real `createFileService` factory (see Hypothesis Revision 1); it fails because the current factory does not yet expose the new nodeId methods.

---

### W1.1-3: files.test.js (route integration update plan)

- **Path:** `server/domains/files/routes/__tests__/files.test.js`
- **Action:** UPDATE PLAN — document what changes relative to current test file
- **Current State Analysis** (from reading existing file):
  - Uses WebDAV mock via `jest.mock('../../../../utils/webdav')`
  - Tests are path-based: queries use `{ path: '/username/...' }`, bodies send `oldPath`, `sourcePath`, etc.
  - Describe blocks covering list, download, preview-ticket, preview-stream, batch-move, upload, batch-delete, batch-copy, bulk-operation, rename, check-conflicts, metadata, download-multiple, cancel

- **Required Changes (nodeId-exclusive — PLAN.md Rule 13):**
  1. Replace the WebDAV mock with mocked `fileNodeService` + `blobStorageService` + `aclService` + `uploadService` injected via the **composition root** (`server/service/composition.js`, built in W3.6). Routes read services from the composition root, so tests override it with mocks.
  2. Rewrite all payloads to nodeId:
     - `GET /list?nodeId=5`
     - `GET /download?nodeId=5`
     - `PUT /rename` body `{ nodeId: 5, newName: 'x' }`
     - `POST /upload` multipart with `parentNodeId`
     - `POST /move` body `{ nodeId, destinationParentNodeId }`
     - `POST /copy` body `{ nodeId, destinationParentNodeId }`
     - `DELETE /delete` body `{ nodeId }`
     - `POST /batch-delete` body `{ nodeIds: [1, 2, 3] }`
     - `POST /batch-move` / `POST /batch-copy` bodies with `sourceNodeId`/`destinationParentNodeId` in each item
     - `POST /download-multiple` body `{ nodeIds: [...] }`
  3. Response assertions check for `nodeId` (and `display_path`) in returned objects
  4. **All path-based tests are removed** (no regression guard for path payloads — routes no longer accept them)

- **Endpoints requiring nodeId test coverage:**
  | Endpoint | nodeId Test |
  |----------|-------------|
  | GET /list | `?nodeId=5` returns items with nodeId; missing nodeId → 400 |
  | GET /download | `?nodeId=5` returns buffer + X-Node-ID |
  | POST /upload | multipart + `parentNodeId`; overwrite via `onConflict` |
  | PUT /rename | `{ nodeId, newName }` |
  | POST /move | `{ nodeId, destinationParentNodeId }` |
  | POST /copy | `{ nodeId, destinationParentNodeId, newName? }` |
  | DELETE /delete | `{ nodeId }` |
  | POST /batch-move / batch-copy | nodeId-based moves/copies |
  | POST /batch-delete | `nodeIds[]` |
  | POST /download-multiple | `nodeIds[]` |

- **Mock factories needed:** Same as W1.1-2 plus Supertest-compatible app initialization with the composition root overridden by mocks (`jest.mock('server/service/composition')` or a test override setter).

- **Verification:** `npm run test:integration -w server -- --testPathPatterns="files.test"` — all nodeId route tests pass; zero path-based tests remain.

---

### W1.1-4: permissionService.test.js (client update plan)

- **Path:** `client/src/services/__tests__/permissionService.test.js`
- **Action:** UPDATE PLAN — document fixture and test changes
- **Current State Analysis** (from reading existing file):
  - Mocks `apiClient.get`, `apiClient.post`, `apiClient.del`
  - Tests use path-based fixtures: `{ folderPath: '/a', permission: 'read' }`, calls with `folderPath: '/docs'`
  - Covers getUserPermissions, getFolderPermissions (with includeSubfolders), grantPermission, revokePermission, checkPermission, listFilePermissions

- **Required Changes:**
  1. Fixtures change from path-based to nodeId-based:
     - `{ folderPath: '/a', permission: 'read' }` → `{ fileNodeId: 42, permission: 'read' }`
     - Grant call: `{ userId: 'u1', folderPath: '/a', permission: 'read' }` → `{ userId: 'u1', fileNodeId: 42, permission: 'read' }`
     - Revoke call: `{ userId: 'u1', folderPath: '/a', includeSubfolders: false }` → `{ userId: 'u1', fileNodeId: 42 }` (no includeSubfolders)

  2. Remove tests that exercise `includeSubfolders`:
     - `getFolderPermissions('/docs', true, ...)` test — remove or replace with nodeId-only variant
     - Any revoke test sending `includeSubfolders` param

  3. Add new scenarios:
     - Grant sends `fileNodeId` in POST body (no `folderPath`)
     - Revoke sends `fileNodeId` in query params (no `includeSubfolders`)
     - Check permission sends `nodeId` instead of `path`
     - Response objects include `nodeId` field

- **New describe blocks:**
  ```
  describe('permissionService — nodeId mode')
    describe('grantPermission with fileNodeId')
      it('sends POST /permissions/grant with userId, fileNodeId, permission (no folderPath)')
      it('invalidates user cache after successful grant by fileNodeId')
    describe('revokePermission with fileNodeId')
      it('sends DELETE /permissions/revoke with userId and fileNodeId params (no includeSubfolders)')
      it('invalidates user cache after successful revoke')
    describe('checkPermission with nodeId')
      it('returns object with hasRead, hasWrite, source using nodeId param')
  ```

- **Mock factories needed:** Same `apiClient` mocks as current test. No new mock infrastructure required — only fixture data changes.

- **Verification:** `npm run test:ci -w client -- --testPathPatterns="permissionService"` — nodeId tests fail until the client permission service is migrated (W4.10/W4.7); path-based cases are rewritten, not kept as regression guards.

---

### W1.1-5: batchOperationService.test.js

- **Path:** `server/domains/files/services/__tests__/batchOperationService.test.js`
- **Action:** CREATE
- **describe() blocks:**

  ```
  describe('batchOperationService', setup with mock fileNodeService, blobStorageService, aclService)
    describe('batchDelete')
      it('deletes single node successfully')
      it('deletes multiple nodes in sequence')
      it('checks async write permission for each top-level nodeId before deletion')
      it('skips nodes where user lacks delete permission and records error')
      it('removes descendants via closure table (getDescendantIds) for directory nodes')
      it('returns { deletedCount, errors[] } with correct counts after partial failure')
      it('handles empty nodeIds array gracefully (no-op, returns 0 count)')

    describe('batchMove')
      it('moves single node to new parent successfully')
      it('moves multiple nodes independently')
      it('checks async write permission on source and destination parent for each move')
      it('rejects moves that would create a cycle (target is descendant of source)')
      it('records per-item errors without aborting remaining operations')
      it('returns { movedCount, errors[] } with correct counts')

    describe('batchCopy — S3 mode')
      it('creates new file_node pointing to same s3_key (copy-on-write)')
      it('creates new object_map entry referencing original s3_key')
      it('checks async read permission on source and write permission on destination parent')
      it('returns { copiedCount, errors[] } with correct counts')

    describe('batchCopy — WebDAV mode')
      it('performs actual blob copy via blobStorageService for each file')
      it('creates new file_node + object_map entry with new webdav path')
  ```

- **Mock factories needed:**
  - `fileNodeService` mock: `createFile`, `moveNode`, `deleteNode`, `getDescendantIds`, `getNodePath`, `copyFile` — configurable return values per call (batch delegates to fileService per W1.0-3)
  - `blobStorageService` mock: `downloadBlob`, `uploadToWebdav`, `duplicateBlob` (for WebDAV/S3 copy modes)
  - `aclService` mock: `checkFolderPermission(userId, nodeId, perm)`, `checkFilePermission(userId, nodeId, perm)` — returns true/false per configured nodeId

- **Verification:** `npm run test -w server -- --testPathPatterns="batchOperationService"` — all 19 tests fail initially (`createBatchOperationService` is not yet exported by the real module).

---

### W1.1-6: downloadService.test.js

- **Path:** `server/domains/files/services/__tests__/downloadService.test.js`
- **Action:** CREATE
- **describe() blocks:**

  ```
  describe('downloadService', setup with mock fileNodeService, blobStorageService, aclService)
    describe('downloadMultiple')
      it('assembles ZIP stream for valid nodeIds with read permission')
      it('excludes files where user lacks read permission and records in errors[]')
      it('returns 403-style error when ALL files fail permission check')
      it('performs async permission check per file (not sync checker)')
      it('resolves blob content via correct backend (S3: object_map→s3_key; WebDAV: path resolution)')
      it('generates downloadId for progress tracking')
      it('streams ZIP without buffering entire archive in memory')

    describe('getDownloadProgress')
      it('returns { completed, total, percentage } for active downloadId')
      it('returns null for expired/unknown downloadId')
  ```

- **Mock factories needed:** Same as batchOperationService plus mock archiver (JSZip or similar) to verify streaming behavior. Mock `blobStorageService.downloadBlob` to return deterministic buffers per nodeId.

- **Verification:** `npm run test -w server -- --testPathPatterns="downloadService"` — all ~9 tests fail initially.

---

### W1.1-7: blobstoreFactory.test.js (WebDAV dispatch)

- **Path:** `server/infrastructure/adapters/blobstore/__tests__/blobstoreFactory.test.js`
- **Action:** UPDATE — add WebDAV factory test cases to existing file
- **Current State** (from glob results): File exists, tests S3BlobStore factory resolution.

- **Required New Test Cases:** [RECTIFIED: D2] Parameterless factory, env-based dispatch

  ```
  describe('createBlobStore — WebDAV mode')
    it('returns WebdavBlobStore instance when WEA_FILE_STORAGE=webdav')
    it('returns S3BlobStore instance when WEA_FILE_STORAGE=s3 (existing behavior preserved)')
    it('defaults to S3BlobStore when WEA_FILE_STORAGE is empty or undefined')
  ```

  Note: The old test `'throws clear error when WEA_FILE_STORAGE=webdav but no webdavClient provided'` is REMOVED — the factory is parameterless and creates the adapter internally via `createFileStoreAdapter()`.

- **Verification:** `npm run test -w server -- --testPathPatterns="blobstoreFactory" --no-coverage` — existing tests pass, new WebDAV tests pass after factory is updated (D2).

---

### W1.1-8: test-utils additions plan

- **Path:** `server/test-utils.js`
- **Action:** UPDATE PLAN — document new helper functions to add
- **New Helper Functions:**

  ```js
  // Create a file node in the test database, returns { nodeId, parentId }
  async function createTestFileNode({ database, name, type = 'file', parentId = null }) {
    /* INSERT into file_nodes; return row */
  }

  // Grant permission by nodeId (replaces path-based grant)
  async function grantTestPermissionByNodeId({ database, userId, fileNodeId, permission = 'read' }) {
    /* INSERT into permissions_user_paths (user_id, file_node_id, permission) — matches permissionStore schema, 3 data columns */
  }

  // Create object_map entry for a node (for S3 mode tests)
  async function createTestObjectMapEntry({ database, fileNodeId, s3Key, status = 'active' }) {
    /* INSERT into object_map */
  }

  // Build ancestor chain for a node (closes closure table)
  async function buildAncestorsForTestNode({ database, nodeId, parentId }) {
    /* INSERT into node_ancestors for self + all ancestors up to root */
  }
  ```

- **Verification:** Helpers are importable from `test-utils.js` and callable from new test scaffolds. No behavioral change to existing helpers.

---

## Plan Update Guide

### How to Update This Document During Execution

1. When a spec is written: check off the verification item and note any design decisions that emerged
2. When a test scaffold reveals a gap in the spec: record it in the "Hypothesis Revisions" section below
3. If a task scope changes (new method discovered, API contract change): update the relevant section and add a note in "Execution Log"

### Execution Log Template

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-08-01 | W1.0-1 fileService.md | ✅ Done | Created with all 7 sections; factory signature + method contracts documented |
| 2026-08-01 | W1.0-2 blobStorageService.md (WebDAV section) | ✅ Done | Added Section 3 (WebDAV Mode), Section 4 (Dispatch Table), updated factory signature |
| 2026-08-01 | W1.0-3 batchOperationService.md | ✅ Done | Created with all 7 sections; async permission gates, closure table awareness documented |
| 2026-08-01 | W1.0-4 downloadService.md | ☑️ Done | Created with all 7 sections; streaming ZIP assembly, per-file async permission checks |
| 2026-08-01 | W1.0-5 files.md (route updates) | ✅ Done | Added Section 3 (Phase 4 nodeId Contracts); route table updated to nodeId-only payloads |
| 2026-08-01 | W1.0-6 permissionPolicy.md (Tier removal) | ✅ Done | Added Tier Classification, Caller Migration table, Post-Removal State sections |
| 2026-08-01 | W1.0-7 permissionService.md (client) | ✅ Done | Updated signatures to nodeId-based; added Removed Parameters section with shape change tables |
| 2026-08-01 | W1.0-8 buildPermissionDiff.md (client update) | ✅ Done | Migrated from path-string Maps to nodeId-based Maps; collectSubfolderPaths marked removed |
| 2026-08-01 | W1.1-1 WebdavBlobStore.test.js | ✅ Done | 13 test cases across 4 describe blocks; all fail with module-not-found (expected) |
| 2026-08-01 | W1.1-2 fileService.test.js | ✅ Done | 33 test cases across 9 describe blocks; rewritten to import the real `createFileService` factory (Revision 1); all 33 fail until Wave 2 implements the nodeId contract |
| 2026-08-01 | W1.1-3 files.test.js update plan | ✅ Done (계획만, 코드 미생성) | Document created at docs/spec/server/routes/files-test-plan.md with full endpoint coverage table |
| 2026-08-01 | W1.1-4 permissionService.test.js update plan | ✅ Done (계획만, 코드 미생성) | Document created at docs/spec/client/services/permissionService-test-plan.md; fixture changes and new describe blocks specified |
| 2026-08-01 | W1.1-5 batchOperationService.test.js | ✅ Done | 19 test cases across 4 describe blocks (batchDelete, batchMove, batchCopy S3/WebDAV); rewritten to import the real `createBatchOperationService` factory (Revision 1); all 19 fail until Wave 2 exports it |
| 2026-08-01 | W1.1-6 downloadService.test.js | ✅ Done | 9 test cases across 2 describe blocks; all fail with createDownloadService not found (expected) |
| 2026-08-01 | W1.1-7 blobstoreFactory.test.js update | ✅ Done | Added WebDAV mode describe block with 4 new tests; existing S3 tests preserved |
| 2026-08-01 | W1.1-8 test-utils additions plan | ✅ Done (계획만, 코드 미생성) | Document created at docs/spec/server/test-utils-additions-plan.md with 4 helper specs |

### Hypothesis Revisions Template

```
## Revision [N]: [Date]
**Assumption:** [what was assumed]
**Evidence:** [what observation contradicted it]
**Revised Understanding:** [new conclusion]
**Affected Tasks:** [list of W1.x tasks impacted]
```

## Revision 1: 2026-08-01
**Assumption:** The `fileService.test.js` and `batchOperationService.test.js` scaffolds imported the real service factories and failed on the missing nodeId contract, confirming wiring.
**Evidence:** A post-merge review found both scaffolds used self-contained mock builders (`buildService`, local `createBatchOperationService`) that stubbed the unit under test, so all 33 + 19 tests passed without touching the real modules. The committed verification commands also used `--testPathPattern`, which Jest 30 renamed to `--testPathPatterns`.
**Revised Understanding:** Scaffolds must import the real factories (`createFileService`, `createBatchOperationService`) and assert the spec contract; they now fail with `TypeError: ... is not a function` / missing methods, which is the intended pre-Wave-2 state. All plan verification commands use `--testPathPatterns`.
**Affected Tasks:** W1.1-2, W1.1-5, W1.1-1 (count correction), all verification commands in W1.1-1 through W1.1-7.

---

## Handoff to Wave 2

After Wave 1 is complete, verify:
- [x] All spec documents listed above exist and contain required sections (W1.0-1 through W1.0-8)
- [x] All test scaffold files exist with describe/it blocks producing failing tests (W1.1-1 through W1.1-7)
- [x] Test utility additions are planned in W1.1-8 and documented for implementation
- [x] No implementation code has been written — only docs and test structures
- [x] This file's Execution Log is populated with completion dates for each task

Wave 2 will:
- Implement `WebdavBlobStore` adapter (Task 4.0) using spec from W1.0-2 Section 3
- Update blobstore factory to dispatch S3 vs WebDAV based on `WEA_FILE_STORAGE` config
- Write `fileService.test.js` implementation-level tests (W1.1-2 scaffold becomes real tests)
- Begin `fileService.js` refactoring skeleton: inject Phase 2 services, wire dual-backend dispatch per W1.0-1 spec
- Run Wave 2 test suite against both S3 and WebDAV modes to validate factory dispatch

Wave 3 will:
- Complete fileService implementation (listDirectoryWithPermissions, uploadFile, downloadFile, renameNode)
- Migrate batchOperationService from sync checkers to async nodeId gates per W1.0-3 spec
- Rewrite route handlers in crud.js, batch.js to accept/return nodeId

Wave 4 will:
- Complete client-side migration (Tasks 4.8a-4.8h): permissionService, useSharedManage, buildPermissionDiff → nodeId payloads
- Remove sync checker re-exports from aclService (Task 4.8f)
- Rewrite client tests per W1.1-4 plan

Wave 5 will:
- Remove legacy path-based code: Tier 2/3 functions from permissionPolicy.js (Task 4.8d), PermissionFacade + Permission model (Task 4.8e), ownerNodeResolver path helpers (Task 4.8g)
- Run full integration test suite against SQLite backend (Task 4.9)
- Merge to dev branch

---

## Revision 2: Rectification Results (Wave 0)

Wave 2 진입 전, Wave-1 산출물의 계약 불일치를 교정했습니다 (2026-08-03).
상세 내역은 `phase4-wave-rectify.md` 참조.

### 교정된 계약 (D1-D12)

| ID | Decision (target contract) |
|----|-----------------------------|
| D1 | `WebdavBlobStore` uses S3-uniform methods `uploadBlob/downloadBlob/deleteBlob/headBlob/listOrphanedKeys`; constructor takes a file-store adapter `webdavClient` (NOT a raw `{baseUrl,...}` config); `headBlob` maps `getFileMetadata().mime -> contentType`. |
| D2 | blobstore factory `createBlobStore()` is parameterless (reads `process.env.WEA_FILE_STORAGE \|\| 's3'`); `webdav` -> `new WebdavBlobStore(createFileStoreAdapter())`; else S3 via existing `resolveS3Config()`. Remove `NoOpBlobStore` import+usage. |
| D3 | `S3BlobStore.copyBlob(sourceKey, destKey)` via `CopyObjectCommand`; propagate clear `NoSuchKey` error. |
| D4 | `fileNodesStore.countActiveObjectsByS3Key(s3Key)` -> count of `object_map.status='active'` rows for that `s3_key` (SQLite+PG). |
| D5 | `createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode='s3', fileNodeService })`. Return set = 12 methods incl. `uploadToWebdav`, `downloadBlobWebdav`. No `webdavClient` param. No `downloadFromWebdav` name. |
| D6 | `createFileService.copyFile(nodeId, destinationParentNodeId, newName, userId, user)` — 5 args. |
| D7 | File nodes use `checkFilePermission`; folders / move-dest / directory listing use `checkFolderPermission`. |
| D8 | Add `notFound`, `permissionDenied`, `invalidName` to `SERVER_ERROR_CODES.files`. Fix `fileService.js` references from `SERVER_MESSAGE_CODES` to `SERVER_ERROR_CODES`. |
| D9 | Expose `fileNodeService.getNode(nodeId)`; existence checks use `getNode`, not `getNodePath` null-guards. |
| D10 | `deleteNode` returns `{ deletedCount }` from `getDescendantIds(nodeId).length`; `listDirectoryWithPermissions` maps `updatedAt -> modifiedAt`. |
| D11 | `createBatchOperationService` = Wave-3 work; 19-test scaffold stays RED; fix spec test path to `domains/files/services/__tests__/`. |
| D12 | Do NOT modify routes in Wave 2. Legacy path-based fileService surface preserved; `files.test.js` stays GREEN. |

### Wave-1 산출물 실제 상태

| 작업 | Wave-1 산출물 | Rectify 교정 | 현재 상태 |
|------|-------------|-------------|----------|
| W1.0-1 fileService.md | 생성 (4인자 copyFile) | 5인자, 권한 D7, 코드맵 D8 | ✅ 최종 완료 |
| W1.0-2 blobStorageService.md | 생성 (webdavClient, adapter 메서드) | 12메서드, webdavClient 제거, S3-uniform | ✅ 최종 완료 |
| W1.0-3 batchOperationService.md | 생성 (테스트 경로 오류) | 경로 `domains/files/services/__tests__/` | ✅ 최종 완료 |
| W1.0-4 downloadService.md | 생성 (checkFolderPermission 오류) | checkFilePermission + PERMISSIONS.READ | ✅ 최종 완료 |
| W1.0-5 files.md | 생성 (WebDAV mock factory 기술) | 서비스 mock via composition root | ✅ 최종 완료 |
| W1.0-6 permissionPolicy.md | 생성 (canReadFile 매핑 오류) | checkFilePermission, PRE-REMOVAL 배너 | ✅ 최종 완료 |
| W1.0-7 permissionService.md | 생성 (fileNodeId 불일치) | nodeId 통일, /api/permissions 명시 | ✅ 최종 완료 |
| W1.0-8 buildPermissionDiff.md | 생성 (소규모 정렬) | nodeId 기반 Maps | ✅ 최종 완료 |
| W1.1-1 WebdavBlobStore.test.js | 생성 (uploadToWebdav 등) | S3-uniform 메서드, adapter mock | ✅ 최종 완료 |
| W1.1-2 fileService.test.js | 생성 (mock 기반, 33개) | real factory + 계약 정렬 | ✅ 최종 완료 |
| W1.1-3 files.test.js 계획 | 계획 문서만 | — | 📝 계획 (Wave-3에서 구현) |
| W1.1-4 permissionService.test.js 계획 | 계획 문서만 | — | 📝 계획 (Wave-4에서 구현) |
| W1.1-5 batchOperationService.test.js | 생성 (real factory, 19개) | Wave-3 work, RED 유지 | ✅ 최종 완료 |
| W1.1-6 downloadService.test.js | 생성 (factory 미존재, 9개) | Wave-4.2 work | ✅ 최종 완료 |
| W1.1-7 blobstoreFactory.test.js | 업데이트 (NoOp + throw 테스트) | NoOp 제거, 9개로 정리 | ✅ 최종 완료 |
| W1.1-8 test-utils 계획 | 계획 문서만 | — | 📝 계획 (Wave-3에서 구현) |

### 검증 결과

- 대상 테스트 114개 전부 통과 (blobstore 35, blobStorage 46, fileService 33)
- `files.test.js` 유지 (Rule #2)
- `batchOperationService` RED 유지 (Wave-3)
- 전체 게이트: 45/65 스위트 통과, 981 테스트 통과 (20개 실패 스위트는 기존 인프라 문제)

### Wave-1 문서에서 발견된 원인 (교정 근거)

1. **WebDAV 인터페이스 이름 불일치** (W1.0-2 vs D1): `uploadToWebdav/downloadFromWebdav` → `uploadBlob/downloadBlob`
2. **factory 시그니처 모호성** (W1.0-2 vs D2): `createBlobStore(config)` → `createBlobStore()` (인자 없음)
3. **copyFile 인자 수 누락** (W1.0-1 vs D6): 4인자 → 5인자 (`newName` 추가)
4. **permission 매핑 오류** (W1.0-6 vs D7): `canReadFile → checkFolderPermission` → `checkFilePermission`
5. **Dispatch Table 혼재** (W1.0-2): adapter 경로 메서드와 서비스 메서드 혼재 → 서비스 메서드로 통일
6. **테스트 스캐폴드 검증 명령** (전체): `--testPathPattern` → `--testPathPatterns` (Jest 30)
