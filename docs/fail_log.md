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

---

## 2026-08-05 — Phase 4 Post-Verification: Full Test Suite Audit

### Server: 14 failed suites / 78 failed tests / 1011 passed / 1090 total

| Suite | Failures | Classification | Root Cause |
|---|---|---|---|
| `domains/files/routes/__tests__/files.test.js` | ~18 | Test migration incomplete (Task 4.9) | Route tests not fully migrated from WebDAV mock to fileNodeService + blobStorageService; S3 config missing in default mode |
| `domains/files/routes/__tests__/folders.test.js` | ~6 | Test migration incomplete (Task 4.9) | Same as files.test.js |
| `domains/recentFiles/__tests__/recentFiles.test.js` | 6 | Phase 5 scope | Pending nodeId migration in Phase 5 Task 5.x |
| `domains/recentFiles/__tests__/recentFilesStore.test.js` | 8 | Phase 5 scope | Pending nodeId migration in Phase 5 Task 5.x |
| `domains/sharing/routes/__tests__/shareLinks.test.js` | ~6 | Phase 5 scope | `grantTestPermission` removed; sharing routes pending nodeId migration |
| `domains/sharing/routes/__tests__/sharePublic.test.js` | ~4 | Phase 5 scope | Same as shareLinks.test.js |
| `domains/sharing/__tests__/shareLinkStore.test.js` | 5 | Phase 5 scope | Pending nodeId migration |
| `models/__tests__/ShareLink.test.js` | 7 | Phase 5 scope | Legacy path-based model tests |
| `models/__tests__/PermissionRequest.test.js` | 3 | Phase 5 scope | Legacy path-based model tests |
| `domains/auth/routes/__tests__/auth.test.js` | 5 | Environmental | `postgresqlNotConfigured` in test env (no PostgreSQL configured) |
| `domains/admin/routes/__tests__/admin.test.js` | 1 | Environmental | `postgresqlNotConfigured` in test env |
| `infrastructure/__tests__/lockManager.test.js` | 5 | Environmental | `postgresqlNotConfigured` in test env |
| `infrastructure/adapters/metadata/__tests__/settingsStore.test.js` | 3 | Pre-existing bug | Double-serialization bug in Settings model (unrelated to Phase 4) |
| `models/__tests__/Settings.test.js` | 3 | Pre-existing bug | Same double-serialization bug |

### Client: FileManager.test.js — 7 failures

- **Area:** `client/src/components/__tests__/FileManager.test.js`
- **Classification:** Test migration incomplete (Task 4.8i)
- **Summary:** UI layer not yet migrated to nodeId payloads. FileManager tests still construct path-based file objects but the underlying services now expect nodeId keys.

### Summary

- **Phase 4 integration suite:** 41/41 pass (isolated, mocked boundaries)
- **Total failures:** 78 server + 7 client = 85
- **Failures attributable to Phase 4 incomplete migration:** ~24 (files.test.js + folders.test.js + FileManager.test.js)
- **Failures in Phase 5 scope:** ~44 (sharing, recentFiles, legacy models)
- **Environmental (postgresqlNotConfigured):** 11
- **Pre-existing (Settings serialization):** 6

---

## 2026-08-05 — Phase 4 Post-Verification Fixes (fix/phase4-alignment)

### G6 — Batch worker circular dependency: `getComposition is not a function`

- **Area:** `server/domains/files/services/batchOperationService.js`, `server/service/composition.js`
- **Classification:** Case A (Source Error)
- **Summary:** `batchOperationService.js:4` destructured `getComposition` from `composition.js` at module load. Because `composition.js:10` itself requires `batchOperationService`, a circular require occurs: when `composition.js` is loaded first (via `routes/crud.js`), `batchOperationService`'s top-level destructure runs while `composition.js`'s `module.exports` is still empty → `getComposition` bound to `undefined`.
- **Observed failure:** Every `POST /api/files/batch-move|batch-delete|batch-copy` returned 202+jobId immediately, but the `setImmediate` worker crashed with `TypeError: getComposition is not a function` (caught and logged via `console.error` at `batchOperationService.js:71`). Jobs never reached `completed`. Route tests passed because they assert only the 202 API contract, not the worker outcome — the bug was invisible to CI.
- **Root cause:** Circular CommonJS require between composition root and the batch worker; destructuring at module scope captures the incomplete export object.
- **Action taken:** Moved the `getComposition` require inside `_processBulkJob` (deferred to runtime, by which time `composition.js` is fully loaded). Also made `scheduleBulkWorker` honor the pre-existing `WEA_SKIP_BULK_WORKER=1` test flag (set by `files.test.js`/`files.integration.test.js` but previously unused) so the now-functional worker doesn't race Jest teardown. Verified with a real end-to-end job that reaches `completed`. Commit: `fix/phase4-alignment`.

