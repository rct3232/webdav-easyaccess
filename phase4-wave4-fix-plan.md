# Phase 4 Wave 4 — Fix Plan (post-verification)

> This document is the single source of truth for finishing the Wave 4 migration.
> Work through it **one task at a time in order**. Every task has an objective,
> exact files, steps, and a verification gate. Do not skip verification.
> The Wave 4 feature branch already exists: `feature/phase4-wave4-permission-cleanup`.

---

## 1. Background (verified state)

The server-side legacy cleanup of Wave 4 is **correct and complete**:

- All Wave 4 grep verification commands return empty:
  - `fileService.js`, `batchOperationService.js`, `downloadService.js`: no `buildSync*` / `checkPermissionSync` / `isOwnerPath`
  - `aclService.js`: no `buildSync` / `isOwnerPath` / `canAccessPath` / `userRootPath`
  - `ownerNodeResolver.js` + whole server: no `isOwnerPath` / `userRootPath` / `getHomeOwnerUserIdForPath`
  - `PermissionFacade` and `models/Permission.js` deleted; zero production references
- `folders.js` migrated to `permissionStore.grant(userId, nodeId, perm)`.
- `test-utils.js` now exports `grantTestPermissionByNodeId` (NOT `grantTestPermission`).
- Client file-layer implementation is fully nodeId-based and correct.

**But the following gaps remain** (verified by running the actual suites):

| # | Area | Failures | Root cause |
|---|------|----------|-----------|
| G1 | `downloadService.js` | 9 (server) | W4.2 never implemented the `createDownloadService` factory; legacy middleware is dead code |
| G2 | `files.test.js` + `folders.test.js` | 22 (server) | still import removed `grantTestPermission` |
| G3 | `fileService.test.js` | 1 (server) | mock missing `ensureExclusiveBlob` |
| G4 | client fixtures (5 suites) | 22 (client) | tests pass path strings; impls already nodeId |
| G5 | shared gateways | runtime break | `filterOutUserOwnFolders` reads removed `folder_path` |
| G6 | docs-first | violation | zero `.md` changed in Wave 4 range |
| G7 | `fail_log.md` | missing | no Wave 4 RCA entries |

**Deferred (documented at the end, do NOT fix):** share/recentFiles Phase 5 scope, Settings bug, lockManager sqlite bug, admin path-grant NaN, S3-env 500s.

---

## 2. Rules — MUST follow (from AGENTS.md + project conventions)

1. **Docs-first (AGENTS.md §2.1).** Before touching any source file for a task, update the affected spec/feature docs in `docs/spec/` / `docs/features/`. Task 8 is the dedicated docs pass — do it **before** re-running the full gate, and make small doc updates inline as you go where the plan calls for it.
2. **Branch.** You are already on `feature/phase4-wave4-permission-cleanup`. Do NOT create another branch and do NOT work on `main`/`dev`. Do NOT merge — the user handles merge/CI.
3. **Commit per task (AGENTS.md §2.2/§2.3).** One conventional commit per task:
   - `feat:` / `fix:` / `refactor:` / `test:` + short lowercase description.
   - Non-trivial commits MUST include a body with `Why:` / `What:` / `Impact / verification:`.
   - Check `git log --oneline -20` first to match style.
4. **Verify "what", not "how" (§3.1).** Assert observable outcomes, never internals.
5. **RCA on any test failure (§3.2) — STOP before modifying code.**
   - Case A (source violates spec) → STOP, ask user.
   - Case B (test misinterprets) → fix test.
   - Case C (spec undefined) → STOP, ask user.
   - Log every incident in `docs/fail_log.md`.
6. **Minimal changes.** Only touch files listed per task. Do not refactor unrelated code.
7. **Never modify files the plan does not list** for a given task without noting it in the commit.
8. **Update `phase4-sub-plan-wave4.md`** Completed Tasks table + Handoff checklist as tasks finish.

---

## 3. Lessons learned / trial-and-error (do not repeat)

These are empirically confirmed gotchas from the verification pass:

- **L1 — `downloadService.js` is dead code.** No production route imports it. The download-multiple logic was inlined into `preview.js` during W3.6. When implementing the factory (Task 1) you must refactor `preview.js` to delegate, or you will create a duplicate implementation. The spec is `docs/spec/server/services/downloadService.md`.
- **L2 — `grantTestPermission` was removed in W4.4**, replaced by `grantTestPermissionByNodeId({ userId, fileNodeId, permission })` in `server/test-utils.js`. Any remaining `grantTestPermission` call → `TypeError: grantTestPermission is not a function`. Migrate fixtures to real nodes via `fileNodeService.createFile/createDirectory` (the documented production path — raw `fileNodesStore.createNode` bypasses closure-table maintenance and caused a double-population bug on 2026-07-31, see `docs/fail_log.md`).
- **L3 — `fileService.test.js` mock must mirror the real `blobStorageService`.** The real service exposes `ensureExclusiveBlob` (added in `88f3ace`); the mock in the test does not. Missing method → `TypeError` on the S3+overwrite path. When adding interface methods to services, update mocks in the same commit.
- **L4 — client hook paths differ from the plan's grep paths.** The hooks live at:
  - `client/src/pages/FileManager/hooks/` (useBulkOperations, useExplorerCommands, useFileOperations)
  - `client/src/components/dialogs/FilePreviewDialog/hooks/usePreviewLoader.js`
  - NOT `client/src/hooks/`. Fix the grep paths in `phase4-sub-plan-wave4.md` (Task 7), otherwise verification greps silently check the wrong files.
- **L5 — server `/permissions/user/:id` and `/file/list` return nodeId-only payloads.**
  - `/permissions/user/:id` → `{ nodeId, permission }`
  - `/permissions/file/list` → `{ file_node_id, permission }`
  - There is **no** `folder_path` / `filePath` field anymore. Any client code reading those fields (e.g. `filterOutUserOwnFolders` in `client/src/utils/userUtils.js`) silently breaks at runtime even though tests pass — because tests mock path-shaped data. Fix BOTH the implementation and the mocks/fixtures together.
- **L6 — MSW `/permissions/user` returns `[]`.** Shared-section tests cannot exercise nodeId shape until realistic fixtures are seeded.
- **L7 — the test suite runs on sqlite; `WEA_STORAGE_BACKEND=fs` fallback is harmless.** The recurring `SQLITE_MISUSE: Database handle is closed` + `process.exit(1)` at the end of some suites is teardown noise from `index.js` — do NOT treat it as a task failure.
- **L8 — some server failures are genuinely NOT Wave 4's responsibility** (Settings JSON double-serialization, `share_links.file_path`/`recent_files.path` column mismatch = Phase 5, sqlite lockManager bug, admin path→NaN grant, S3-env composition-root 500s). Do not "fix" them by hacking around; document in the Deferred section.

---

## 4. Tasks

### Task 1 — W4.2: implement `createDownloadService` factory (G1) — HIGH

**Objective:** Replace dead legacy `downloadService.js` with the spec factory; refactor `preview.js` to delegate.

**Files:**
- `server/domains/files/services/downloadService.js`
- `server/domains/files/routes/preview.js`
- `server/service/composition.js`
- `server/domains/files/services/__tests__/downloadService.test.js`

**Steps:**
1. Implement `createDownloadService({ fileNodeService, blobStorageService, aclService })` returning:
   - `downloadMultiple(nodeIds, userId, user)`
   - `getDownloadProgress(downloadId)`
2. Per spec `docs/spec/server/services/downloadService.md`:
   - Per-file permission pre-check via `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ)` in `Promise.allSettled`.
   - All-fail → return 403 (no ZIP assembly).
   - Per-node: resolve node via `fileNodeService`, stream `blobStorageService.downloadBlob(nodeId)`, append to archiver with display name; errors → `{ nodeId, reason }` entries; continue on failure.
   - Track progress via the operation-progress store; `getDownloadProgress` returns `{ completed, total, percentage }` or `null` for unknown.
3. Refactor `preview.js` `/download-multiple` and `/download-progress` to call the factory obtained from `getComposition()`. **Preserve** current HTTP behavior: `Content-Type: application/zip`, `Content-Disposition` + zip naming, `X-WEA-Skipped` / `X-WEA-Skipped-Count` headers, 403 on all-denied.
4. Delete legacy middleware: `detectIsDirectory`, `selectiveCollectFiles` usage, all `paths`-based logic, `getFileContents`/`listDirectory` imports.
5. Run the existing `downloadService.test.js` and fix implementation until green (do not rewrite the test to fit the old middleware).

