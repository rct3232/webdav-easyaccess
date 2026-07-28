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
│   │   ├── routes.js
│   │   ├── service.js          — Token issue/revoke, password hash
│   │   └── sessionStore.js     — Uses CacheAdapter for refresh tokens + rate limiting
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
│   ├── sharedHelpers.js        — safeJsonParse, nowIso, toIsoString (deduplicated)
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

### Phase 3: Auth Domain Separation

**Dependencies:** Phase 2 (CacheAdapter)  
**Risk Level:** Medium — auth is called by every route; breaking changes affect everything

| Task | Description | Verify |
|------|-------------|--------|
| 3.1 | Create `domains/auth/routes.js` from current `routes/auth.js`; update mount in `index.js` | `/api/auth/*` endpoints respond |
| 3.2 | Extract token issuance, password hashing, user validation into `service.js` | Route handlers ≤ 40 lines each |
| 3.3 | Migrate `refreshTokensStore` (Map in utils/auth.js) → CacheAdapter via injection | Refresh flow works, tokens stored via adapter |
| 3.4 | Migrate `loginAttempts` (Map in routes/auth.js) → CacheAdapter | Rate limiting behavior preserved |
| 3.5 | Keep `authenticateToken` middleware in `utils/auth.js` (shared utility, not domain-specific) | All authenticated routes still work |
| 3.6 | Move test files `routes/__tests__/auth.test.js` → `domains/auth/routes/__tests__/` | Test file co-located with source |
| 3.7 | Run full server test suite | All pass |

---

### Phase 4: Sharing Domain Separation

**Dependencies:** None  
**Risk Level:** Low — self-contained lifecycle, minimal cross-domain calls

| Task | Description | Verify |
|------|-------------|--------|
| 4.1 | Create `domains/sharing/routes/shareLinks.js` from current `routes/shareLinks.js` | Mount path updated in index.js |
| 4.2 | Create `domains/sharing/routes/sharePublic.js` from current `routes/sharePublic.js` | Public endpoints respond |
| 4.3 | Extract link lifecycle into `services/shareLinkService.js` (create, expire, revoke) | Service unit testable in isolation |
| 4.4 | Extract token-based access logic into `services/shareAccessService.js` | Decouples permission model import from route |
| 4.5 | Move share link persistence to use MetadataAdapter pattern (or keep as dedicated store if simpler) | Share link CRUD works |
| 4.6 | Move test files `routes/__tests__/shareLinks.test.js` + `sharePublic.test.js` → `domains/sharing/routes/__tests__/` | Test files co-located with source |
| 4.7 | Run server tests | All pass |

---

### Phase 5: Permissions Domain Separation — **Critical Phase**

**Dependencies:** None  
**Risk Level:** High — largest store, consumed by files/sharing/admin domains

This phase wraps `permissionStore.js` (1,301 lines) with a facade pattern and resolves the reverse dependency between `utils/permissionPolicy.js` ↔ `middleware/permissions.js`.
`permissionStore.js` internal structure is kept intact until S3/PostgreSQL backend introduction enables tree-based permissions.

