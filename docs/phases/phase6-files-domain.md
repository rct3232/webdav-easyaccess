# Phase 6: Files Domain Separation — Detailed Plan

## Objective

Split `routes/files.js` (1,552 lines) into domain-bounded modules under `domains/files/`, introduce the `FileStoreAdapter` interface for physical file operations, migrate three in-route Map instances to CacheAdapter, and eliminate dead code.

**Branch:** `refactor/phase6-files-domain`
**Dependencies:** Phase 5 (aclService must exist — ✅ verified)
**Risk Level:** High — largest single file (1,552 lines), most cross-module dependencies

---

## Current State (Evidence-Based Inventory)

### Source Files

| File | Lines | Purpose | Action |
|------|-------|---------|--------|
| `server/routes/files.js` | 1,552 | Monolithic route handlers + helpers + bulk worker | Split into 4 routes + services |
| `server/routes/folders.js` | 98 | Folder create/stats endpoints | Relocate to domains/files/ |
| `server/services/selectiveTransfer.js` | 180 | Recursive selective move/copy of directories | Relocate, inject FileStoreAdapter |
| `server/services/selectiveDownload.js` | 91 | Recursive file collection for ZIP download | Relocate, inject FileStoreAdapter |
| `server/services/selectiveDelete.js` | 122 | Recursive deletion with gating predicates | Relocate, inject FileStoreAdapter |
| `server/store/bulkJobStore.js` | 87 | In-memory job tracking (Map-based) | Migrate to CacheAdapter |
| `server/utils/webdav.js` | 670 | WebDAV client operations + utilities | Wrapped by FileStoreAdapter |

### Inline Maps in routes/files.js

| Map | Line | Written? | Read By | Verdict |
|-----|------|-----------|---------|--------|
| `downloadProgress` | 63 | ✅ Yes (lines 1303, 1437, 1480, 1498, 1516) + `.delete()` at 1524-1526 | GET `/download-progress/:id` (line 1531) | **Migrate to CacheAdapter** |
| `operationProgress` | 64 | ❌ Never — zero `.set()` or `.delete()` calls in entire repo | GET `/operation-progress/:id` (line 1542) | **Dead code — remove entirely** |
| `previewTickets` | 68 | ✅ Yes (line 73 `.set()`, line 82 `.delete()`) | POST/GET preview-ticket/stream (lines 871, 884) | **Migrate to CacheAdapter** |

### Dead Code Confirmed: `operationProgress`

- `grep "operationProgress\.set\|operationProgress\.delete"` → **0 matches in entire repository**
- Client code (`client/src/`) → no reference to `/operation-progress` endpoint
- Server tests (`files.test.js`) → no test case for the endpoint
- The endpoint always returns 404 (`notFoundError`). It was intended for bulk operation progress polling but never wired up.

### Test Files to Relocate

| Source | Destination | Lines |
|--------|-------------|-------|
| `server/routes/__tests__/files.test.js` | `domains/files/routes/__tests__/files.test.js` | 572 |
| `server/routes/__tests__/folders.test.js` | `domains/files/routes/__tests__/folders.test.js` | 183 |
| `server/services/__tests__/selectiveTransfer.test.js` | `domains/files/services/__tests__/selectiveTransfer.test.js` | 73 |
| `server/services/__tests__/selectiveDownload.test.js` | `domains/files/services/__tests__/selectiveDownload.test.js` | 195 |
| `server/services/__tests__/selectiveDelete.test.js` | `domains/files/services/__tests__/selectiveDelete.test.js` | 163 |
| `server/store/__tests__/bulkJobStore.test.js` | `domains/files/stores/__tests__/operationProgress.test.js` | 66 |

---

## Target Architecture

```
server/
├── infrastructure/adapters/filestore/
│   ├── FileStoreAdapter.js          — JSDoc typedef (interface contract)
│   ├── WebdavFileStoreAdapter.js    — Wraps utils/webdav.js operations
│   └── index.js                     — createFileStoreAdapter(config) factory
│
├── domains/files/
│   ├── routes/
│   │   ├── crud.js                  — /check-conflicts, /metadata, /list, /download, /upload, /rename
│   │   ├── batch.js                — /batch-delete, /batch-move, /batch-copy, /bulk-operation/:jobId, /:jobId/cancel
│   │   ├── preview.js              — /preview-ticket, /preview-stream, /download-multiple, /download-progress/:id, /thumbnail/:hash, /thumbnails/batch
│   │   └── folders.js              — /create, /stats (from server/routes/folders.js)
│   │
│   ├── services/
│   │   ├── fileService.js          — Single-file CRUD: listWithPermissions, downloadFile, uploadFile, renameFile
│   │   ├── batchOperationService.js — runBulkJobWorker + scheduleBulkWorker (extracted from files.js L265-661)
│   │   ├── conflictResolver.js     — getConflicts, checkConflictsRecursive, handleSingleOpConflict (L123-263, L1133-1145)
│   │   ├── selectiveTransfer.js    — Relocated from server/services/ (injected FileStoreAdapter)
│   │   ├── selectiveDownload.js    — Relocated from server/services/ (injected FileStoreAdapter)
│   │   └── selectiveDelete.js      — Relocated from server/services/ (injected FileStoreAdapter)
│   │
│   ├── stores/
│   │   └── operationProgress.js    — CacheAdapter-backed: downloadProgress, previewTickets, bulkJobStore
│   │
│   └── __tests__/                  — Relocated test files
```