**Verification:**
```bash
cd server && npx jest domains/files/services/__tests__/downloadService.test.js --no-coverage
# all pass
grep -n "getFileContents\|selectiveCollectFiles\|detectIsDirectory" server/domains/files/services/downloadService.js
# empty
```

**Commit:** `feat: implement createDownloadService factory and delegate preview routes (W4.2)`

---

### Task 2 — W4.4: migrate route tests to `grantTestPermissionByNodeId` (G2) — HIGH

**Objective:** Make `files.test.js` and `folders.test.js` use the nodeId test helper and real nodes.

**Files:**
- `server/domains/files/routes/__tests__/files.test.js`
- `server/domains/files/routes/__tests__/folders.test.js`

**Steps:**
1. Replace every `grantTestPermission(userId, folderPath, permission)` call with:
   ```js
   await grantTestPermissionByNodeId({ userId, fileNodeId, permission });
   ```
2. Rework fixtures so the permission is granted on a **real node**: create the node via `fileNodeService.createFile/createDirectory` (not raw `fileNodesStore.createNode` — see L2), and use the returned `node.id` as `fileNodeId`.
3. Update path-typed assertions to the nodeId response shape (`nodeId`, `display_path`, `parentNodeId`).

**Verification:**
```bash
cd server && npx jest domains/files/routes/__tests__/files.test.js domains/files/routes/__tests__/folders.test.js --no-coverage
# all pass
grep -rn "grantTestPermission\b" server/ --include="*.js"
# empty
```

**Commit:** `test: migrate file/folder route tests to grantTestPermissionByNodeId (W4.4)`

---

### Task 3 — W4.0: fix `fileService.test.js` mock (G3) — LOW

**Objective:** Add the missing `ensureExclusiveBlob` stub.

**File:** `server/domains/files/services/__tests__/fileService.test.js`

**Steps:**
1. In `createMockBlobStorageService`, add:
   ```js
   ensureExclusiveBlob: jest.fn(),
   ```
2. Mirror the real `service/blobStorageService.js` method set so the mock stays in sync (see L3).

**Verification:**
```bash
cd server && npx jest domains/files/services/__tests__/fileService.test.js --no-coverage
# all pass
```

**Commit:** `test: add ensureExclusiveBlob stub to fileService mock (W4.0)`

---

### Task 4 — W4.8: remove `collectSubfolderPaths` (G4-a) — MEDIUM

**Objective:** Delete the last path-based utility; no imports remain.

**Files:**
- `client/src/utils/folderUtils.js`
- `client/src/utils/__tests__/folderUtils.test.js`
- `client/src/services/__tests__/shareTargetPermissionSaveUseCase.test.js`

**Steps:**
1. Delete `collectSubfolderPaths` from `folderUtils.js`, then delete the file if it exports nothing else (verify no other exports first).
2. Delete `folderUtils.test.js`.
3. Remove the `collectSubfolderPaths: jest.fn()` mock + import from `shareTargetPermissionSaveUseCase.test.js`.
4. Confirm `shareTargetPermissionSaveUseCase.js` itself no longer imports it (verified: it does not).

**Verification:**
```bash
grep -rn "collectSubfolderPaths" client/src --include="*.js"
# empty
cd client && CI=true npx react-scripts test --watchAll=false --no-coverage --testPathPattern="shareTargetPermissionSaveUseCase"
# pass
```

**Commit:** `refactor: remove collectSubfolderPaths path utility (W4.8)`

---

### Task 5 — W4.9: rewrite client test fixtures to nodeId (G4-b) — HIGH

**Objective:** All 5 suites pass with nodeId fixtures. **Implementations are already correct — fix only the tests.**

**Files:**
- `client/src/pages/FileManager/hooks/__tests__/useExplorerCommands.test.js`
- `client/src/hooks/__tests__/useDropToUpload.test.js`
- `client/src/hooks/__tests__/useDragAndDrop.test.js`
- `client/src/services/__tests__/folderPickerGateway.test.js`
- `client/src/services/__tests__/folderTreeGateway.test.js`

