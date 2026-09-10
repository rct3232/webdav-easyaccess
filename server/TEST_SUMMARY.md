# Server Test Implementation Summary

## Overview

Summary of the test implementation for the Express.js server application. All tests follow **black-box testing**: assertions focus on observable outcomes (return values, API responses, HTTP status codes), not implementation details. WebDAV and blob stores use test doubles; data stores follow the tiered model in [docs/TESTING_STRATEGY.md](../docs/TESTING_STRATEGY.md) — L1 functional suites run against doubles or per-suite real sqlite, while L2 repository conformance suites run against real sqlite (default `test:ci` leg) and, under the adapter leg, real PostgreSQL. Test files are colocated with source under `domains/<x>/` (routes, services, stores, policy), plus shared `service/`, `store/`, `infrastructure/`, `middleware/`, `models/`, and `utils/`.

## Test Statistics

- **Total Test Suites**: 99 (sqlite `test:ci`, as of 2026-09-10)
- **Total Tests**: 1849 (1844 passed, 5 skipped)
- **Pass Rate**: 100% (1844 passed, 0 failed) ✅
- **Real-PostgreSQL adapter leg** (`test:ci:pg:adapters`): 207 tests (latest recorded run, 2026-09-09)
- **Execution Time**: Reported per run by `npm run test`

> New/extended suites since the 2026-09-04 snapshot: `infrastructure/__tests__/trashSoftDeleteSchema.test.js` (new; registered on the PG adapter leg), extended `failSafeService` (pending_upload scan/repair, DEF-12/13) and `gcService` (retention categories: garbage/version/guarded/pending-live) suites. 2026-09-10: trash-schema DDL folded into `001_initial_normalized_schema.sql` (single-file chain) — removed 5 tests (4 converter table-rebuild tests in `sqliteSchemaInit`, the pre-fold sqlite in-place migration scenario in `trashSoftDeleteSchema`).

## Test Breakdown by Category

### Unit Tests

Single modules in isolation (models, middleware, utils, domain-internal stores). External dependencies (WebDAV, file system, blob stores) are mocked or use test doubles.

| Test File                                                | Notes                                            |
| -------------------------------------------------------- | ------------------------------------------------ |
| `models/__tests__/User.test.js`                          | User CRUD, status, password                      |
| `models/__tests__/Settings.test.js`                      | Settings model                                   |
| `models/__tests__/ShareLink.test.js`                     | ShareLink CRUD                                   |
| `models/__tests__/PermissionRequest.test.js`             | Permission request model                         |
| `middleware/__tests__/requireUser.test.js`               | JWT auth, 401 handling                           |
| `middleware/__tests__/permissions.test.js`               | Permission checks, read/write validation         |
| `middleware/__tests__/requestLogger.test.js`             | Request logging middleware                       |
| `utils/__tests__/auth.test.js`                           | Token generation, verification, password hashing |
| `utils/__tests__/email.test.js`                          | Email utilities                                  |
| `utils/__tests__/errorHandler.test.js`                   | Error formatting, status mapping                 |
| `utils/__tests__/sharedConstants.test.js`                | Shared constant definitions                      |
| `utils/__tests__/sharedFileTypes.test.js`                | Shared file type helpers                         |
| `utils/__tests__/sharedPathUtils.test.js`                | Shared path utilities                            |
| `utils/__tests__/sharedValidation.test.js`               | Shared validation helpers                        |
| `utils/__tests__/webdav.test.js`                         | Recursive folder stats aggregation               |
| `domains/auth/__tests__/tokenStore.test.js`              | Auth token store                                 |
| `domains/recentFiles/__tests__/recentFilesStore.test.js` | Recent files store/service (nodeId)              |
| `domains/sharing/__tests__/shareLinkStore.test.js`       | Share link store                                 |

### Service Tests

Domain services, policies, and stores plus the shared service/store layer. Persistence and external adapters use test doubles (the permission store suites below mock the driver — they are not real-PostgreSQL runs).

| Test File                                                                 | Notes                         |
| ------------------------------------------------------------------------- | ----------------------------- |
| `domains/files/services/__tests__/batchOperationService.test.js`          | Batch operations service      |
| `domains/files/services/__tests__/downloadService.test.js`                | Download service              |
| `domains/files/services/__tests__/fileService.test.js`                    | File service operations       |
| `domains/permissions/policy/__tests__/inheritancePolicy.test.js`          | Permission inheritance policy |
| `domains/permissions/policy/__tests__/ownerNodeResolver.test.js`          | Owner node resolution         |
| `domains/permissions/policy/__tests__/permissionPolicy.test.js`           | Permission policy             |
| `domains/permissions/services/__tests__/aclService.test.js`               | ACL service                   |
| `domains/permissions/stores/__tests__/permissionStore.postgresql.test.js` | Permission store (mocked PG driver — unit test, not a real-PG run) |
| `domains/permissions/stores/__tests__/permissionStore.test.js`            | Permission store              |
| `domains/permissions/stores/__tests__/requestStore.test.js`               | Permission request store      |
| `domains/thumbnails/services/__tests__/thumbnail.test.js`                 | Thumbnail generation service  |
| `service/__tests__/_ancestryHelper.test.js`                               | Ancestry helper               |
| `service/__tests__/blobStorageService.test.js`                            | Blob storage service          |
| `service/__tests__/composition.test.js`                                   | Service composition           |
| `service/__tests__/failSafeService.test.js`                               | Fail-safe service (orphaned_node + pending_upload scan/repair) |
| `service/__tests__/fileNodeService.test.js`                               | File node service             |
| `service/__tests__/gcService.test.js`                                     | GC service (retention categories, last-good guard) |
| `service/__tests__/uploadService.test.js`                                 | Upload service                |
| `store/__tests__/fileNodesStore.test.js`                                  | File nodes store              |
| `store/__tests__/settingsStore.test.js`                                   | Settings store                |
| `store/__tests__/storage.test.js`                                         | Storage operations            |
| `store/__tests__/userStore.test.js`                                       | User store operations         |

