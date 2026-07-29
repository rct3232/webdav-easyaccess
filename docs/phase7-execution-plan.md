# Phase 7 Execution Plan — Admin Domain + Infrastructure Extraction

## Objective
Refactor remaining legacy routes (admin, users, settings) into admin domain, extract infrastructure services, split userStore/shareLinkStore into MetadataAdapter variants, and clean up index.js.

## Branch
`refactor/phase7-admin-infrastructure`

## Wave 1 — Independent Foundation Tasks (Parallel)

### T7.4: Create `utils/sharedHelpers.js`
- **Objective**: Consolidate duplicated helpers from 7 store files
- **Files to create**: `server/utils/sharedHelpers.js`
- **Helpers**: `safeJsonParse` (4 copies), `nowIso` (5 copies), `toIsoString` (4 copies)
- **Source files to clean** (in T7.4b):
  - `store/userStore.js:16-41`
  - `store/locks.js:10-20`
  - `store/settingsStore.js:6-8`
  - `store/shareLinkStore.js:36-41`
  - `store/recentFilesStore.js:26`
  - `domains/permissions/stores/permissionStore.js:24-28`
  - `domains/permissions/stores/permissionRequestStore.js:15-40`
- **Verify**: `npm run test -w server` passes
- **Dependencies**: None

### T7.5: Extract `infrastructure/lockManager.js`
- **Objective**: Move `store/locks.js` to infrastructure
- **Files**: `store/locks.js` (272 lines) → `infrastructure/lockManager.js`
- **Keep shim**: `store/locks.js` → re-export from `../infrastructure/lockManager`
- **Update internal imports**: `./storage` → `../store/storage`, `./metaPaths` → `../store/metaPaths`
- **Verify**: Lock tests pass
- **Dependencies**: None

### T7.6: Restructure `utils/webdav.js`
- **Objective**: Separate adapter functions from route/infra functions
- **Extract**:
  - `testConnection` → `infrastructure/webdavTest.js`
  - `isImageFile`, `isVideoFile` → `utils/fileTypes.js`
- **Keep in webdav.js**: All WebDAV client functions (adapter-level)
- **Verify**: Server starts, WebDAV tests pass
- **Dependencies**: None

### T7.10: Split `userStore.js` into MetadataAdapter variants
- **Objective**: Split 821-line 3-way branching into 3 backend adapters
- **Create**:
  - `infrastructure/adapters/metadata/PostgresqlMetadataAdapter.js` (~200 lines)
  - `infrastructure/adapters/metadata/SqliteMetadataAdapter.js` (~200 lines)
  - `infrastructure/adapters/metadata/FsJsonMetadataAdapter.js` (~250 lines)
  - `infrastructure/adapters/metadata/index.js` — factory
- **Shared logic**: `mapUserRow`, `normalizeEmail` (outside adapters)
- **Keep shim**: `store/userStore.js` → re-export from adapter factory
- **Functions to implement per adapter**:
  - `findByUsername`, `findByEmail`, `findById`
  - `createUser`, `updateStatus`, `updateEmail`, `updatePassword`, `deleteUser`
  - `findAll`, `findByStatus`
- **Verify**: `store/__tests__/userStore.test.js` passes
- **Dependencies**: None

### T7.11: Split `shareLinkStore.js` into MetadataAdapter variants
- **Objective**: Split 535-line 3-way branching into 3 backend adapters
- **Add to same adapter files as T7.10**:
  - `createShareLink`, `getShareLink`, `getUserShareLinks`
  - `updateShareLink`, `deleteShareLink`, `incrementDownloadCount`
- **Keep pure function**: `isLinkExpired` outside adapters
- **Keep shim**: `store/shareLinkStore.js` → re-export from adapter factory
- **Verify**: `store/__tests__/shareLinkStore.test.js` passes
- **Dependencies**: None

## Wave 2 — Dependent on Wave 1

### T7.7: Migrate `clientCache` Map → CacheAdapter
- **Objective**: Replace raw Map in `utils/webdav.js:10` with CacheAdapter
- **Change**: `getWebDAVClient()` and `resetWebDAVClient()` use CacheAdapter
- **TTL**: None (permanent cache, matching current behavior)
- **Verify**: WebDAV connection tests pass
- **Dependencies**: T7.6

### T7.8: Extract `infrastructure/healthRoutes.js` + `webdavRoutes.js`
- **Objective**: Extract inline handlers from index.js
- **Create**:
  - `infrastructure/healthRoutes.js` — `GET /api/health`
  - `infrastructure/webdavRoutes.js` — `GET /api/webdav/test`, `GET /api/webdav/info`
- **Verify**: Endpoints respond correctly
- **Dependencies**: T7.6

### T7.9: Move `scripts/initSqliteSchema.js` → `infrastructure/sqliteSchemaInit.js`
- **Objective**: Relocate SQLite schema initialization
- **Keep re-export shim** in scripts/ for CLI usage
- **Update**: `store/bootstrap.js:13` import path
- **Verify**: SQLite backend starts
- **Dependencies**: None (parallel with Wave 1)