---

## Route Splitting Details

### `routes/crud.js` (~400 lines target)

Single-file CRUD + utilities. Mounted at `/api/files`.

| Method | Path | Auth | Source Lines | Description |
|--------|------|------|-------------|-------------|
| POST | `/check-conflicts` | Token, requireUser | 663-671 | Pre-flight conflict detection |
| POST | `/metadata` | Token or share, requireAuth | 675-706 | Batch file metadata lookup (≤100 paths) |
| GET | `/list` | Token or share, requireAuth | 708-820 | Directory listing with per-item permissions + thumbnails |
| GET | `/download` | Token or share, requireAuth | 822-851 | Single file download |
| POST | `/upload` | Token, requireUser | 918-1067 | Multipart upload (multer inline config stays here) |
| PUT | `/rename` | Token (not share), requireUser | 1080-1131 | Rename file/dir + permission rewrite for dirs |

**Helper to include**: `requireTokenNotShare` middleware function (L56-61).

### `routes/batch.js` (~120 lines target)

Bulk operations. Mounted at `/api/files`.

| Method | Path | Auth | Source Lines | Description |
|--------|------|------|-------------|-------------|
| POST | `/batch-delete` | Token, requireUser | 1070-1078 | Creates job → returns 202 + jobId |
| POST | `/batch-move` | Token, requireUser | 1148-1156 | Creates job → returns 202 + jobId |
| POST | `/batch-copy` | Token, requireUser | 1159-1167 | Creates job → returns 202 + jobId |
| GET | `/bulk-operation/:jobId` | Token, requireUser | 1170-1186 | Poll job status/results |
| POST | `/bulk-operation/:jobId/cancel` | Token, requireUser | 1189-1200 | Cancel running job |

**Note**: `GET /operation-progress/:id` (L1540-1549) is **NOT migrated** — it is dead code and removed.

### `routes/preview.js` (~350 lines target)

Preview, multi-file download, thumbnails. Mounted at `/api/files`.

| Method | Path | Auth | Source Lines | Description |
|--------|------|------|-------------|-------------|
| POST | `/preview-ticket` | Token or share, requireAuth | 854-873 | Issue short-lived video preview ticket |
| GET | `/preview-stream` | None (ticket-based) | 876-916 | Stream video bytes inline using ticket auth |
| POST | `/download-multiple` | Token or share, requireAuth | 1270-1527 | ZIP streaming download with progress tracking |
| GET | `/download-progress/:id` | Token or share, requireAuth | 1529-1538 | Poll ZIP download progress |
| GET | `/thumbnail/:hash` | Token, requireUser | 1202-1228 | Serve cached thumbnail by hash lookup |
| POST | `/thumbnails/batch` | Token or share, requireAuth | 1230-1249 | Generate thumbnails for batch of paths |

**Helper to include**: `collectFilesFromDirectory` (L1251-1268), preview ticket issue/read functions.

### `routes/folders.js` (~100 lines target)

