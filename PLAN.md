# PLAN: Server Modularization (Modular Monolith)

## Objective

Refactor server-side code into domain-bounded modules with a service layer and adapter pattern, enabling future infrastructure changes (Redis, S3, backend switching) without touching route or business logic.

## Scope

- **In scope**: `server/routes/`, `server/store/`, `server/utils/` → restructured to `server/domains/` + `server/infrastructure/`; test files co-located with source; test mocks and utilities updated
- **Out of scope**: Client-side refactoring, Redis/S3 implementation (recorded as Future Work), test framework changes

## Success Criteria

| Metric | Before | Target After |
|--------|--------|-------------|
| Largest route file | files.js (1,552 lines) | ≤ 400 lines per module |
| Largest store file | permissionStore.js (1,301 lines) | Wrapped via facade (kept intact until S3/PG backend) |
| Route → Store direct access | 8 routes | 0 (all via service layer) |
| Cross-layer reverse dependencies | permissionPolicy ↔ middleware/permissions | 0 |
| Backend branching points | ~86 locations across 8 stores | Centralized in adapter implementations only |
| Largest persistent store file | userStore.js (821 lines) | ≤ 300 lines per module |
| Shared mutable Map instances | 9 Maps across 8 files | All via CacheAdapter with injection |

---

## Current Problems (Evidence-Based)

### Problem 1: Monolithic Route Files
- `files.js` — 1,552 lines mixing CRUD, batch operations, preview tickets, download progress tracking
- `admin.js` — 510 lines reaching directly into store layer (storage, locks, metaPaths)
- No service layer between routes and stores; business logic lives in route handlers

### Problem 2: Backend Branching Inflation
Each store function repeats `if (isPostgresqlBackend()) / if (isSqliteBackend()) / else` pattern. Adding S3 requires touching ~86 branching points across 8 files: `userStore.js`, `permissionStore.js`, `permissionRequestStore.js`, `recentFilesStore.js`, `shareLinkStore.js`, `settingsStore.js`, `locks.js`, `bootstrap.js`.

### Problem 3: Shared Mutable State Without Boundaries
At least 9 raw `Map` instances across 6 files, all using the raw Map API with no common abstraction:

| Map | File | Line | Risk |
|-----|------|------|------|
| `thumbnailCache` | `utils/thumbnail.js` | 17 | Race condition — shared between `files.js` + `thumbnails.js` |
| `refreshTokensStore` | `utils/auth.js` | 14 | In-memory, lost on restart |
| `loginAttempts` | `routes/auth.js` | 26 | In-memory, lost on restart |
| `bulkJobStore` (`jobs`) | `store/bulkJobStore.js` | 3 | In-memory, lost on restart |
| `clientCache` | `utils/webdav.js` | 10 | WebDAV HTTP connection pool — never flushed |
| `userCache` | `middleware/permissions.js` | 11 | User lookup cache — unbounded growth |
| `cache` + `shareCache` | `store/permissionStore.js` | 35–36 | Permission TTL caches — duplicated expiry logic |
| `existenceIndex` | `store/permissionExistenceIndex.js` | 5 | Permission existence index — manual invalidation |

No common cache abstraction; each location implements its own Get/Set/Delete pattern.

### Problem 4: Cross-Layer Reverse Dependencies
- `utils/permissionPolicy.js` imports from `middleware/permissions.js` (utils → middleware)
- `admin.js` route imports `storage`, `locks`, `metaPaths` directly (route → infrastructure)

---

## Target Architecture