### Infrastructure Tests

Schema, storage, locking, scheduling, executor seam, and blob store adapters.

| Test File                                                              | Notes                 |
| ---------------------------------------------------------------------- | --------------------- |
| `infrastructure/__tests__/ddlValidation.test.js`                       | DDL validation        |
| `infrastructure/__tests__/lockManager.test.js`                         | Lock manager          |
| `infrastructure/__tests__/maintenanceScheduler.test.js`                | Maintenance scheduler |
| `infrastructure/__tests__/schemaManager.test.js`                       | Schema manager        |
| `infrastructure/__tests__/sqliteSchemaInit.test.js`                    | SQLite schema init    |
| `infrastructure/__tests__/trashSoftDeleteSchema.test.js`               | Trash soft-delete schema (`deleted_at` + partial unique indexes; backend-agnostic uniqueness describe runs on both legs, sqlite-only describes gated off the PG adapter leg) |
| `infrastructure/db/__tests__/executor.test.js`                         | Executor seam (L2)    |
| `infrastructure/adapters/blobstore/__tests__/blobstoreFactory.test.js` | Blob store factory    |
| `infrastructure/adapters/blobstore/__tests__/S3BlobStore.test.js`      | S3 blob store         |
| `infrastructure/adapters/blobstore/__tests__/WebdavBlobStore.test.js`  | WebDAV blob store     |

### Repository Conformance Tests (L2)

Repository interfaces run against the active backend via `createTestDatabase()` — real sqlite on the default `test:ci` leg, real PostgreSQL on the `test:ci:pg:adapters` leg (see `docs/spec/server/store/repository-contract.md`).

| Test File                                                                 | Notes                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------- |
| `store/repositories/__tests__/SettingsRepository.conformance.test.js`     | Settings repository conformance                |
| `store/repositories/__tests__/UserRepository.conformance.test.js`         | User repository conformance                    |
| `store/repositories/__tests__/ShareLinkRepository.conformance.test.js`    | ShareLink repository conformance               |
| `store/repositories/__tests__/RecentFilesRepository.conformance.test.js`  | RecentFiles repository conformance             |
| `store/repositories/__tests__/FileNodeRepository.conformance.test.js`     | FileNode repository conformance                |
| `domains/permissions/stores/repositories/__tests__/PermissionRepository.conformance.test.js`        | Permission repository conformance              |
| `domains/permissions/stores/repositories/__tests__/PermissionRequestRepository.conformance.test.js` | Permission request repository conformance      |

### Integration Tests

API route tests with Supertest. Full request/response cycle; backing services use test doubles.

| Test File / Area                                                  | Notes                                                                         |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `domains/admin/routes/__tests__/admin.test.js`                    | Admin users, settings                                                         |
| `domains/admin/routes/__tests__/settings.test.js`                 | User settings                                                                 |
| `domains/admin/routes/__tests__/users.test.js`                    | User CRUD, password                                                           |
| `domains/auth/routes/__tests__/auth.test.js`                      | Register, login, logout, token refresh                                        |
| `domains/files/routes/__tests__/files.integration.test.js`        | End-to-end file flows                                                         |
| `domains/files/routes/__tests__/files.test.js`                    | List, download, upload, rename, batch operations, metadata, download-multiple |
| `domains/files/routes/__tests__/folders.test.js`                  | Create folder, list                                                           |
| `domains/permissions/routes/__tests__/permissionRequests.test.js` | Create, approve, deny requests                                                |
| `domains/permissions/routes/__tests__/permissions.test.js`        | Grant, revoke, list permissions                                               |
| `domains/recentFiles/routes/__tests__/recentFiles.test.js`        | Recent files API                                                              |
| `domains/sharing/routes/__tests__/shareLinks.test.js`             | Create, list, delete share links                                              |
| `domains/sharing/routes/__tests__/sharePublic.test.js`            | Public share resolution                                                       |
| `domains/thumbnails/routes/__tests__/thumbnails.test.js`          | Thumbnail generation                                                          |
| `infrastructure/routes/__tests__/healthRoutes.test.js`            | Health check                                                                  |

## Coverage Report

### Coverage Goals (from TESTING_STRATEGY)

- **New code:** ≥80%
- **Refactored code:** ≥90%
- **Core business logic:** ≥95%

### Key Modules & Overall Project Coverage

Overall project coverage (sqlite `test:ci` with `--coverage`, measured 2026-09-09):

| Scope     | Statements | Branches | Functions | Lines |
| --------- | ---------- | -------- | --------- | ----- |
| All files | 72.35%     | 63.17%   | 76.65%    | 73.46% |

Per-module figures are intentionally not reproduced here (they move per run). Measure the current layout with `cd server && npm run test:coverage`; core modules (models, middleware, auth, errorHandler) historically maintain the highest coverage.

## Conclusion

- 1844 tests across 99 suites, 100% pass rate (5 skipped, as of 2026-09-10, sqlite `test:ci`); real-PostgreSQL adapter leg `test:ci:pg:adapters`: 207 tests (latest recorded run, 2026-09-09)
- Tests are colocated with source: domain routes/services/stores/policy under `domains/<x>/`, shared layer under `service/` and `store/`, plus `infrastructure/`, `middleware/`, `models/`, `utils/`
- Route integration tests cover main API endpoints via Supertest
- L2 repository conformance suites (store + permission repositories, executor) run against real sqlite and, on the adapter leg, real PostgreSQL
- Test infrastructure and commands documented
- RCA procedure for failures defined