Relocated from `server/routes/folders.js`. Mounted at `/api/folders`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/create` | Token, requireUser | Create folder + auto-grant WRITE to creator, ADMIN to home owner |
| GET | `/stats` | Token, requireUser | Recursive folder stats (file count, total size) |

**Change required**: Replace direct `Permission.grant()` calls with permissionFacade. Replace `permissionPolicy` imports with aclService calls.

---

## Service Layer Details

### `services/conflictResolver.js`

Extracted from `routes/files.js`:
- L123-196: `checkConflictsRecursive(sourcePath, destinationPath, conflicts, depth, cache, opts)` — recursive directory conflict detection with caching
- L198-263: `getConflicts(operations, opts)` — batch conflict check across multiple operations (upload + move/copy types)
- L1133-1145: `handleSingleOpConflict(destPath, onConflict)` — single-item skip/overwrite/error decision

**Dependencies**: FileStoreAdapter (`listDirectory`, `pathExists`), `asyncLimitSettled` from utils.

### `services/batchOperationService.js`

Extracted from `routes/files.js`:
- L265-270: `scheduleBulkWorker(jobId)` — sets immediate with test-mode skip guard
- L278-661: `runBulkJobWorker(jobId)` — bulk delete/move/copy worker (~384 lines)

**Critical changes**: All direct `Permission.*` calls (lines 297, 354-355, 373-374, 478-481, 486-487, 495-497, 607, 615-618) must be replaced with calls through `permissionFacade` or `aclService`. Direct `User.findById`, `User.findByUsername` imports (L286, L341) also need to go through a service boundary.

**Dependencies**: FileStoreAdapter, conflictResolver, selectiveTransfer, selectiveDelete, operationProgress store, aclService + permissionFacade from permissions domain.

### `services/fileService.js`

Extracted from route handler bodies in crud.js:
- `listDirectoryWithPermissions(principalId, folderPath, user)` — combines list call with per-item permission checks and thumbnail URLs
- `downloadFile(principalId, filePath)` — validates read permission, returns buffer
- `uploadFile(user, folderPath, fileBuffer, originalFilename, relativePath, onConflict)` — handles intermediate directory creation + permission grants
- `renameFile(user, oldPath, newName)` — validates write permission, moves, rewrites permissions for directories

**Dependencies**: FileStoreAdapter, aclService/permissionFacade, thumbnail service (for URL generation).

---

## Store Layer Details

### `stores/operationProgress.js`

Replaces three inline Maps with CacheAdapter-backed storage:

```javascript
// Constructor receives CacheAdapter instances via injection
class OperationProgressStore {
  constructor(downloadCache, previewCache, jobCache) { ... }

  // Download progress (ZIP streaming)
  setDownloadProgress(id, state) { /* downloadCache.set */ }
  getDownloadProgress(id) { /* downloadCache.get */ }
  cleanupDownloadProgress(id, ttlMs) { /* setTimeout + delete */ }

  // Preview tickets
  issuePreviewTicket(principalId, filePath, ttlMs) { /* returns ticket string */ }
  readPreviewTicket(ticket) { /* returns entry | null | { expired: true } */ }

  // Bulk job tracking (replaces bulkJobStore.js Map)
  createJob(userId, operation, payload) { /* returns { jobId } */ }
  getJob(jobId) { /* with TTL-based auto-eviction for terminal states */ }
  setJobCancelled(jobId) { ... }
  updateJob(jobId, updates) { ... }
}
```

**adapter-migration-log.md impact**: Mark items #10 (downloadProgress), #12 (previewTickets) as DONE. Item #11 (operationProgress) marked as REMOVED — dead code.

---

## FileStoreAdapter Details

### Interface (`infrastructure/adapters/filestore/FileStoreAdapter.js`)

JSDoc typedef matching existing `utils/webdav.js` function signatures:

```javascript
/** @typedef {Object} FileStoreAdapter
 *  @property {function(string): Promise<Array>} listDirectory
 *  @property {function(string): Promise<Buffer>} getFileContents
 *  @property {function(string, Buffer): Promise<void>} putFileContents
 *  @property {function(string, string, Function?, boolean?, Object?): Promise<void>} moveFile
 *  @property {function(string, string, Function?, boolean?, Object?): Promise<void>} copyFile
 *  @property {function(string, Object?): Promise<void>} deleteFile
 *  @property {function(string): Promise<void>} createDirectory
 *  @property {function(string): Promise<boolean>} pathExists
 *  @property {function(string): Promise<{size:number, lastmod:string, mime:string}>} getFileMetadata
 */