```
server/
├── index.js                    — Bootstrap: compose adapters, mount routes
│
├── domains/
│   ├── recentFiles/            — Phase 1 target
│   │   ├── routes.js           — HTTP handlers only (≤50 lines)
│   │   └── service.js          — Recent file tracking logic
│   │
│   ├── thumbnails/             — Phase 2 target
│   │   ├── routes.js
│   │   ├── services/
│   │   │   ├── imageProcessor.js
│   │   │   ├── videoProcessor.js
│   │   │   └── thumbnailService.js
│   │   └── cache/
│   │       └── thumbnailCache.js  — Uses CacheAdapter interface
│   │
│   ├── auth/                   — Phase 3 target
│   │   ├── routes.js           — HTTP handlers only (≤60 lines)
│   │   ├── service.js          — Domain operations: loginUser, registerUser, refreshAccessToken, getAuthenticatedUser, revokeAllUserTokens
│   │   ├── tokenStore.js       — Refresh token CRUD via CacheAdapter (internal to domain)
│   │   └── __tests__/
│   │       ├── tokenStore.test.js
│   │       └── routes/
│   │           └── auth.test.js
│   │
│   ├── sharing/                — Phase 4 target
│   │   ├── routes/
│   │   │   ├── shareLinks.js    — Authenticated: create/list/delete links
│   │   │   └── sharePublic.js   — Unauthenticated: token-based access
│   │   ├── services/
│   │   │   ├── shareLinkService.js
│   │   │   └── shareAccessService.js
│   │   └── store.js             — Share link persistence via MetadataAdapter
│   │
│   ├── permissions/            — Phase 5 target (largest refactor)
│   │   ├── routes/
│   │   │   ├── userPathPermissions.js
│   │   │   ├── filePermissions.js
│   │   │   └── permissionRequests.js
│   │   ├── services/
│   │   │   ├── aclService.js        — Core: checkPermission(path, user, action)
│   │   │   ├── ownerPathResolver.js  — /{username}/ home directory detection
│   │   │   └── requestWorkflow.js    — Request lifecycle + email notification
│   │   ├── stores/
│   │   │   ├── permissionFacade.js   — Controlled access to permissionStore.js (kept intact)
│   │   │   ├── requestStore.js       — Permission request queue
│   │   │   └── existenceIndex.js     — Permission existence index
│   │   └── policy/
│   │       ├── permissionRank.js    — read < write < admin ordering
│   │       ├── permissionPolicy.js  — Policy rules (relocated from utils/permissionPolicy.js)
│   │       └── inheritancePolicy.js — "No inheritance" rule + owner exception
│   │
│   ├── files/                  — Phase 6 target (largest file split)
│   │   ├── routes/
│   │   │   ├── crud.js            — Single-file upload/download/rename/delete
│   │   │   ├── batch.js           — Bulk move/copy/delete + progress polling
│   │   │   ├── preview.js         — Video preview tickets, thumbnail requests
│   │   │   └── folders.js         — Create folder via WebDAV (moved from routes/folders.js)
│   │   ├── services/
│   │   │   ├── fileService.js     — Single-file operations via FileStoreAdapter
│   │   │   ├── batchOperationService.js — Selective transfer/delete orchestration
│   │   │   ├── conflictResolver.js  — Name collision handling
│   │   │   ├── selectiveTransfer.js — Bulk copy/move (relocated from server/services/)
│   │   │   ├── selectiveDownload.js — ZIP download (relocated from server/services/)
│   │   │   └── selectiveDelete.js   — Bulk delete (relocated from server/services/)
│   │   └── stores/
│   │       └── operationProgress.js — Uses CacheAdapter for progress tracking
│   │
│   └── admin/                  — Phase 7 target (orchestrator)
│       ├── routes/
│       │   ├── userManagement.js  — User list/create/approve/reject/delete (from admin.js + users.js)
│       │   ├── settings.js        — Global app settings (from routes/settings.js)
│       │   └── maintenance.js     — Cleanup orphaned data, hidden files toggle
│       ├── services/
│       │   ├── userService.js     — User lifecycle with rollback semantics
│       │   └── cleanupService.js  — Orphan detection + safe deletion
│       └── stores/
│           └── userStore.js       — User persistence (split into MetadataAdapter variants) [821L → ≤300L]
│
├── infrastructure/             — Phase 7: common extraction
│   ├── adapters/
│   │   ├── metadata/
│   │   │   ├── PostgresqlMetadataAdapter.js
│   │   │   ├── SqliteMetadataAdapter.js
│   │   │   └── FsJsonMetadataAdapter.js    — WebDAV/FS JSON file backend
│   │   │   └── index.js               — Factory: createMetadataAdapter(config)
│   │   ├── filestore/
│   │   │   ├── WebdavFileStoreAdapter.js
│   │   │   └── index.js              — Factory (S3 adapter added in Future Work)
│   │   └── cache/
│   │       ├── InMemoryCacheAdapter.js
│   │       └── index.js              — Factory (Redis adapter added in Future Work)
│   │
│   ├── lockManager.js          — Distributed locking (current locks.js extraction)
│   ├── bootstrap.js            — Server init: create adapters, seed defaults
│   ├── webdavRoutes.js         — /api/webdav/test, /api/webdav/info (extracted from index.js inline handlers)
│   ├── healthRoutes.js         — /api/health (extracted from index.js inline handler)
│   └── sqliteSchemaInit.js     — SQLite DDL init (relocated from scripts/initSqliteSchema.js)
│
├── middleware/                 — Unchanged structure, updated imports
│   ├── requireUser.js
│   ├── permissions.js
│   ├── normalizePathParam.js
│   └── metaPathGuard.js
│
├── models/                     — Unchanged (domain entities)
│   ├── User.js
│   ├── Permission.js
│   ├── ShareLink.js
│   ├── Settings.js
│   └── PermissionRequest.js
│
└── utils/                      — Reduced: only cross-domain utilities remain
    ├── errorHandler.js         — Global error handling (unchanged)
    ├── responseWriter.js       — Chunked buffer responses (unchanged)
    ├── asyncUtils.js           — Concurrency limiting (unchanged)
    ├── sharedHelpers.js        — safeJsonParse, nowIso, toIsoString (deduplicated from 6 store files)
    ├── email.js                — Email notifications (zero internal deps, stays as cross-domain util)
    └── paths.js                — Project root / data dir resolution (unchanged)
```

---

## Adapter Interfaces

Defined now, implementations extracted from existing code. Redis/S3 variants added later as Future Work.