**Steps (per suite):**
1. **useExplorerCommands** — replace path fixtures `'/docs'`, `'/docs/a.txt'` with nodeId/parentNodeId; update assertions: `targetPath`→`parentNodeId`, `startedPath`→`startedNodeId`, `filePaths`→`nodeIds`, `operations: [{sourcePath,destinationPath}]`→`{ files }` / `{ sourceNodeId, destinationParentNodeId }`. Provide `currentNodeIdRef` where the hook reads `startedNodeId`.
2. **useDropToUpload / useDragAndDrop** — fixtures use `nodeId`/`parentNodeId`; drop targets resolve nodeId, not destination path.
3. **folderTreeGateway / folderPickerGateway** — call `listFiles(nodeId)`, not `'/root'`; assert results keyed by `nodeId` (no `path` field in folder-tree output).

**Verification:**
```bash
cd client && CI=true npx react-scripts test --watchAll=false --no-coverage \
  --testPathPattern="useExplorerCommands|useDropToUpload|useDragAndDrop|folderPickerGateway|folderTreeGateway"
# all pass
```

**Commit:** `test: rewrite client file-layer fixtures to nodeId payloads (W4.9)`

---

### Task 6 — W4.10/A2: fix shared-gateway nodeId runtime break (G5) — HIGH

**Objective:** The `__shared__` UI works against the nodeId server payload; no `folder_path`/`filePath` reads remain.

**Files:**
- `client/src/utils/userUtils.js` (`isUserOwnFolder`, `filterOutUserOwnFolders`)
- `client/src/services/explorerGateway.js` (`loadSharedEntries`)
- `client/src/services/folderTreeGateway.js` (`getUserSharedFolderPermissions`)
- `client/src/services/folderPickerGateway.js` (`getUserSharedFolderPermissions`)
- `client/src/components/file-manager/Breadcrumb.js`
- `client/src/mocks/handlers.js`
- tests: `client/src/services/__tests__/explorerGateway.test.js`, plus any suite asserting path-shaped permission data

**Steps:**
1. Reimplement `isUserOwnFolder`/`filterOutUserOwnFolders` on nodeId: compare permission `nodeId`/`file_node_id` against the user's root node (resolve via ownerNodeResolver / `user.rootNodeId`), never `perm.folder_path`.
2. Update `loadSharedEntries` and the two gateway `getUserSharedFolderPermissions` to consume `{ nodeId, permission }` / `{ file_node_id, permission }` and map entries by nodeId.
3. Update `Breadcrumb.js` usages to the nodeId-based helpers.
4. Seed realistic nodeId permission fixtures in MSW `/permissions/user` and `/permissions/folder`.
5. Update tests that mock path-shaped permission data (they currently pass for the wrong reason — L5).

**Verification:**
```bash
grep -rn "folder_path\|\.filePath" client/src/utils/userUtils.js client/src/services/explorerGateway.js client/src/services/folderTreeGateway.js client/src/services/folderPickerGateway.js
# empty (display-path usage only)
cd client && CI=true npx react-scripts test --watchAll=false --no-coverage \
  --testPathPattern="explorerGateway|folderTreeGateway|folderPickerGateway|Breadcrumb"
# all pass
```

**Commit:** `fix: migrate shared permission helpers to nodeId payloads (W4.10)`

---

### Task 7 — W4.10: correct plan verification paths (G4-c) — LOW

**File:** `phase4-sub-plan-wave4.md`

**Steps:**
1. Update the W4.9/W4.10 grep and test commands to real paths:
   - `client/src/pages/FileManager/hooks/useBulkOperations.js`
   - `client/src/pages/FileManager/hooks/useFileOperations.js`
   - `client/src/pages/FileManager/hooks/useExplorerCommands.js`
   - `client/src/components/dialogs/FilePreviewDialog/hooks/usePreviewLoader.js`
2. Replace the current wrong paths (`client/src/hooks/useBulkOperations.js`, etc.).

**Verification:** the documented commands execute without "No such file".

**Commit:** `docs: fix Wave 4 verification paths in sub-plan (W4.10)`

---

### Task 8 — C1: docs-first compliance (G6) — MEDIUM

**Objective:** Docs reflect the actual Wave 4 end state before the final gate.

**Files (create/update):**
- **CREATE** `docs/spec/server/domains/permissions/services/aclService.md` — record the W4.0 decision on batch permission checks (`checkPermissionsBatch` vs per-item `Promise.all`).
- **UPDATE** `docs/spec/server/permissions.md` / `store/permissionStore.md` — note `permissionFacade.js` and `models/Permission.js` were deleted; store is the source of truth.
- **UPDATE** `docs/spec/server/utils/permissionPolicy.md` — nodeId-only exports.
- **UPDATE** `docs/spec/client/services/permissionService.md` — nodeId contracts (verify it is current; it already is largely).
- **UPDATE** `docs/spec/server/services/downloadService.md` — mark factory as implemented per Task 1.