### T7.1: Split `routes/admin.js` into domain routes
- **Objective**: Split 510-line route file into 3 domain routes
- **Create**:
  - `domains/admin/routes/userManagement.js` (~250 lines) — user CRUD routes
  - `domains/admin/routes/settings.js` (~50 lines) — settings routes
  - `domains/admin/routes/maintenance.js` (~180 lines) — cleanup, folders, ensure-home-owner
- **Each route**: HTTP handlers only, business logic in services
- **Verify**: All `/api/admin/*` endpoints respond
- **Dependencies**: None (parallel with Wave 1)

### T7.2: Create `domains/admin/services/userService.js`
- **Objective**: Extract user lifecycle business logic
- **Functions**: `createAdminUser`, `approvePendingUser`, `rejectPendingUser`, `deleteUserCascade`, `bulkUpdateUserPermissions`
- **Verify**: Service unit-testable
- **Dependencies**: T7.1

### T7.3: Create `domains/admin/services/cleanupService.js`
- **Objective**: Extract orphan detection and cleanup logic
- **Functions**: `cleanupOrphanedData`, delegate `ensureHomeOwnerAdminForAllUsers`
- **Verify**: Cleanup endpoint works
- **Dependencies**: T7.1

## Wave 3 — Route Integration

### T7.12: Merge `routes/users.js` into admin domain
- **Objective**: Consolidate user routes into admin domain
- **Move**: `routes/users.js` (117 lines, 6 routes) → `domains/admin/routes/userManagement.js`
- **Update mount**: `index.js:73` → new path
- **Verify**: `/api/users/*` endpoints respond
- **Dependencies**: T7.1

### T7.13: Move `routes/settings.js` into admin domain
- **Objective**: Relocate settings route
- **Move**: `routes/settings.js` (19 lines) → `domains/admin/routes/settings.js`
- **Update mount**: `index.js:75` → new path
- **Verify**: `/api/settings/public` responds
- **Dependencies**: T7.1

### T7.10b: Update userStore import paths
- **Objective**: Update all importers after MetadataAdapter split
- **Files**: `models/User.js`, `store/bootstrap.js`, `domains/permissions/stores/permissionStore.js`, `domains/auth/tokenStore.js`
- **Strategy**: Use re-export shim (import paths unchanged)
- **Verify**: All user-related tests pass
- **Dependencies**: T7.10

### T7.11b: Update shareLinkStore import paths
- **Objective**: Update all importers after MetadataAdapter split
- **Files**: `models/ShareLink.js`
- **Strategy**: Use re-export shim
- **Verify**: Share link tests pass
- **Dependencies**: T7.11

## Wave 4 — Integration

### T7.4b: Apply sharedHelpers to store files
- **Objective**: Replace inline helpers with sharedHelpers imports
- **Files**: 7 store files listed in T7.4
- **Verify**: All tests pass
- **Dependencies**: T7.4

### T7.14: Update `test-utils.js` import paths
- **Objective**: Align test utilities with new structure
- **Verify**: `npm run test -w server` loads successfully
- **Dependencies**: T7.9, T7.10b, T7.11b

### T7.17: Update `stryker.config.json`
- **Objective**: Update mutation test targets
- **Change**: `domains/**`, `infrastructure/**` replace `store/**`, `services/**`
- **Verify**: Config loads without error
- **Dependencies**: All domain/infra directories stable

### T7.18: Clean up `index.js`
- **Objective**: Remove legacy mounts, use new paths
- **Changes**:
  - Legacy route mounts → new domain paths
  - Inline handlers → extracted modules
  - Old imports → new locations
- **Verify**: All endpoints respond
- **Dependencies**: Wave 2+3 complete

## Wave 5 — Cleanup

### T7.15: Move test files (17 files)
- **Objective**: Co-locate tests with source
- **Move**: All test files from `routes/__tests__/` and `store/__tests__/` to domain/infra locations
- **Verify**: `npm run test -w server` passes
- **Dependencies**: T7.14

### T7.16: Update mock paths
- **Objective**: Update `server/testing/mocks/` imports
- **Verify**: Tests with mocks pass
- **Dependencies**: T7.15

### T7.19: Remove legacy files
- **Delete**:
  - `routes/admin.js`, `routes/users.js`, `routes/settings.js`
  - `utils/ensureHomeOwnerAdmin.js`
  - `utils/webdav.js` (after adapter integration)
  - `utils/permissionPolicy.js` (already deleted in Phase 5)
- **Keep shims**: `store/userStore.js`, `store/shareLinkStore.js`, `store/permissionStore.js`
- **Verify**: No require() errors
- **Dependencies**: T7.18

### T7.20: Final test run
- **Commands**: `npm run test:ci -w server` → `npm run test:ci -w client`
- **Verify**: All pass
- **Dependencies**: All tasks complete

## Commit Convention
Format: `refactor(phase7): T7.X — description`

## Risk Mitigation
- T7.10/T7.11 (MetadataAdapter split) — highest risk; verify each adapter independently
- Re-export shims maintain backward compatibility for Model layer
- `ensureHomeOwnerAdmin.js` has existing broken import (Phase 5 remnant) — fixed in T7.6/T7.8