### MetadataAdapter
Persistence for users, permissions, settings, share links, recent files, permission requests.
Interfaces follow existing store function signatures.

```javascript
/**
 * @typedef {Object} MetadataAdapter
 * @property {function(Object): User} createUser
 * @property {function(string): User|undefined} findByUsername
 * @property {function(string): User|undefined} findByEmail
 * @property {function(number): User|undefined} findById
 * @property {function(number, string): {success:boolean}} updatePassword
 * @property {function(number, string): {success:boolean}} updateStatus
 * @property {function(number, string): {success:boolean}} updateEmail
 * @property {function(number): {success:boolean}} deleteUser
 * @property {function(): Promise<Array>} findAll
 * @property {function(string): Promise<Array>} findByStatus
 * @property {function(number, string, string, Object?): Promise<Object>} grant
 * @property {function(number, string, Object?): Promise<{success:boolean}>} revoke
 * @property {function(number): Object} getPermissionDoc
 * @property {function(number, string, string): boolean} checkPermissionSync
 * @property {function(string): Promise<Object|null>} get
 * @property {function(string, string): Promise<{success:boolean}>} set
 * @property {function(): Promise<Array>} getAll
 * @property {function(Object): ShareLink} createShareLink
 * @property {function(string): ShareLink|null} getShareLink
 * @property {function(number): Array} getUserShareLinks
 * @property {function(string, Object): Promise<{success:boolean}>} updateShareLink
 * @property {function(string): Promise<{success:boolean}>} deleteShareLink
 * @property {function(Object): PermissionRequest} createRequest
 * @property {function(number): PermissionRequest|null} getById
 * @property {function(number, Object): Promise<Array>} listInbox
 * @property {function(number, Object): Promise<Array>} listOutbox
 * @property {function(number, Object): Promise<{success:boolean}>} updateStatus
 * @property {function(function()): Promise<void>} [withTransaction] — Optional: PG/SQLite only
 */
```

Implementations per backend mode:
- **S3+PostgreSQL mode**: `PostgresqlMetadataAdapter` (single source of truth)
- **WebDAV+PostgreSQL mode**: `PostgresqlMetadataAdapter`
- **WebDAV+SQLite mode**: `SqliteMetadataAdapter`
- **WebDAV/FS mode**: `FsJsonMetadataAdapter`

### FileStoreAdapter
Physical file operations on the storage backend.

```javascript
/**
 * @typedef {Object} FileStoreAdapter
 * @property {function(string): Promise<Array>} listDirectory
 * @property {function(string): Promise<Buffer>} getFileContents
 * @property {function(string, Buffer): Promise<{success:boolean}>} putFileContents
 * @property {function(string, string, Function?, boolean?, Object?): Promise<{success:boolean}>} moveFile
 * @property {function(string, string, Function?, boolean?, Object?): Promise<{success:boolean}>} copyFile
 * @property {function(string, Object?): Promise<{success:boolean}>} deleteFile
 * @property {function(string): Promise<{success:boolean}>} createDirectory
 * @property {function(string): Promise<{size:number, lastmod:string, mime:string}>} getFileMetadata
 * @property {function(string): Promise<boolean>} pathExists
 */
```

Implementations: `WebdavFileStoreAdapter` (current), `S3FileStoreAdapter` (Future Work).

### CacheAdapter
Session and cache storage. In-memory by default; Redis in Future Work.
Interface is synchronous for InMemoryCacheAdapter (matching current Map API); Redis adapter wraps in async.

```javascript
/**
 * @typedef {Object} CacheAdapter
 * @property {function(string): any|null} get
 * @property {function(string, any, number?): void} set — ttl_ms optional
 * @property {function(string): boolean} delete
 * @property {function(string): boolean} has
 * @property {function(): void} clear
 * @property {function(): Iterator<string>} keys
 * @property {function(): Iterator<[string, any]>} entries
 */
```

Implementations: `InMemoryCacheAdapter` (current, Map-based), `RedisCacheAdapter` (Future Work).

---

## Shared Utilities

### mapServiceError Helper

Added in Phase 1. Available in `utils/errorHandler.js`. Reusable across all domain phases.

**Purpose**: Converts service-layer domain errors into HTTP validation errors without coupling services to HTTP status codes.

**Problem it solves**: Each route handler previously needed repetitive `try/catch` blocks mapping service error messages to HTTP error codes:

```javascript
// BEFORE: verbose, repeated across all route handlers
router.post('/', asyncHandler(async (req, res) => {
  try {
    res.json(await service.addRecentFile(userId, req.body));
  } catch (error) {
    if (error.message === 'pathRequired') {
      throw validationError(SERVER_ERROR_CODES.recentFiles.pathRequired);
    }
    throw error;
  }
}));
```

**Solution**: Centralized error mapping with a reusable helper:

```javascript
// AFTER: concise, maintainable
const ERROR_MAP = {
  pathRequired: SERVER_ERROR_CODES.recentFiles.pathRequired,
  movesRequired: SERVER_ERROR_CODES.recentFiles.movesRequired,
};

router.post('/', asyncHandler(async (req, res) => {
  try {
    res.json(await service.addRecentFile(userId, req.body));
  } catch (e) { throw handleServiceError(e); }
}));
```