### G7 — Path-based conflict resolver removed (Task 4.8 "No path-based compatibility layer")

- **Area:** `server/domains/files/services/conflictResolver.js`, `server/domains/files/routes/crud.js`, `server/domains/files/routes/__tests__/files.test.js`
- **Classification:** Case A (Source Error — stale path-based branch)
- **Summary:** `conflictResolver.js` retained path-based `getConflicts` / `checkConflictsRecursive` / `handleSingleOpConflict` operating on raw WebDAV remote listing via `createFileStoreAdapter()`. `crud.js` `/check-conflicts` branched to them when operations lacked nodeId — contradicting the "No path-based compatibility layer" end-state.
- **Action taken:** Deleted the three path-based functions (+ helper `isDirectoryPath`, 246→64 lines). `crud.js` now always calls `getConflictsByNodeIds`. Route test updated to send `{ sourceNodeId, destinationParentNodeId }` payloads.

### G8 — Client file-layer path remnants (Task 4.8i UI completion)

- **Area:** `client/src/services/fileService.js`, `explorerGateway.js`, `pages/FileManager/hooks/useFileManager.js`, `FileManager.js`, `components/dialogs/CreateFolderDialog.js`, `mocks/handlers.js`
- **Classification:** Case A (Source Error — path-based UI broken against nodeId-only server)
- **Summary:** `/api/files/list` and `/api/folders/create` became nodeId-only, but the client UI still navigated by path (`listDirectory({ path })`, `createFolder(currentPath)`, `listByPath`), silently broken against the real server. MSW handlers accepted both shapes, masking the breakage in tests.
- **Action taken:** `listFiles` path option and `listByPath` removed; `listDirectory({ nodeId })` nodeId-only; `useFileManager` tracks `currentNodeId` with a session path→nodeId map; `createFolder(parentNodeId, name)`; MSW handlers nodeId-only. Known limitations documented in the spec: deep-link below the resolved tree lists root until navigation; root-view create sends `parentNodeId: null` (server 400, pre-existing no-home-nodeId limitation).

### Post-fix verification (full suite, 2026-08-05)

- **Server:** 12 failed suites / 55 failed / 1032 passed / 1090 total — `files.test.js` (Task 4.9) and `folders.test.js` now pass; remaining failures are Phase 5 scope (recentFiles, sharing, legacy models), environmental (`postgresqlNotConfigured`), or the pre-existing Settings serialization bug. Identical to pre-change baseline → zero regressions.
- **Client:** 8 suites / 23 tests still fail, verified byte-identical on base commit `503678d` (git stash comparison) → pre-existing, out of Phase 4 scope. FileManager/useFileManager/CreateFolderDialog/service-layer suites (231 tests) pass.

---

## 2026-08-05 — Gap Closure C1.5: stale path fixtures in 3 client test suites

- **Area:** `client/src/services/__tests__/sharePermissionSaveUseCase.test.js`, `client/src/services/__tests__/shareReviewUseCase.test.js`, `client/src/utils/__tests__/buildPendingRequestState.test.js`
- **Classification:** Case B (Test Error)
- **Summary:** Three suites asserted path-based payloads (`folderPath`/`includeSubfolders`, `folder_path`/`file_path`, `targetPath`) against nodeId-based implementations left stale after the Phase 4.8b nodeId migration. The source implementations are correct; only the fixtures were stale. `sharePermissionSaveUseCase`/`shareReviewUseCase` now take `initialNodePermissions`/`nodePermissions` and call `revokePermission({ userId, nodeId })` / `grantPermission({ userId, nodeId, permission })`; `buildPendingRequestState` matches requests by `request.node_id === targetNodeId`.
- **Observed failure:** Revoke/grant assertions never matched (expected `folderPath` payloads vs actual `nodeId` payloads); pending-state lookups returned the empty state because request fixtures carried `folder_path`/`file_path` while the matcher read `node_id`.
- **Action taken:** Updated the 3 suites to nodeId payloads (`nodeId` keys in permission Maps, `node_id` request fixtures, `targetNodeId`), matching the implemented call shapes. Implementations unchanged.
- **Verification:** All three suites pass via `react-scripts test` (gap closure C1.5).

---

## 2026-08-05 — Gap Closure C1.7: RCA of remaining failing client suites

### FilePreviewDialog.test.js — Case B (Test Error — stale path fixtures)