**Verification:** no stale `grantTestPermission` / `PermissionFacade` references in `docs/spec/`.

**Commit:** `docs: update spec docs for Wave 4 nodeId end state (W4.0-4.10)`

---

### Task 9 — C2: fail_log + wave-4 status (G7) — LOW

**Files:** `docs/fail_log.md`, `phase4-sub-plan-wave4.md`

**Steps:**
1. Add RCA entries (AGENTS.md §3.2 format) for the Wave 4-caused failures: downloadService factory (Task 1), route tests (Task 2), mock drift (Task 3), 22 client fixtures (Task 5).
2. Record the Deferred group (Section 5) with rationale.
3. Mark all W4.0–W4.10 rows complete in the plan's Completed Tasks table with the passed verification output; tick the Handoff-to-Wave-5 checklist items.

**Verification:** `docs/fail_log.md` contains a Wave 4 section; plan table all `✅`.

**Commit:** `docs: log Wave 4 RCA incidents and finalize sub-plan status`

---

## 4b. Post-verification audit findings (2026-08-04)

Independent code review of completed tasks revealed the following defects:

### Task 1 rework ✅ FIXED — commit `a27de6c`

**Defect was:** `aclService.checkFolderPermission` → fixed to `checkFilePermission(userId, nodeId, PERMISSIONS.READ)`. Added `not_found` error entries for unresolvable nodes. Tests updated. **9/9 pass.**

### Task 3 rework ✅ FIXED — commit `6c60188`

**Defect was:** Missing `downloadBlobWebdav` in mocks → added to both `fileService.test.js` (41/41) and `downloadService.test.js` (9/9).

### Task 4 — ✅ Verified correct. No changes needed.

### Task 5 rework ✅ FIXED — commit `e2c0eb5`

**Defect was:** Dead path data (`currentPath: '/docs'`) in useExplorerCommands fixture → removed. **8/8 pass.**

### Task 6 rework ✅ FIXED — commit pushed

**Fixed:**
1. Breadcrumb.js — replaced `perm.folder_path` with `perm.nodeId`; added homePath prefix guard for `isUserOwnFolder`
2. handlers.js — seeded realistic `{ nodeId, permission }` MSW fixtures
3. userUtils.test.js — rewritten to nodeId-shaped data

**Remaining concerns (out of plan scope):**
- `deriveFolderPickerSharedState.js:22`, `useShareDialog.js`, `SharedFoldersSection.js`, `useFolderTreeController.js` still read `folder_path` — not in Task 6 file list; defer to next wave.

---

## 5. Deferred — document only, do NOT fix

| Failure | Root cause | Owner |
|---|---|---|
| `shareLinkStore`, `shareLinks`, `sharePublic`, `ShareLink` model (~28) | adapter writes `share_links.file_path` but DDL has `file_node_id` only | **Phase 5** |
| `recentFilesStore`, `recentFiles` routes (~14) | store writes `recent_files.path` but DDL has `file_node_id` | **Phase 5** |
| Settings model/store + auth registration (~8) | JSON double-serialization bug (unrelated to nodeId) | separate bug fix |
| `lockManager` sqlite strategy (5) | `acquireSqliteLock` returns undefined instead of retry/timeout | Phase 7 |
| `admin.test.js` approve (1) | `permissionStore.grant(userId, '/username', 'admin')` → NaN FK | Phase 4 admin migration |
| files/folders route 500s (7) | missing S3 env in test harness (composition root `createBlobStore`) | test-env config |

---

## 6. Final gate (run after Tasks 1–9)

```bash
# Server — only Deferred-section failures may remain
cd server && npm run test:ci

# Client — all W4.9/W4.10 suites green
cd client && CI=true npm run test:ci

# Cleanliness greps
grep -rn "PermissionFacade\|grantTestPermission\b\|collectSubfolderPaths" server/ client/src --include="*.js"
# empty (excluding documented exceptions)
```

**Success criteria:** zero Wave 4-caused failures; Deferred list unchanged; docs + fail_log up to date; plan table fully checked.