**Signature**:
```javascript
/**
 * @param {Error} error - Service error (with message matching a key in errorMap)
 * @param {Object} errorMap - { serviceErrorMessage: SERVER_ERROR_CODES.xxx }
 * @returns {Error} validationError with mapped errorCode, or rethrows if unmapped
 */
function mapServiceError(error, errorMap)
```

**Usage per domain**: Each domain defines its own `ERROR_MAP` object mapping service error messages to `SERVER_ERROR_CODES`. The helper returns a `validationError` (400) for mapped errors, or rethrows unmapped errors for the global error handler.

**Impact on route file size**: Reduced `recentFiles/routes.js` from 67 → 52 lines (24% reduction). Same pattern applies to all Phase 2–7 domains.

---

## Phases

### Phase 1: RecentFiles Domain Separation ✅ COMPLETE

**Dependencies:** None  
**Risk Level:** Low — smallest domain, zero cross-domain coupling

| Task | Description | Verify |
|------|-------------|--------|
| 1.1 | Create `domains/recentFiles/` structure | Directory exists |
| 1.2 | Move `routes/recentFiles.js` → `domains/recentFiles/routes.js`, update imports in `index.js` | Server starts, `/api/recent-files` responds |
| 1.3 | Extract business logic into `service.js`; route becomes HTTP-only wrapper | Route file ≤ 30 lines |
| 1.4 | Run `npm run test:ci -- server` for recentFiles-related tests | All pass |

---

### Phase 2: Thumbnails Domain + CacheAdapter Definition ✅ COMPLETE

**Dependencies:** None  
**Risk Level:** Low — self-contained, defines first adapter interface

| Task | Description | Verify |
|------|-------------|--------|
| 2.1 | Define `infrastructure/adapters/cache/InMemoryCacheAdapter.js` with JSDoc contract from Cache interface above | Module loads without error |
| 2.2 | Create `infrastructure/adapters/cache/index.js` factory (`createCacheAdapter()`) | Returns InMemoryCacheAdapter by default |
| 2.3 | Move `utils/thumbnail.js` logic → `domains/thumbnails/services/`: split into `imageProcessor.js`, `videoProcessor.js`, `thumbnailService.js` | Each file ≤ 200 lines |
| 2.4 | Replace raw `Map` in thumbnail cache with CacheAdapter injection | Thumbnail generation works identically |
| 2.5 | Move `routes/thumbnails.js` → `domains/thumbnails/routes.js`, update mount path | `/api/thumbnails` responds |
| 2.6 | **Register remaining Map instances for CacheAdapter migration**: `clientCache` (utils/webdav.js), `userCache` (middleware/permissions.js), `existenceIndex` (store/permissionExistenceIndex.js), `cache`/`shareCache` (store/permissionStore.js) — add tracking list in docs/adapter-migration-log.md. Actual migration happens in their respective phases. | Tracking doc created with all 9 Map instances inventoried |
| 2.7 | Move test file `routes/__tests__/thumbnails.test.js` → `domains/thumbnails/routes/__tests__/` | Test file co-located with source |
| 2.8 | Run server tests | All pass |

---

### Phase 3: Auth Domain Separation ✅ COMPLETE

**Dependencies:** Phase 2 (CacheAdapter)  
**Risk Level:** Medium — auth is called by every route; breaking changes affect everything

This phase separates auth into domain logic (`domains/auth/`) and shared utilities (`utils/auth.js`).
Refresh token management moves entirely into the domain; `authenticateToken` stays in `utils/` as a shared utility.
`users.js` imports `revokeAllUserTokens` from `domains/auth/service` (cross-domain shared service, consistent with Phase 5 aclService pattern).