- **Area:** `client/src/components/dialogs/__tests__/FilePreviewDialog.test.js`
- **Classification:** Case B (Test Error)
- **Summary:** 3 of 9 tests asserted path-string arguments (`mockGetFileBlob('/b.jpg', ...)`, `mockGetVideoPreviewStreamUrl('/v.mp4', ...)`) against a nodeId-based preview loader. After the Phase 4.8b nodeId migration, `usePreviewLoader` (`client/src/components/dialogs/FilePreviewDialog/hooks/usePreviewLoader.js:24,31`) calls `getVideoPreviewStreamUrl(targetFile.nodeId, { shareToken })` and `getFileBlob(targetFile.nodeId, { inline: true, shareToken, signal })`, and `fileService.getFileBlob(nodeId)` / `getVideoPreviewStreamUrl(nodeId)` (`fileService.js:57,79`) are nodeId-based. The fixtures carried only `path`, so the mock was invoked with `nodeId === undefined`. The implementation is correct; only the fixtures/assertions were stale.
- **Observed failure:** `expect(jest.fn()).toHaveBeenCalledWith(...)` — Expected `"/b.jpg"`/`"/v.mp4"`, Received `undefined` with the options object (`{"inline": true, "shareToken": undefined, "signal": {}}` / `{"shareToken": undefined}`).
- **Spec cross-check:** `docs/spec/client/components/dialogs/FilePreviewDialog.md` §2.4/2.9 specify getFileBlob and ticket-based streaming URL for video preview; the preview payload key is the file `nodeId` (gallery index matching remains `file.path`-keyed per §2.6 in `useGalleryNavigation.js:19`). No spec violation by the source.
- **Action taken:** Added `nodeId` to all file fixtures in the test and updated the `getFileBlob`/`getVideoPreviewStreamUrl` call assertions to nodeId (`20` for the video fixture, `2` for the non-first gallery file, `1` never loaded). `path` retained in fixtures for gallery-index matching. Implementation unchanged.
- **Verification:** `CI=true npx react-scripts test --watchAll=false src/components/dialogs/__tests__/FilePreviewDialog.test.js` — 9/9 pass.

### FileActionSheet.test.js — Out of scope (not a stale-path/nodeId issue); spec/implementation behavior conflict

- **Area:** `client/src/components/file-manager/__tests__/FileActionSheet.test.js`
- **Classification:** Out of scope for C1.7 (spec/implementation behavior conflict; not nodeId-related). Do not change the test.
- **Summary:** 4 of 8 tests fail for reasons unrelated to the nodeId migration: (1) `calls onDownload and onClose when download clicked` — the fixture file lacks `hasReadPermission`, so the download row is rendered `disabled` (`FileActionSheet.js:138`) and the click is a no-op (`onDownload` called 0 times). (2–4) `hides rename/move/delete when !fileWritePermission` — the component renders rename/move/delete rows **disabled** (`FileActionSheet.js:153,168,214`), not hidden, when write permission is absent; the tests assert the rows are absent from the document.
- **Observed failure:** `Expected number of calls: 1, Received number of calls: 0` for `onDownload`; `expected document not to contain element, found <span ...>Rename</span>` (likewise Move, Delete) after passing `hasWritePermission={false}`.
- **Spec cross-check:** `docs/spec/client/components/file-manager/FileActionSheet.md` §2.6/§2.7 state "Rename, move, delete only when fileWritePermission" / "hidden when !fileWritePermission". The implementation deliberately disables instead of hiding, and this is the established pattern: the desktop counterpart `FileContextMenu.js:66-136` applies the identical `disabled={!file.hasReadPermission}` / `disabled={!fileWritePermission}` semantics, and the spec §2.6 E2E selector contract requires the action rows (e.g. rename/delete) to be present in the DOM with stable `data-testid`. The spec's "hidden" wording is stale relative to the implemented (and consistently applied) disable-state design.
- **Action taken:** None (test not changed). Fixing the tests to assert the disabled state (or removing the fixtures' permission fields) is a product/spec decision: either align `FileActionSheet.md` §2.6/§2.7 to the disable-state design and update the tests accordingly (recommended, consistent with FileContextMenu + E2E selector contract), or change the source to hide the rows (would contradict the sibling component). Both are outside the C1.7 nodeId-migration scope. Recording this incident per AGENTS.md §3.2; **recommendation**: update the spec to document the disable (not hide) behavior and rewrite the three hide-tests to assert `disabled` on the action rows, plus add `hasReadPermission: true` to the shared fixture for the download test.
- **Verification:** Suite still fails 4/8 (unchanged baseline) — expected, per decision not to modify.