| Task | Description | Verify |
|------|-------------|--------|
| 5.1 | Create `domains/permissions/stores/permissionFacade.js` wrapping `permissionStore.js` — control external access, expose only needed functions | All external imports go through facade |
| 5.2 | Move `store/permissionRequestStore.js` → `domains/permissions/stores/requestStore.js` | Permission request flow works |
| 5.3 | Move `store/permissionExistenceIndex.js` → `domains/permissions/stores/existenceIndex.js` | Existence checks work identically |
| 5.4 | Resolve reverse dependency: move `utils/permissionPolicy.js` into `domains/permissions/policy/`; `middleware/permissions.js` imports from service layer only | No utils→middleware import chain |
| 5.5 | Create `services/aclService.js`: single entry point for `checkPermission(path, user, action)` consumed by other domains | Files/sharing routes call aclService instead of Permission model directly |
| 5.6 | Split current `routes/permissions.js` into domain route files; update mount paths | All permission endpoints respond |
| 5.7 | Move `routes/permissionRequests.js` → `domains/permissions/routes/` | Permission request endpoints respond |
| 5.8 | Update `server/test-utils.js` import paths for store/permissionStore → domains/permissions/stores/* | test-utils loads successfully |
| 5.9 | Move test files: `routes/__tests__/permissions.test.js`, `permissionRequests.test.js`, `store/__tests__/permissionStore*.test.js`, `store/__tests__/permissionRequestStore.test.js` → co-located in `domains/permissions/` | Test files co-located with source |
| 5.10 | Run full server test suite | All pass — this is the gate for Phase 6 |

---

### Phase 6: Files Domain Separation — **Critical Phase**

**Dependencies:** Phase 5 (aclService as consumer)  
**Risk Level:** High — largest file, most dependencies

This phase splits `files.js` (1,552 lines) into three route modules, extracts business logic to services, and incorporates `routes/folders.js` (98 lines).

| Task | Description | Verify |
|------|-------------|--------|
| 6.1 | Create `FileStoreAdapter` interface in `infrastructure/adapters/filestore/`; extract WebDAV CRUD from `utils/webdav.js` into `WebdavFileStoreAdapter` | Adapter provides all file operations currently used by files route |
| 6.2 | Extract `runBulkJobWorker` + conflict detection from `files.js` into `domains/files/services/batchOperationService.js` (~400 lines) | Batch operation logic isolated, routes slimmed |
| 6.3 | Extract `download-multiple` handler from `files.js` into `domains/files/services/downloadService.js` (~260 lines) | Download logic isolated |
| 6.4 | Split `routes/files.js` → `domains/files/routes/crud.js`, `batch.js`, `preview.js` | Each ≤ 400 lines |
| 6.5 | Move `routes/folders.js` → `domains/files/routes/folders.js`; update mount path in `index.js` | `/api/folders` responds |
| 6.6 | Extract inline Maps (`downloadProgress`, `operationProgress`, `previewTickets`) to use CacheAdapter from Phase 2 | Progress tracking works identically |
| 6.7 | Relocate `services/selectiveTransfer.js`, `selectiveDownload.js`, `selectiveDelete.js` → `domains/files/services/` (files already exist at `server/services/` — physical move + import path update) | Import paths updated, tests pass |
| 6.8 | Replace direct Permission model imports in files routes with aclService from Phase 5 | No more cross-domain model imports |
| 6.9 | Update `server/test-utils.js` import paths for store references | test-utils loads successfully |
| 6.10 | Move `store/__tests__/bulkJobStore.test.js`, `services/__tests__/*.test.js` → co-located in `domains/files/` | Test files co-located with source |
| 6.11 | Run full server test suite | All pass — this is the gate for Phase 7 |

---

### Phase 7: Admin Domain + Infrastructure Extraction

**Dependencies:** Phases 1–6  
**Risk Level:** Medium — admin calls into other domains; needs their service interfaces stable

| Task | Description | Verify |
|------|-------------|--------|
| 7.1 | Split `routes/admin.js` → `domains/admin/routes/userManagement.js`, `settings.js`, `maintenance.js` | Each route ≤ 200 lines |
| 7.2 | Create `services/userService.js`: user lifecycle with rollback (currently inline in admin route) | Admin user CRUD works |
| 7.3 | Create `services/cleanupService.js`: orphan detection logic (currently reaching into storage/locks/metaPaths directly) | Cleanup endpoint works identically |
| 7.4 | Extract shared helpers: consolidate duplicated `safeJsonParse`, `nowIso`, `toIsoString` from 6 store files → `infrastructure/sharedHelpers.js` | All stores use centralized helpers |
| 7.5 | Create `infrastructure/lockManager.js` from current `store/locks.js`; update all callers | Lock acquisition works across backends |
| 7.6 | Move `utils/webdav.js` non-adapter parts (connection testing, type detection) to appropriate locations: connection test → `infrastructure/webdavRoutes.js`, type detection → `shared/fileTypes.js` | No orphans in utils/ |
| 7.7 | **Migrate `clientCache` (Map in `utils/webdav.js:10`)** to use CacheAdapter injection | WebDAV connection caching works via CacheAdapter |
| 7.8 | **Extract inline route handlers from `index.js`**: create `infrastructure/healthRoutes.js` (GET /api/health) and `infrastructure/webdavRoutes.js` (GET /api/webdav/test, GET /api/webdav/info). Mount them via `index.js`. `/api/debug-log` stays gated by NODE_ENV. | `/api/health`, `/api/webdav/test`, `/api/webdav/info` respond identically |
| 7.9 | **Relocate `scripts/initSqliteSchema.js`** → `infrastructure/sqliteSchemaInit.js`; update import in `store/bootstrap.js` (or new `infrastructure/bootstrap.js`) | SQLite backend starts without error |
| 7.10 | **Split `store/userStore.js`** (821 lines) into MetadataAdapter variants (`PostgresqlMetadataAdapter`, `SqliteMetadataAdapter`, `FsJsonMetadataAdapter`) + `domains/admin/stores/userStore.js` thin wrapper | Each adapter file ≤ 300 lines; all user CRUD flows work |
| 7.11 | **Move `routes/users.js`** (116 lines) → `domains/admin/routes/userManagement.js` (merged with admin user routes) | All `/api/users/*` endpoints respond |
| 7.12 | **Move `routes/settings.js`** (19 lines) → `domains/admin/routes/settings.js` | All `/api/settings/*` endpoints respond |
| 7.13 | **Update `server/test-utils.js`**: update all import paths referencing old store/ and utils/ locations to new domain/infrastructure paths | test-utils loads successfully |
| 7.14 | **Move test files**: `routes/__tests__/admin.test.js`, `routes/__tests__/users.test.js`, `routes/__tests__/settings.test.js`, `routes/__tests__/health.test.js`, `store/__tests__/userStore.test.js`, `store/__tests__/storage.test.js`, `store/__tests__/locks.test.js`, `store/__tests__/settingsStore.test.js`, `store/__tests__/recentFilesStore.test.js`, `store/__tests__/shareLinkStore.test.js` → co-located with their source domains or `infrastructure/` | Test files co-located with source |
| 7.15 | **Explicitly retain `server/testing/mocks/` as shared test double location** — update mock import paths in all test files. If a domain needs domain-specific mocks, add `domains/<name>/testing/` | Shared mocks still load correctly |
| 7.16 | **Update `server/stryker.config.json` mutate paths**: add `domains/**`, `infrastructure/**`; remove `store/**` and `services/**` (now under domains/) | Mutation tests cover new structure |
| 7.17 | Update `index.js`: mount all domain routes from new paths; extract `/api/debug-log` into a separate dev-only module; verify middleware chain unchanged | All endpoints respond on correct paths |
| 7.18 | Remove old files: `server/routes/*.js`, `server/store/*.js`, `server/utils/thumbnail.js`, `server/utils/webdav.js`, `server/utils/permissionPolicy.js`, `server/utils/ensureHomeOwnerAdmin.js`, unused helpers | File count in old directories = 0 (or only shared utilities + email.js + paths.js) |
| 7.19 | Run full test suite: `npm run test:ci -w server` then `npm run test:ci -w client` | All pass — final gate |

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

1. **One phase at a time.** Do not begin Phase N+1 until Phase N tests pass.
2. **No net behavior change.** Each phase must produce identical external behavior (same API responses, same error codes). Verify via existing test suite.
3. **Commit per task.** Small commits with conventional commit messages referencing the phase and task number.
4. **Branch per phase.** Format: `refactor/phase-N-domainname`
5. **Docs first.** Update affected spec files in `docs/spec/server/` before implementation begins for each phase.
6. **Test files move with source.** When a source file is relocated to a new directory, its corresponding `__tests__/` file must be relocated in the same commit. Test files must remain runnable at every commit (update Jest config or use relative paths as needed).
7. **Update `test-utils.js` imports per phase.** After each phase that restructures directories referenced by `server/test-utils.js`, update its import paths in the same commit. Verify by running `npm run test -w server`.
8. **Update `stryker.config.json` mutate paths in Phase 7.** Only after all domains and infrastructure directories are stable. The `store/` and `services/` patterns must be replaced with `domains/**` and `infrastructure/**`.
9. **Test command reference.** Use `npm run test -w server` for full server test suite, `npm run test:unit -w server` for unit tests, `npm run test:integration -w server` for route tests. Root-level test commands may differ (see `package.json`).
10. **Test import paths**: Add `moduleNameMapper` in `jest.config.js` for `@server/*` and `@testing/*` aliases before any test file moves. Update all test imports to use aliases instead of fragile relative paths.