| Task | Description | Verify |
|------|-------------|--------|
| 3.1 | Create `domains/auth/routes.js` from current `routes/auth.js` (HTTP handlers only, ≤60 lines); update mount in `index.js` | `/api/auth/*` endpoints respond |
| 3.2 | Create `domains/auth/service.js`: expose `loginUser`, `registerUser`, `refreshAccessToken`, `getAuthenticatedUser`, `revokeAllUserTokens`. Rate limiting and refresh token logic internal to service using CacheAdapter | Route ≤ 40 lines, service unit-testable |
| 3.3 | Create `domains/auth/tokenStore.js`: CacheAdapter-based refresh token CRUD (`addRefreshToken`, `validateRefreshToken`, `deleteRefreshToken`, `deleteAllRefreshTokensForUser`). `REFRESH_TOKEN_EXPIRES_IN_DAYS` as internal constant. TTL conversion handled internally | Refresh flow works identically |
| 3.4 | Migrate `loginAttempts` Map to CacheAdapter inside `domains/auth/service.js`. `checkLoginRateLimit`, `recordLoginFailure`, `clearLoginFailures` become internal service functions | Rate limiting behavior preserved (same IP, same window) |
| 3.5 | Clean up `utils/auth.js`: keep only `generateToken`, `verifyToken`, `authenticateToken`, `authenticateTokenOrShare`. Remove all refresh token functions and `REFRESH_TOKEN_EXPIRES_IN_DAYS` | All 8 route files importing `authenticateToken` still work |
| 3.6 | Update `utils/__tests__/auth.test.js`: move refresh token tests (lines 139-199) to `domains/auth/__tests__/tokenStore.test.js`. Keep `authenticateToken`/`generateToken` tests in `utils/__tests__/auth.test.js` | All tests pass |
| 3.7 | Move `routes/__tests__/auth.test.js` → `domains/auth/routes/__tests__/` | Test file co-located with source |
| 3.8 | Update `test-utils.js`: no change needed (`generateToken` stays in `utils/auth.js`) | `npm run test -w server` passes |
| 3.9 | Update `routes/users.js`: change `deleteAllRefreshTokensForUser` import from `../utils/auth` to `revokeAllUserTokens` from `../domains/auth/service` | Password change still invalidates refresh tokens |
| 3.10 | Update docs: `docs/spec/server/routes/auth.md`, `docs/spec/server/utils/auth.md` | Docs reflect new structure |
| 3.11 | Update `docs/adapter-migration-log.md`: mark `refreshTokensStore` and `loginAttempts` as DONE | Log accurate |
| 3.12 | Run full server test suite | All pass |

---

### Phase 0: Dead Code Cleanup (Pre-Phase)

**Dependencies:** None  
**Risk Level:** Very Low — remove orphaned files only

| Task | Description | Verify |
|------|-------------|--------|
| 0.1 | Delete `server/routes/auth.js` — orphaned file with 5 broken imports (stale Phase 3 remnant), not mounted in `index.js` | No `require('./routes/auth')` exists in codebase |
| 0.2 | Run server tests to confirm zero impact | All pass |

---

### Phase 4: Sharing Domain Separation

**Dependencies:** None (parallel with Phase 5)  
**Risk Level:** Low — self-contained lifecycle, minimal cross-domain calls

**Files to relocate:**
- `routes/shareLinks.js` (192 lines) → `domains/sharing/routes/shareLinks.js`
- `routes/sharePublic.js` (285 lines) → `domains/sharing/routes/sharePublic.js`
- `store/shareLinkStore.js` (535 lines) → kept intact, wrapped via facade (Phase 7 MetadataAdapter split)
- `models/ShareLink.js` (80 lines) → kept as thin model wrapper

| Task | Description | Verify |
|------|-------------|--------|
| 4.1 | Create `domains/sharing/` directory structure | Directory exists |
| 4.2 | Move `routes/shareLinks.js` → `domains/sharing/routes/shareLinks.js`; update `index.js` mount: `require('./domains/sharing/routes/shareLinks')` | `/api/share-links` responds |
| 4.3 | Move `routes/sharePublic.js` → `domains/sharing/routes/sharePublic.js`; update `index.js` mount: `require('./domains/sharing/routes/sharePublic')` | `/api/share` responds |
| 4.4 | Extract `services/shareLinkService.js` from shareLinks.js business logic: filePath validation, isMetaPath check, directory vs file detection, permission grant on create, permission revoke on delete | Service unit-testable in isolation |
| 4.5 | Extract `services/shareAccessService.js` from sharePublic.js: `collectPathsUnderSharePath`, `collectDirectoryPathsUnderSharePath`, token validation, permission check logic | Decouples Permission model import from route |
| 4.6 | Apply `mapServiceError` pattern: define `SHARING_ERROR_MAP`, wrap route handlers with `handleServiceError` | Route files ≤ 60 lines |
| 4.7 | Move test files `routes/__tests__/shareLinks.test.js` + `sharePublic.test.js` → `domains/sharing/routes/__tests__/` | Test files co-located with source |
| 4.8 | Run full server test suite | All pass — gate for Phase 5/6 |

**Note:** `shareLinkStore.js` (535 lines) stays as-is in Phase 4. Its 3-way backend branching will be split into MetadataAdapter variants in Phase 7 Task 7.10.

---

### Phase 5: Permissions Domain Separation — **Critical Phase**

**Dependencies:** None (parallel with Phase 4)  
**Risk Level:** High — largest store (1,301 lines), consumed by files/sharing/admin domains

**Reverse dependency to resolve:** `utils/permissionPolicy.js` → `middleware/permissions.js` (utils → middleware violates layering)

**Files involved:**
- `store/permissionStore.js` (1,301 lines) → facade wrapping, internal structure kept intact
- `store/permissionRequestStore.js` (775 lines) → relocated
- `store/permissionExistenceIndex.js` (134 lines) → relocated
- `utils/permissionPolicy.js` (287 lines) → relocated + reverse dependency extracted
- `middleware/permissions.js` (249 lines) → extracts core functions to aclService
- `routes/permissions.js` (321 lines) → split into domain routes
- `routes/permissionRequests.js` (198 lines) → relocated
- `models/Permission.js` (102 lines) → kept as thin wrapper, facade replaces indirection
- `models/PermissionRequest.js` (38 lines) → kept as thin wrapper

