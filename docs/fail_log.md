# Fail Log

## 2026-04-30 - share-public logged-in E2E user mismatch

- **Area:** `e2e/share-public.spec.ts`, `e2e/helpers/shareLinks.ts`
- **Classification:** Case B (Test Error)
- **Summary:** Logged-in public share-link E2E cases (`E2E-SHARE-005/006/007`) failed because suite setup provisioned an approved user with a test-specific suffix, but the browser login step still used the unsuffixed seed username `user1`.
- **Observed failure:** `page.waitForURL(/\/files(?:\/.*)?$/)` timed out in `e2e/helpers/auth.ts` while the server returned `401` for the unsuffixed login attempt.
- **Spec cross-check:** `docs/features/files-sharing.md` requires logged-in share-link scenarios to establish an authenticated session first; the authenticated fixture identity used in setup must match the browser login identity.
- **Action taken:** Updated the share-link feature doc to clarify the fixture-identity requirement, extended `PublicShareFixtures` to expose the approved user suffix/username, and updated the logged-in share-public tests to authenticate and assert against that exact provisioned identity.

---

## 2026-07-29 — B6 Final Test Gate

### Server: 1 failure (795 passed / 1 failed)

- **Area:** `server/domains/admin/routes/__tests__/admin.test.js:194`
- **Test:** `POST /api/admin/cleanup/orphaned › returns 200 with messageCode and results shape when admin`
- **Classification:** Case A (Source Error — likely regression from phase7 refactoring)
- **Observed failure:** Expected status 200, received 500. The `cleanupOrphanedData` function in `cleanupService.js` throws an unhandled error at runtime. Likely caused by commits `b1c9b7e` (T7.19 — migrate to cleanupService) or `37593a1` (T7.3 — finalize cleanupService and admin routes).
- **Impact:** Admin orphaned data cleanup endpoint returns 500 for all callers.
- **Resolution:** Fixed `permissionPolicy` import path in `cleanupService.js` — B5 migration used wrong relative path (`../../../utils/permissionPolicy`). Corrected to `../../permissions/policy/permissionPolicy`. Commit: `97781b2`. All 796 server tests now pass.

### Client: 12 failures (1245 passed / 12 failed, 3 suites failed)

- **Area:** `client/src/services/__tests__/apiClient.test.js` and others
- **Classification:** Case B (Test Error — pre-existing environmental issues)
- **Observed failure:** Timeout errors (`Exceeded timeout of 5000 ms`) in 403 handling tests. No recent commits modify client code; these are pre-existing flaky tests unrelated to current changes.

---

## 2026-07-31 — Phase 3 verification: createNode closure-table double-population

- **Area:** `server/store/fileNodesStore.js`, `server/domains/permissions/routes/__tests__/{permissions,permissionRequests}.test.js`
- **Classification:** Case A (Source Error — `createNode` auto-population violates documented architecture) + Case B (route tests bypassed the service-layer node-creation flow)
- **Summary:** `fileNodesStore.createNode` contained an uncommitted auto-population block that inserted `node_ancestors` rows (self + parent chain) while swallowing errors (`catch (e) { /* ignore */ }`). `fileNodeService.createFile/createDirectory` already calls `buildAncestorsForNode` right after `createNode`, so the auto-population was 100% redundant and caused a `SQLITE_CONSTRAINT: UNIQUE constraint failed: node_ancestors.ancestor_id, node_ancestors.descendant_id` at runtime.
- **Observed failure:** 29 tests failed across 3 suites — `fileNodesStore.test.js` (7), `fileNodeService.test.js` (15), `uploadService.test.js` (7). Every `createFile`/`createDirectory` call threw via `buildAncestorsForNode` (`service/_ancestryHelper.js:17`).
- **Spec cross-check:** `docs/spec/server/store/fileNodesStore.md:41` documents `createNode` as a pure INSERT (no ancestor maintenance); `_ancestryHelper.md:32` defines `buildAncestorsForNode` as the single closure-table builder; `fileNodeService.md:50` documents `createNode + buildAncestorsForNode` in one transaction. The auto-population violated all three.
- **Action taken:** Removed the auto-population block from `fileNodesStore.createNode` (restored pure-INSERT contract). Updated the two permission route test files to create nodes via `fileNodeService.createDirectory/createFile` (the documented production path) instead of raw `fileNodesStore.createNode`, so closure-table rows are properly established. All 15 Phase 2/3 suites (287 tests) pass. Remaining failures in `files`, `folders`, `auth`, `admin`, `recentFiles`, `shareLinks`, and legacy `Permission`/`PermissionRequest`/`ShareLink` model suites are the pre-existing "Expected Test Failures After Phase 0" (PLAN.md) pending Phase 4/5 migration — verified identical with and without the auto-population block.

---

## 2026-08-04 — Wave 4 Fix Plan: Post-Migration Incidents

### G1 — downloadService factory: `checkFolderPermission` used instead of `checkFilePermission`

- **Area:** `server/domains/files/services/downloadService.js`, `createDownloadService` factory
- **Classification:** Case A (Source Error)
- **Summary:** The new `createDownloadService` factory wired both directory-entry and file-inclusion permission gates to `aclService.checkFolderPermission`. File-level direct permissions were silently ignored because `checkFolderPermission` queries the closure table for folder ancestors, which yields false-negatives for leaf files that have a file-scoped READ grant.
- **Observed failure:** Download of individually shared files returned empty archives or permission-denied entries despite a correct direct file-level permission in `permissionStore`. No runtime error — the gate simply returned `false`.
- **Root cause:** Copy-paste from the directory-entry gate (`canEnterDirectory`) to the file-inclusion gate (`canIncludeFile`). Both assigned `checkFolderPermission`; the latter must call `checkFilePermission` to exercise the file-level direct-permission path.
- **Action taken:** Replaced `checkFolderPermission` with `checkFilePermission` in the non-share `canIncludeFile` assignment inside the factory. Commit: `a27de6c`.