```

### Implementation (`infrastructure/adapters/filestore/WebdavFileStoreAdapter.js`)

Delegates to functions from `utils/webdav.js`. The adapter:
- Receives webdav function references via constructor injection (avoids circular deps)
- Wraps each call through the interface contract
- Keeps `clientCache` management internal (will be migrated to CacheAdapter in Phase 7 Task 7.7)

### Factory (`infrastructure/adapters/filestore/index.js`)

```javascript
function createFileStoreAdapter(config) {
  return new WebdavFileStoreAdapter(config);
}
module.exports = { createFileStoreAdapter };
```

---

## selective* Service Updates

All three services currently use a lazy `defaultWebdavAdapter()` pattern:

```javascript
// Current (selectiveTransfer.js L15-18):
function defaultWebdavAdapter() {
  const { listDirectory, createDirectory, moveFile, copyFile, deleteFile, pathExists } = require('../utils/webdav');
  return { listDirectory, createDirectory, moveFile, copyFile, deleteFile, pathExists };
}
```

**Change**: Replace with FileStoreAdapter from factory. The `webdav` parameter default becomes:

```javascript
// New:
const { createFileStoreAdapter } = require('../../../infrastructure/adapters/filestore');
function defaultWebdavAdapter() { return createFileStoreAdapter(); }
```

The three services also share a duplicated `posixJoin(a, b)` helper (L8-12 in each file). **Do not deduplicate** — this is outside Phase 6 scope. Leave as-is.

---

## Permission Model → aclService Migration Map

Direct `Permission` model calls in files.js that must be replaced:

| Line | Current Call | Replacement |
|------|-------------|-------------|
| 297 | `Permission.getPermissionDoc(userId)` | `permissionFacade.getPermissionDoc(userId)` or equivalent in batchOperationService |
| 354-355 | `Permission.revokePermissionsPrefixForAllUsers([...])` | `permissionFacade.revokePermissionsPrefixForAllUsers(...)` |
| 373-374 | Same as above | Same |
| 478-481 | `Permission.rewritePermissionsForAllUsers([...], opts)` | `permissionFacade.rewritePermissionsForAllUsers(...)` |
| 486-487 | Same rewrite call for movedDirMappings | Same |
| 495-497 | `Permission.grant(homeOwnerId, dir, ADMIN)` | `permissionFacade.grant(...)` |
| 607 | `Permission.grant(userId, dir, WRITE)` | `permissionFacade.grant(...)` |
| 615-618 | Same grant for home owner admin | Same |
| 739 | `Permission.getPermissionDoc(req.user.id)` | Injected via fileService.listDirectoryWithPermissions() |
| 761, 785-787, 794-797 | Various `Permission.check*Sync(doc, ...)` calls | Stay in policy layer (permissionPolicy.js) — acceptable as they use pre-loaded doc |
| 983 | `Permission.getFolderPermissions(folderPath)` | fileService.uploadFile → permissionFacade |
| 1008-1009, 1015, 1027 | Various `Permission.grant(...)` in upload handler | Same — through fileService |
| 1116 | `Permission.rewritePermissionsForAllUsers([{from,to}])` | fileService.renameFile → permissionFacade |
| 1124 | `Permission.grant(homeOwnerId, normalizedNew, ADMIN)` | Same |
| 1290-1291 | `Permission.checkSharePermission(token, path, READ)` | aclService or keep in preview.js as inline delegation |

**Key principle**: The sync checkers (`buildSyncWriteChecker`, etc.) from `permissionPolicy.js` internally call `Permission.checkPermissionSync(doc, ...)`. This is acceptable — they are part of the policy layer and operate on a pre-loaded document (optimization to avoid N+1 DB queries). The route/service layer must not import Permission directly; it goes through services that use these policy helpers.

---

## Implementation Task List

| Task | Description | Inputs | Expected Outputs | Verification |
|------|-------------|--------|-----------------|--------------|
| 6.0 | Create `refactor/phase6-files-domain` branch; verify clean test baseline | — | Branch created, `npm run test:ci -w server` passes | All tests green before changes |
| 6.1 | Define FileStoreAdapter interface (JSDoc typedef) | PLAN.md adapter spec | `infrastructure/adapters/filestore/FileStoreAdapter.js` | Module loads without error |
| 6.2 | Implement WebdavFileStoreAdapter wrapping utils/webdav.js functions | webdav.js exported functions | `infrastructure/adapters/filestore/WebdavFileStoreAdapter.js` | Each method delegates correctly |
| 6.3 | Create FileStoreAdapter factory | — | `infrastructure/adapters/filestore/index.js` | Factory returns adapter instance |
| 6.4 | Scaffold domains/files/ directory structure | Target architecture above | All empty .js files created | Directory exists, all files loadable |
| 6.5 | Extract conflictResolver service from files.js L123-263, L1133-1145 | files.js source | `domains/files/services/conflictResolver.js` | Conflict detection produces same results |
| 6.6 | Extract batchOperationService from files.js L265-661 | files.js source + aclService + permissionFacade | `domains/files/services/batchOperationService.js` | Batch delete/move/copy identical behavior |
| 6.7 | Extract fileService from route handler bodies | files.js CRUD handlers | `domains/files/services/fileService.js` | list/download/upload/rename work identically |
| 6.8 | Relocate selectiveTransfer, selectiveDownload, selectiveDelete + inject FileStoreAdapter | server/services/ source files | domains/files/services/ destination | Unit tests pass with injected adapter |
| 6.9 | Create operationProgress store (CacheAdapter-backed) | bulkJobStore.js logic + downloadProgress + previewTickets | `domains/files/stores/operationProgress.js` | Progress tracking, ticket lifecycle preserved |
| 6.10 | Split route handlers into crud.js, batch.js, preview.js, folders.js | files.js L663-1549, folders.js full | 4 route files, each ≤ 400 lines | Routes respond on correct paths |
| 6.11 | Remove dead code: `operationProgress` Map + `/operation-progress/:id` endpoint | Evidence from investigation | Endpoint gone, Map removed | No regressions (no tests existed) |
| 6.12 | Update index.js mounts → new domain routes | Current L75 mount | 4 app.use() calls for files domains | Server starts, all endpoints respond |
| 6.13 | Update adapter-migration-log.md | Items #10-#12 | Marked DONE (10, 12), REMOVED (11) | Log accurate |
| 6.14 | Relocate test files + update import paths | 6 test files listed above | Co-located `__tests__/` directories | All tests pass with new paths |
| 6.15 | Update server/test-utils.js imports if needed | Current file | No changes expected (bulkJobStore not referenced) | Loads without errors |
| 6.16 | Run full test suite: `npm run test:ci -w server` | All changes committed | **Phase 7 gate** | All tests pass ✅ |

---

## Cross-Cutting Changes

### adapter-migration-log.md Updates

| Item | Current Status | New Status |
|------|----------------|-------------|
| #10 `downloadProgress` (files.js:63) | Pending → Phase 6 | **DONE** — migrated to operationProgress store via CacheAdapter |
| #11 `operationProgress` (files.js:64) | Pending → Phase 6 | **REMOVED** — dead code, never populated |
| #12 `previewTickets` (files.js:68) | Pending → Phase 6 | **DONE** — migrated to operationProgress store via CacheAdapter |

### Docs Updates Required

| Document | Change |
|----------|--------|
| `docs/spec/server/routes/files.md` | Update source path to `domains/files/routes/`; add route split mapping; remove `/operation-progress/:id` entry |
| `docs/api.md` | Remove `/api/files/operation-progress/:id` from API reference (line 52) |
| `docs/features/files-sharing.md` | Remove or mark deprecated the bulk operation progress reference (line 63) |

### Shim Files to Create During Transition

To maintain backward compatibility during test migration:

| Shim Location | Re-exports To |
|--------------|---------------|
| `server/store/bulkJobStore.js` → shim | `domains/files/stores/operationProgress.js` bulk job methods |
| `server/services/selectiveTransfer.js` → shim | `domains/files/services/selectiveTransfer.js` |
| `server/services/selectiveDownload.js` → shim | `domains/files/services/selectiveDownload.js` |
| `server/services/selectiveDelete.js` → shim | `domains/files/services/selectiveDelete.js` |

Shims are 1-line re-exports (`module.exports = require('../domains/files/...')`). Removed in Phase 7 Task 7.19 when all callers are updated.

---

## Success Criteria (Phase-Specific)

| Metric | Before | After |
|--------|--------|-------|
| Largest route file | files.js: 1,552 lines | ≤ 400 lines per module |
| Files domain routes | 1 monolithic file | 4 focused modules (crud, batch, preview, folders) |
| Inline Maps in route files | downloadProgress, operationProgress, previewTickets | 0 (all via CacheAdapter in store layer) |
| Dead code in files.js | operationProgress Map + endpoint | Removed |
| Direct Permission imports in files routes | `require('../models/Permission')` at L7 | 0 (all via aclService/permissionFacade) |
| selective* services location | `server/services/` (flat) | `domains/files/services/` (co-located) |
| Test file co-location | Scattered in routes/__tests__, services/__tests__, store/__tests__ | All under domains/files/**/__tests__/ |

---

## Execution Order

```
6.0: Branch + baseline tests
    ↓
6.1-6.3: FileStoreAdapter interface + implementation + factory
    ↓
6.4: Scaffold directories
    ↓
6.5-6.7: Extract services (conflictResolver, batchOperationService, fileService)
        ↕  (parallel — no dependencies between these three extractions)
6.8: Relocate selective* services + inject FileStoreAdapter
    ↓
6.9: Create operationProgress store (CacheAdapter-backed)
    ↓
6.10: Split route handlers into crud.js, batch.js, preview.js, folders.js
    ↓
6.11: Remove dead code (operationProgress Map + endpoint)
    ↓
6.12: Update index.js mounts
    ↓
6.13-6.15: Update docs + adapter-migration-log + test-utils
    ↓
6.14: Relocate test files
    ↓
6.16: Run full test suite — Phase 7 gate
```