**permissionStore.js structural groups (for Phase 7 MetadataAdapter split):**
| Group | Lines | Content |
|-------|-------|---------|
| A. Share Permissions | 108–326 | Token-based share CRUD (separate cache, separate DB table) |
| B. User Permission Persistence | 56–718 | 3-way backend branching (PG/SQLite/FS) — MetadataAdapter target |
| C. Folder Permission Logic | 550–608 | grant/revoke/check on folder paths |
| D. File Permission Logic | 752–956 | File-level permission operations |
| E. Bulk/Admin Operations | 1038–1273 | rewritePermissionsForAllUsers, revokePermissionsPrefixForAllUsers |

| Task | Description | Verify |
|------|-------------|--------|
| 5.1 | Create `domains/permissions/` directory structure | Directory exists |
| 5.2 | Create `domains/permissions/stores/permissionFacade.js` wrapping `permissionStore.js` — expose only needed external functions, all external imports go through facade | facade loads, re-exports correct functions |
| 5.3 | Move `store/permissionRequestStore.js` → `domains/permissions/stores/requestStore.js`; update `models/PermissionRequest.js` import | PermissionRequest model works |
| 5.4 | Move `store/permissionExistenceIndex.js` → `domains/permissions/stores/existenceIndex.js`; update import in `permissionStore.js` and `routes/permissions.js` | Existence checks work identically |
| 5.5 | **Resolve reverse dependency (critical):** (a) Move `utils/permissionPolicy.js` → `domains/permissions/policy/permissionPolicy.js`; (b) Extract `checkFilePermission`, `checkFolderPermission`, `isSharePrincipal` from `middleware/permissions.js` into `domains/permissions/services/aclService.js`; (c) `middleware/permissions.js` imports from `aclService` (direction: middleware → service) | No utils→middleware import; middleware imports service only |
| 5.6 | Create `domains/permissions/services/aclService.js`: single entry `checkPermission(path, principalId, action)` consumed by other domains | Files/sharing routes call aclService instead of Permission model directly |
| 5.7 | Extract `domains/permissions/policy/permissionRank.js` from `permissionStore.js:726` and `permissionPolicy.js:41` — deduplicate | Single source of truth for permission ranking |
| 5.8 | Extract `domains/permissions/policy/inheritancePolicy.js`: "no inheritance" rule + owner exception logic | Policy logic isolated |
| 5.9 | Split `routes/permissions.js` (321 lines) → `domains/permissions/routes/userPathPermissions.js` + `filePermissions.js` | Each ≤ 200 lines |
| 5.10 | Move `routes/permissionRequests.js` → `domains/permissions/routes/permissionRequests.js` | Permission request endpoints respond |
| 5.11 | Apply `mapServiceError` pattern to all permission routes | Route files reduced |
| 5.12 | Update `server/test-utils.js` import paths for store/permissionStore → domains/permissions/stores/* | test-utils loads successfully |
| 5.13 | Move test files: `routes/__tests__/permissions.test.js`, `permissionRequests.test.js`, `store/__tests__/permissionStore*.test.js`, `store/__tests__/permissionRequestStore.test.js` → co-located in `domains/permissions/` | Test files co-located |
| 5.14 | Run full server test suite | All pass — **Phase 6 gate** |

---

### Phase 6: Files Domain Separation — **Critical Phase**

**Dependencies:** Phase 5 (aclService as consumer)  
**Risk Level:** High — largest file (1,552 lines), most dependencies

**Files involved:**
- `routes/files.js` (1,552 lines) → split into 3 route modules
- `routes/folders.js` (98 lines) → relocated
- `services/selectiveTransfer.js` (180 lines) → relocated
- `services/selectiveDownload.js` (91 lines) → relocated
- `services/selectiveDelete.js` (122 lines) → relocated
- `store/bulkJobStore.js` — batch job persistence

**Inline Map instances to migrate to CacheAdapter:**
- `downloadProgress` (line 63) — multi-file download progress
- `operationProgress` (line 64) — generic operation progress
- `previewTickets` (line 68) — video preview ticket store

| Task | Description | Verify |
|------|-------------|--------|
| 6.1 | Create `FileStoreAdapter` interface in `infrastructure/adapters/filestore/` | Interface documented |
| 6.2 | Implement `WebdavFileStoreAdapter` wrapping `utils/webdav.js` functions: `listDirectory`, `getFileContents`, `putFileContents`, `deleteFile`, `moveFile`, `copyFile`, `createDirectory`, `pathExists`, `getFileMetadata` | Adapter provides all file operations |
| 6.3 | Create `infrastructure/adapters/filestore/index.js` factory: `createFileStoreAdapter(config)` | Returns WebdavFileStoreAdapter by default |
| 6.4 | Create `domains/files/` directory structure | Directory exists |
| 6.5 | Extract `domains/files/services/batchOperationService.js` from files.js: `runBulkJobWorker` (~383 lines), `getConflicts`, `checkConflictsRecursive`, `scheduleBulkWorker` | Batch logic isolated, routes slimmed |
| 6.6 | Extract `domains/files/services/downloadService.js` from files.js: `download-multiple` handler (~257 lines), `collectFilesFromDirectory` | Download logic isolated |
| 6.7 | Extract `domains/files/services/fileService.js`: single-file CRUD business logic from route handlers | Service unit-testable |
| 6.8 | Extract `domains/files/services/conflictResolver.js`: `checkConflictsRecursive`, `getConflicts`, `handleSingleOpConflict` | Conflict logic isolated |
| 6.9 | Split `routes/files.js` → `domains/files/routes/crud.js` (list, download, upload, rename, thumbnail), `batch.js` (batch-delete/move/copy, bulk-operation polling), `preview.js` (preview-ticket, preview-stream) | Each ≤ 400 lines |
| 6.10 | Move `routes/folders.js` → `domains/files/routes/folders.js`; update `index.js` mount | `/api/folders` responds |
| 6.11 | Migrate `downloadProgress`, `operationProgress`, `previewTickets` Maps → CacheAdapter injection from Phase 2 | Progress tracking works identically |
| 6.12 | Relocate `services/selectiveTransfer.js`, `selectiveDownload.js`, `selectiveDelete.js` → `domains/files/services/`; update import paths; replace `defaultWebdavAdapter()` with `FileStoreAdapter` from factory | Import paths updated |
| 6.13 | Replace direct Permission model imports in files routes with aclService from Phase 5 | No cross-domain model imports |
| 6.14 | Update `server/test-utils.js` import paths | test-utils loads successfully |
| 6.15 | Move test files: `store/__tests__/bulkJobStore.test.js`, `services/__tests__/*.test.js` → co-located in `domains/files/` | Test files co-located |
| 6.16 | Run full server test suite | All pass — **Phase 7 gate** |

---

### Phase 7: Admin Domain + Infrastructure Extraction

**Dependencies:** Phases 1–6  
**Risk Level:** Medium — admin calls into other domains; needs their service interfaces stable

**Files involved:**
- `routes/admin.js` (510 lines) → split into domain routes
- `routes/users.js` (116 lines) → merged into admin domain
- `routes/settings.js` (19 lines) → relocated
- `store/userStore.js` (821 lines) → split into MetadataAdapter variants
- `store/shareLinkStore.js` (535 lines) → split into MetadataAdapter variants (from Phase 4)
- `store/permissionStore.js` Group B (persistence, ~660 lines) → split into MetadataAdapter variants (from Phase 5)
- `utils/webdav.js` → non-adapter parts extracted
- `store/locks.js` → infrastructure extraction
- `index.js` inline handlers → extracted

| Task | Description | Verify |
|------|-------------|--------|
| 7.1 | Split `routes/admin.js` → `domains/admin/routes/userManagement.js`, `settings.js`, `maintenance.js` | Each ≤ 200 lines |
| 7.2 | Create `domains/admin/services/userService.js`: user lifecycle with rollback semantics (currently inline in admin route) | Admin user CRUD works |
| 7.3 | Create `domains/admin/services/cleanupService.js`: orphan detection logic (currently reaching into storage/locks/metaPaths directly) | Cleanup endpoint works identically |
| 7.4 | Create `utils/sharedHelpers.js`: consolidate duplicated `safeJsonParse`, `nowIso`, `toIsoString` from 6 store files | All stores use centralized helpers |
| 7.5 | Create `infrastructure/lockManager.js` from `store/locks.js`; update all callers | Lock acquisition works across backends |
| 7.6 | Move `utils/webdav.js` non-adapter parts: connection test → `infrastructure/webdavRoutes.js`; type detection (`isImageFile`, `isVideoFile`) → keep as thin wrappers delegating to `@webdav-easyaccess/shared/fileTypes`; WebDAV client management → internal to `WebdavFileStoreAdapter` | No orphans in utils/ |
| 7.7 | Migrate `clientCache` Map (`utils/webdav.js:10`) → CacheAdapter injection | WebDAV connection caching works via CacheAdapter |
| 7.8 | Extract inline route handlers from `index.js`: create `infrastructure/healthRoutes.js` (GET /api/health) and `infrastructure/webdavRoutes.js` (GET /api/webdav/test, /api/webdav/info) | Endpoints respond identically |
| 7.9 | Relocate `scripts/initSqliteSchema.js` → `infrastructure/sqliteSchemaInit.js`; update import in bootstrap | SQLite backend starts without error |
| 7.10 | **Split `store/userStore.js`** (821 lines) into MetadataAdapter variants: `PostgresqlMetadataAdapter.js`, `SqliteMetadataAdapter.js`, `FsJsonMetadataAdapter.js` + `domains/admin/stores/userStore.js` thin wrapper | Each adapter ≤ 300 lines; all user CRUD works |
| 7.11 | **Split `store/shareLinkStore.js`** (535 lines, from Phase 4) into MetadataAdapter variants sharing the same pattern as userStore | Each adapter ≤ 200 lines; share link CRUD works |
| 7.12 | Move `routes/users.js` (116 lines) → `domains/admin/routes/userManagement.js` (merged) | `/api/users/*` responds |
| 7.13 | Move `routes/settings.js` (19 lines) → `domains/admin/routes/settings.js` | `/api/settings/*` responds |
| 7.14 | Update `server/test-utils.js`: all import paths for old store/utils locations → new domain/infrastructure paths | test-utils loads successfully |
| 7.15 | Move 10 test files → co-located with their source domains or `infrastructure/` | Test files co-located |
| 7.16 | Retain `server/testing/mocks/` as shared test double location; update mock import paths | Shared mocks load correctly |
| 7.17 | Update `server/stryker.config.json`: add `domains/**`, `infrastructure/**`; remove `store/**`, `services/**` | Mutation tests cover new structure |
| 7.18 | Update `index.js`: mount all domain routes from new paths; extract `/api/debug-log` into dev-only module | All endpoints respond on correct paths |
| 7.19 | Remove old files: `server/routes/*.js`, `server/store/*.js`, `server/utils/thumbnail.js`, `server/utils/webdav.js`, `server/utils/permissionPolicy.js`, `server/utils/ensureHomeOwnerAdmin.js` | Old directories empty (only shared utilities + email.js + paths.js remain) |
| 7.20 | Run full test suite: `npm run test:ci -w server` then `npm run test:ci -w client` | **Final gate — all pass** |

---

## Future Work

### Redis Introduction
- Replace all in-memory Map instances with `RedisCacheAdapter` implementing the CacheAdapter interface defined in Phase 2
- Targets: refresh tokens (Phase 3), login rate limiting (Phase 3), thumbnail cache (Phase 2), operation progress (Phase 6), bulk job store (Phase 6), **WebDAV client cache** (Phase 7), **middleware user cache** (Phase 5), **permission existence index cache** (Phase 5)
- No route or service code changes required — only adapter swap via environment configuration

### S3 FileStoreAdapter
- Implement `S3FileStoreAdapter` matching the FileStoreAdapter interface defined in Phase 6
- Add `.env` config key: `WEA_FILE_STORAGE=s3|webdav` to select backend
- No route or service code changes required — only adapter swap via factory

### Client-Side Modularization
- `FileManager.js` (927 lines): extract state into dedicated store modules, eliminate 500+ lines of prop bundling
- `useExplorerCommands.js` (689 lines): decompose into individual command hooks (upload, rename, delete, move/copy, download)
- Consider Zustand or lightweight state container for cross-component state

---

## Execution Rules

1. **One phase at a time** (with exception). Phase 4 and Phase 5 may run in parallel since they are independent. Phase 6 depends on Phase 5. Phase 7 depends on Phases 1–6.
2. **No net behavior change.** Each phase must produce identical external behavior (same API responses, same error codes). Verify via existing test suite.
3. **Commit per task.** Small commits with conventional commit messages referencing the phase and task number.
4. **Branch per phase.** Format: `refactor/phase-N-domainname`
5. **Docs first.** Update affected spec files in `docs/spec/server/` before implementation begins for each phase.
6. **Test files move with source.** When a source file is relocated to a new directory, its corresponding `__tests__/` file must be relocated in the same commit. Test files must remain runnable at every commit (update Jest config or use relative paths as needed).
7. **Update `test-utils.js` imports per phase.** After each phase that restructures directories referenced by `server/test-utils.js`, update its import paths in the same commit. Verify by running `npm run test -w server`.
8. **Update `stryker.config.json` mutate paths in Phase 7.** Only after all domains and infrastructure directories are stable. The `store/` and `services/` patterns must be replaced with `domains/**` and `infrastructure/**`.
9. **Test command reference.** Use `npm run test -w server` for full server test suite, `npm run test:unit -w server` for unit tests, `npm run test:integration -w server` for route tests. Root-level test commands may differ (see `package.json`).
10. **Test import paths**: Add `moduleNameMapper` in `jest.config.js` for `@server/*` and `@testing/*` aliases before any test file moves. Update all test imports to use aliases instead of fragile relative paths.
11. **Adapter isolation in service layer.** CacheAdapter, MetadataAdapter, FileStoreAdapter are internal implementation details of the service layer. Service functions must not expose adapter types, TTL parameters, or storage-specific APIs to route handlers or other callers. TTL conversion (e.g., absolute timestamps → relative ttl_ms) is handled internally by the service. Route handlers call only domain operations (loginUser, refreshAccessToken, etc.), never raw adapter methods.

## Execution Order

```
Phase 0 (dead code cleanup)
    ↓
Phase 4 (Sharing) ────────────────────┐
                                        ├→ Phase 6 (Files, depends on Phase 5)
Phase 5 (Permissions) ─────────────────┘         ↓
                                                  Phase 7 (Admin + Infrastructure)
```