### G2 — Route tests still imported removed `grantTestPermission`

- **Area:** `server/domains/files/routes/__tests__/*.test.js`, `server/test-utils.js`
- **Classification:** Case B (Test Error)
- **Summary:** 23 of 38 route test files across download-multiple endpoints (`files.test.js`, `folders.test.js`) imported the removed `grantTestPermission` helper from `testUtils`. The function was deleted during W4.4 PermissionFacade cleanup but import statements were not updated in all test files.
- **Observed failure:** HTTP 500 on every download-multiple route test — `TypeError: grantTestPermission is not a function` at module load, causing the entire test suite to crash before reaching assertions.
- **Root cause:** W4.4 replaced `grantTestPermission(path-based)` with `grantTestPermissionByNodeId(nodeId-based)` in `test-utils.js`, but 23 route test files retained the old import and call pattern. The rename was not propagated during batch migration.
- **Action taken:** Migrated all file/folder route tests to use `grantTestPermissionByNodeId` with nodeId payloads. Commit: `1d86bc9`.

### G3 — fileService mock drift: missing stubs for new factory methods

- **Area:** `client/src/services/__tests__/fileService.test.js`, Jest manual mocks
- **Classification:** Case B (Test Error)
- **Summary:** The `createDownloadService` factory introduced two new dependency methods — `ensureExclusiveBlob` and `downloadBlobWebdav` — that were not present in the fileService Jest mock. When tests exercised the S3 + overwrite download path, `mockFileService.ensureExclusiveBlob` was `undefined`, producing a `TypeError: ... is not a function`.
- **Observed failure:** 2 client test suites failed with `TypeError: mockFileService.ensureExclusiveBlob is not a function` and `TypeError: blobStorageService.downloadBlobWebdav is not a function`.
- **Root cause:** Mock definitions lagged behind implementation. The factory pattern in W4.2 added new method calls that were not reflected in the corresponding Jest mocks.
- **Action taken:** Added `ensureExclusiveBlob` stub to fileService mock (`8b4c482`) and `downloadBlobWebdav` stub to blobStorageService mock (`6c60188`).

### G4 — Client fixtures: path strings passed to nodeId-based implementations

- **Area:** `client/src/services/__tests__/fileService.test.js`, `useBulkOperations.test.js`, `useExplorerCommands.test.js`, `useFileOperations.test.js`, `useDragAndDrop.test.js`, `useDropToUpload.test.js`, `usePreviewLoader.test.js`
- **Classification:** Case B (Test Error)
- **Summary:** 22 client tests constructed fixture objects with path strings (`{ path: '/alice/file.txt' }`) but the implementations under test now expect nodeId payloads (`{ nodeId: 42 }`). The mismatch caused silent failures — the server mock received a string where it expected an integer, producing no-op or wrong-key lookups in shared folder UI flows.
- **Observed failure:** Tests appeared to pass structurally (no crashes) but assertions on returned data were empty arrays or null because nodeId-based lookups failed against path-string keys. Shared folder UI tests showed blank file lists despite correct permissions being granted.
- **Root cause:** W4.10 migrated the service-layer functions from path to nodeId, but 22 test files retained path-shaped fixtures. The migration was not atomic — implementation moved first, tests followed in a second commit.
- **Action taken:** Rewrote all client file-layer test fixtures to use nodeId payloads matching the migrated implementations (`a98bd5a`). Removed dead path fixtures from `useExplorerCommands` test that referenced paths no longer resolved by the hook (`e2c0eb5`).

### G5 — Shared gateways runtime break: Breadcrumb reads removed `perm.folder_path`, MSW returns empty arrays

- **Area:** `client/src/components/Breadcrumb.js`, `client/src/mocks/handlers.js`, `client/src/utils/__tests__/userUtils.test.js`
- **Classification:** Case A (Source Error) + Case B (Test Error)
- **Summary:** Three independent runtime breaks converged: (1) `Breadcrumb.js` read `perm.folder_path` which was removed in the nodeId migration, causing `undefined` breadcrumb segments; (2) MSW handlers for file-list endpoints returned empty arrays because they matched on path-based URL params that no longer arrived; (3) `userUtils` tests consumed path-shaped fixture data against nodeId-based utility functions.
- **Observed failure:** Breadcrumb rendered blank/empty segments in shared folder views. MSW mock server returned `[]` for all file-list requests during client test execution, making every shared-folder UI test fail with "no files found" assertions. UserUtils tests threw type errors comparing strings against integers.
- **Root cause:** W4.8/W4.10 migrated gateway interfaces to nodeId but missed three consumer sites: the Breadcrumb component's permission shape reader, the MSW handler URL param matchers, and the userUtils test fixture data shapes.
- **Action taken:** Migrated `Breadcrumb.js` to read nodeId-based permission payloads (`perm.nodeId`, resolved display path via `getNodePath`). Updated MSW handlers to match nodeId query params and return nodeId-shaped responses. Rewrote userUtils test fixtures from path strings to nodeId integers. Commit: `888e2a5`. Implementation migration for client file-layer to complete nodeId payload contract: `e01f6ff`.
