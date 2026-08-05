# GAP CLOSURE PLAN: Phase 4 nodeId Completion

Status: PLANNED (2026-08-05) — execution pending approval
Branch: `fix/phase4-nodeid-gap-closure` (from `dev`)
Parent: [PLAN.md](PLAN.md) — Phase 4 completion sub-plan, executes **before** Phase 5

---

## 1. Objective

Close the alignment gaps found by the post-completion audit of PLAN.md Phases 1–4 so the client
file layer, the thumbnails feature, MSW mocks, and the spec/feature documentation reach the nodeId
end-state claimed by Phase 4, and the missing test coverage (`_ancestryHelper`, `composition`) is
added.

## 2. Scope

**In scope**

- Thumbnails nodeId migration (server + client + MSW + tests + docs). Endpoint location standardizes
  on the real server mount `/api/thumbnails` (decision: keep server location, repoint client + docs).
- Client nodeId-first navigation and full folder-tree migration (decision: nodeId-first URL scheme,
  full tree migration).
- Client correctness fixes: DnD protocol, selection/processingMap keying, FolderPicker, MSW
  permission-request handlers, stale client test fixtures.
- Server correctness: `fileNodesStore.getDescendants` missing method, legacy-URL resolver
  `POST /files/resolve-path`.
- Test coverage: `_ancestryHelper.test.js`, `composition.test.js`, thumbnail route/service tests.
- Docs: `docs/features/permissions.md` (inheritance contradiction), `docs/features/files-sharing.md`,
  `docs/api.md`, `docs/ARCHITECTURE.md`, thumbnail specs, client specs, `PLAN.md` amendments.

**Out of scope**

- Phase 5 recent-files/share-link nodeId migration (recent-files API and `RecentFilesSection` stay
  path-based here; only a `resolve-path` navigation shim is added, removed in Phase 5).
- Settings double-serialization bug (separate bug fix, tracked in PLAN.md).
- `apiClient` retry speed-up (perf/test-suite-speedup side task).
- Phase 7 legacy cleanup (`permissionStore.js` ~1069 lines, `getPermissionDoc`/cache Maps, FsJSON
  removal) — unchanged scope.
- E2E execution (Phase 8); only the E2E specs affected by the URL scheme are flagged here.

## 3. Confirmed decisions

| # | Decision | Consequence |
|---|----------|-------------|
| D1 | **Navigation**: nodeId-first URL — real folders `/files/node/<id>`, virtual roots `/files/__recent__`, `/files/__shared__` kept unchanged | Deep-link bootstrap via `resolve-path`; E2E URL assertions for real folders must be updated |
| D2 | **Folder tree**: full nodeId migration (controllers + components + Breadcrumb) | Largest client surface; RecentFilesSection path-based until Phase 5 |
| D3 | **Thumbnails URL**: standardize on server location `/api/thumbnails` | Client + docs repointed to `/api/thumbnails/batch`; public `/api/thumbnails/:hash.:ext` unchanged |

## 4. Evidence-backed gap register

| ID | Gap | Evidence | Resolution |
|----|-----|----------|------------|
| G1 | **Thumbnails contract break**: client `POST /files/thumbnails/batch {nodeIds}` vs server `POST /api/thumbnails/thumbnails/batch {paths}` → real server 404; `checkFilePermission(principalId, path)` passes a path to a nodeId ACL | `client/src/services/fileService.js:509-518`; `server/domains/thumbnails/routes/thumbnailRoutes.js:48-66`; `server/index.js:64-65` | S1 + C1.1 |
| G2 | **Thumbnail cache/hash/token path-keyed** + latent `thumb:`-prefix hash bug in `GET /thumbnail/:hash` | `thumbnailService.js:26-82`; `thumbnailRoutes.js:23-24` | S1 |
| G3 | **`fileNodesStore.getDescendants` missing** but called → TypeError on `GET /permissions/file/list?parentNodeId=` | `filePermissions.js:154` vs exports at `fileNodesStore.js:822-847` | S2 |
| G4 | **DnD protocol mismatch**: `useDragAndDrop` writes nodeId, `useFolderTreeItemController` writes path, `useContentAreaDragDrop` reads path; `useDropToUpload` tree wiring broken (`isFolderMode` false) | `useDragAndDrop.js:23`, `useFolderTreeItemController.js:186-190`, `useContentAreaDragDrop.js:135-145`, `useDropToUpload.js:28` | C2.4 (C2.3) |
| G5 | **Selection path-keyed** and forwarded as nodeIds to bulk APIs (live bug); `processingMap` written with nodeId, read with path | `useSelection.js`, `useExplorerInteraction.js`, `fileViewUtils.js:30`, `useFileOperations.js:152,222` | C1.2 |
| G6 | **FolderPicker contract mismatch**: hook sends `{ path }`, gateway expects `{ nodeId }` → `listFiles(undefined)`; `FileManagerView.js:757` feeds a path into nodeId consumers | `useFolderPicker.js:37,69`, `folderPickerGateway.js:9-18`, `FileManagerView.js:757` | C1.3 |
| G7 | **MSW stale**: permission-requests path-based (`folderPath`/`filePath`), wrong `check-owner` shape (`hasOwner` vs `ownerExists`), missing grant/revoke/file handlers, permissive `/permissions/check` | `client/src/mocks/handlers.js:487-516` vs `permissionRequestService.js:5-9,40-42` | C1.4 |
| G8 | **Stale client tests** (3 of 8 failing suites): path fixtures against nodeId code | `sharePermissionSaveUseCase.test.js`, `shareReviewUseCase.test.js`, `buildPendingRequestState.test.js` | C1.5 |
| G9 | **Navigation path-based**: `useFileManager` hybrid path→nodeId session map (deep-link already broken), `useExplorerNavigation.canNavigateToPath(path)` mismatch, session key = path | `useFileManager.js:59-80,141`, `useExplorerNavigation.js:49` | C2.1, C1.6 |
| G10 | **Folder tree path-keyed**: `expandedPaths`/`currentPath`/`onPathClick`, `useFolderTreeItemController` path DnD | `useFolderTreeController.js`, `FolderTree.js`, `BaseFolderTreeItem.js`, etc. | C2.3 |
| G11 | **`features/permissions.md` contradicts closure table** ("no inheritance from parent to child") | `docs/features/permissions.md:36-46` | D1 |
| G12 | **Test coverage gap**: `_ancestryHelper` 0 direct tests; no `composition.test.js` | repo audit | T1, T2 |

## 5. Task graph

### Tier 0 — Docs-First gate (per AGENTS.md §2.1, before each area's code)

| # | Docs | Change |
|---|------|--------|
| D1 | `docs/features/permissions.md` | Rewrite to closure-table inheritance (ancestor walk, depth 0/1/N), nodeId-only; remove "no inheritance" + path keying |
| D2 | `docs/features/files-sharing.md`, `docs/api.md`, `docs/ARCHITECTURE.md` | File/folder endpoints nodeId; remove `normalizePathParam` references; thumbnails `/api/thumbnails/*` contract |
| D3 | `docs/spec/server/routes/thumbnails.md`, `docs/spec/server/utils/thumbnail.md` | Thumbnail nodeId contract: cache `nodeId` key, `md5(nodeId)` hash, `POST /thumbnails/batch {nodeIds}`, `checkFilePermission(nodeId)` |
| D4 | Client specs: `fileService.md` (drop 5 legacy path permission helpers), `useThumbnailLazyLoad.md`, `useBulkOperations.md`, `useFileManager.md`, `useExplorerSession.md`, `Breadcrumb.md`, `FolderTree.md`, `BaseFolderTreeItem.md`, `SharedFoldersSection.md`, `ShareLinkSection.md`, `RecentFilesSection.md`, `useFolderTreeController.md`, `useFolderTreeItemController.md`, `useContentAreaDragDrop.md`, `useSelection.md`, `useExplorerInteraction.md`, `FolderPickerDialog/useFolderPicker.md`, `SharedManageDialog.md`, `buildPendingRequestState.md`, `refreshPolicy.md`, `deriveSharedAccessState.md`, `shareManageMessageUtils.md`, `utils/ensureHomeOwnerAdmin.md` | nodeId end-state for all |
| D5 | `PLAN.md` (already applied 2026-08-05) + any follow-ups | Phase 4 gap-closure note; Phase 5 5.4/5.5 scope notes; Phase 7 7.3/7.6 verification notes; Phase 8 E2E URL-scheme impact; Execution Rules #13 `resolve-path` exception, #15 URL caveat |

### S — Server (after D1–D3)

| # | Task | Verify | Deps |
|---|------|--------|------|
| S1 | **Thumbnails nodeId migration**: `thumbnailService` cache key `thumb:<nodeId>`, `getThumbnailHash=md5(nodeId)`, token semantics, `ensureThumbnailsBatch(nodeIds)` reads bytes via `blobStorageService.downloadBlob(nodeId)`; `imageProcessor`/`videoProcessor` nodeId reads (temp-file keying by nodeId); `thumbnailRoutes` `POST /thumbnails/batch {nodeIds}` + `checkFilePermission(nodeId)`; fix `GET /thumbnail/:hash` `thumb:`-prefix hash bug (consolidate into `:hash.:ext`); `fileService.js:48` `getThumbnailUrl(child.id)` | New route tests (batch + single, nodeId), `server/utils/__tests__/thumbnail.test.js` cache-key/hash updates | D1–D3 |
| S2 | `fileNodesStore.getDescendants` alias (delegates to `getDescendantIds` + name lookups) — resolves G3 TypeError | `GET /permissions/file/list?parentNodeId=` route test | — |
| S3 | `POST /files/resolve-path {path} → {nodeId}` exposing `fileNodeService.resolvePath` (legacy-URL bootstrap; exempt from Rule 13 file-op ban) | Route test: round-trip + 404 unknown path | — |

### C1 — Client correctness (independent, parallelizable)

| # | Task | Verify | Deps |
|---|------|--------|------|
| C1.1 | Thumbnails client: `useThumbnailLazyLoad` nodeId keying (`data-file-node-id`, `Map(nodeId→url)`), `useExplorerSession` merge by nodeId, `data-file-node-id` on `FileGridItemContainer`/`FileItem`/`FileDetailRow`/`PreviewThumbnailBar`, `requestThumbnailsBatch` → `/api/thumbnails/batch {nodeIds}` | `useThumbnailLazyLoad.test.js` nodeId fixtures; add `requestThumbnailsBatch` test in `fileService.test.js` | S1 |
| C1.2 | Selection/processingMap nodeId: `useSelection`, `useExplorerInteraction`, `fileViewUtils`, `useFileViewCommon` keyed by `file.nodeId`; fix `FileManager.js` path→file lookups; `fileViewUtils.js:30` read processingMap by nodeId | `useSelection.test.js`, `useExplorerInteraction.test.js`, `FileManagerView.test.js` | — |
| C1.3 | FolderPicker: `useFolderPicker` → nodeId (`checkWritePermission({nodeId})`, `listFolderContents({nodeId})`), destination select returns nodeId, `FileManagerView.js:757` nodeId | `useFolderPicker.test.js` (fixes 1 of 8 failing client suites) | — |
| C1.4 | MSW: permission-requests nodeId (`check-owner?nodeId=` → `{ownerExists, ownerUsername}`), `POST /permission-requests {nodeId,...}` → `file_node_id` response; add missing handlers (`grant`/`revoke`/`file/list`/`file/grant`/`file/revoke`/`file/check`/`PATCH file`); `/permissions/check` validates nodeId + echoes `source` | `apiClient.msw-smoke.test.js`; permission flow smoke | — |
| C1.5 | Stale client tests: `sharePermissionSaveUseCase.test.js`, `shareReviewUseCase.test.js`, `buildPendingRequestState.test.js` → nodeId fixtures (Case B: test error; record in `docs/fail_log.md`) | The 3 suites pass | — |
| C1.6 | `useExplorerNavigation.canNavigateToPath` → nodeId | `useExplorerNavigation.test.js` | — |
| C1.7 | RCA remaining failing client suites: `FilePreviewDialog.test.js` (`mockGetFileBlob('/b.jpg')` stale), `FileActionSheet.test.js` — fix if Case B, else record in `docs/fail_log.md`. `apiClient` 2 suites out of scope (retry config) | Targeted suites | — |

### C2 — Client nodeId-first navigation + tree (after C1; largest surface)

| # | Task | Verify | Deps |
|---|------|--------|------|
| C2.1 | **URL scheme**: real folders `/files/node/<nodeId>`; virtual roots `/files/__recent__`, `/files/__shared__` unchanged. `useFileManager` — `currentNodeId` source of truth, remove path→nodeId session map, legacy path URL → `resolve-path` redirect (S3). `useExplorerSession` `sessionKey` = nodeId | `useFileManager.test.js`, `useExplorerSession.test.js` rewritten | S3 |
| C2.2 | **Breadcrumb**: `GET /files/list` response extended with current dir `ancestors: [{nodeId,name}]` (via `getAncestorChain`); `Breadcrumb` renders chain, clicks navigate by nodeId | `Breadcrumb.test.js` | S1 |
| C2.3 | **Folder tree nodeId migration**: `useFolderTreeController` (`expandedNodeIds`, `onNodeClick`, shared folders keyed by nodeId — permissions API already returns nodeId), `useFolderTreeItemController` (DnD writes `text/plain` = nodeId, fix `useDropToUpload` wiring so `isFolderMode` activates), `FolderTree`/`BaseFolderTreeItem`/`SharedFoldersSection`/`ShareLinkSection` props nodeId. `RecentFilesSection` stays path-based with `resolve-path` click shim (Phase 5 removes it) | `useFolderTreeController.test.js`, `useFolderTreeItemController.test.js`, `FolderTree.test.js`, `BaseFolderTreeItem.test.js`, `SharedFoldersSection.test.js`, `ShareLinkSection.test.js` | C1.2, C2.1 |
| C2.4 | **DnD unification**: `useContentAreaDragDrop` reads `text/plain` as nodeId, drop `getParentPath` same-folder skip (compare parentNodeId), pass `(Number(text), currentNodeId)` to `handleInternalFileDrop` | `useContentAreaDragDrop.test.js` rewritten | C2.3 |
| C2.5 | Share-link mode: use root nodeId from `linkInfo` if present, else `resolve-path` fallback (fallback removed in Phase 5 after `GET /share-link/:token` returns nodeId) | Share view smoke + tests | S3, C2.1 |

### T — Test coverage (independent, can start early)

| # | Task | Verify |
|---|------|--------|
| T1 | `server/service/__tests__/_ancestryHelper.test.js` — `buildAncestorsForNode` (root, depth N), `rebuildAncestorsAfterMove` (BFS delete-then-insert, depth recompute), `cleanupAncestorsForDeletion`. Mirror `fileNodeService.test.js` conventions (`createTestDatabase`, direct `node_ancestors` SQL) | New suite passes |
| T2 | `server/service/__tests__/composition.test.js` — singleton `getComposition`, `__setCompositionForTests`, `resetComposition` | New suite passes |
| T3 | (Optional) `jest-junit` reporter on server (`jest.config.js` `reporters`) for CI test-result traceability (replaces the current "unbacked" pass/fail numbers). Client is CRA-constrained — skip unless trivial | junit artifact produced |

### V — Integration verification

1. `npm run test -w server` / `-w client` — no regression in the previously passing 52 server / 142 client suites; new tests all pass.
2. Server failures converge to Phase 5 scope (7 suites) + environmental (auth/admin/lockManager, 3) + Settings bug (2); the plan does **not** intend to change those.
3. Client failing suites drop from 8 via C1.3 (FolderPicker) + C1.5 (3 stale) + C1.7 (path-stale preview/actionsheet) — remaining expected: `apiClient` 2 (out of scope).
4. `docs/fail_log.md` updated with Case B RCA records.
5. Confirm thumbnail batch now succeeds against the real server (no 404/403).

## 6. Branching & commit rules (AGENTS.md §2.2–2.3)

- Branch `fix/phase4-nodeid-gap-closure` from `dev`. Never merge directly to `main`.
- Conventional Commits per task: `docs:` for Tier 0, `fix:` for S/C1/C2 correctness, `feat:` for S3/endpoints, `test:` for T.
- Independent tasks execute in parallel via sub-agents: C1.1–C1.7 are mutually independent; S1/S2/S3 independent; T1/T2 independent and can start early.
- After completion: `npm run test:ci -w server` and `-w client` must pass, then merge to `dev` and delete the branch.

## 7. Success criteria

1. `POST /api/thumbnails/batch {nodeIds}` works end-to-end against the real server; thumbnails render in grid/list/preview.
2. Client file layer: zero path-string payloads/keys except recent-files (Phase 5) and display-only path usage.
3. DnD, selection, FolderPicker, MSW all nodeId-only.
4. `docs/features/permissions.md` matches closure-table inheritance.
5. `_ancestryHelper` and `composition` have direct unit tests.
6. No regression in previously passing suites; no new failures introduced.

## 8. Risks

- **C2 surface size**: folder tree + navigation touch many components/hooks; tests must be updated in the same commit (AGENTS.md §2.1 rule 6).
- **RecentFilesSection interim shim**: `resolve-path`-based click for recent entries is temporary; keep it isolated and clearly marked for Phase 5 removal.
- **E2E URL assertions**: real-folder URL assertions in 3 specs break; do not change the virtual-root URLs.
- **Rule 13 tension**: `resolve-path` is the only path-accepting endpoint — documented exception in PLAN.md, no other path payloads may be added.

## 9. Downstream phase amendments (already applied to PLAN.md)

- **Phase 5**: 5.4 scope extended (RecentFilesSection + `__recent__` view nodeId, shim removal); 5.5 scope reduced to `ExternalShareSection`/`ShareFolderTree` + nodeId-root share mode.
- **Phase 7**: 7.3 (server path permission checkers) and 7.6 (client residual path state) become verification-focused due to S1/C2 pre-completion.
- **Phase 8 E2E**: "No modifications needed" removed; URL-scheme updates specified for 3 specs; virtual-root URLs retained.
- **Execution Rules**: #13 documents the `resolve-path` exception; #15 updated for URL-scheme impact.

---

## 10. Addendum — Post-completion alignment audit (2026-08-05)

An independent audit of PLAN.md Phases 1–4 vs docs/implementation/tests/recorded results confirmed the
original gap-closure wave (S1–S3, C1.1–C2.5, T1–T2) is code-complete, but surfaced a small set of
**live client bugs** (path-string payloads that 400 against the nodeId-only server), a **key-mismatch**
bug in the pending-permission-request matcher, residual path-keyed grid keys, and a **doc sweep** of
stale end-state claims. Recorded test results (fail_log.md 2026-08-05: server 12 suites/55 failed/1032
passed/1090; client 8 suites/23 pre-existing) are internally consistent — no contradiction found.

### 10.1 New gap register (audit additions)

| ID | Gap | Evidence | Resolution |
|----|-----|----------|------------|
| A1 | **Single-file delete sends `file.path`** into nodeId-only `batch-delete` → server 400 (context menu + mobile action sheet) | `FileManagerView.js:745,890` → `useExplorerCommands.js:437-442` → `batchDeleteFiles(nodeIds)` | C3.1 |
| A2 | **Preview download sends `targetFile.path`** to nodeId-only `downloadFile` → server 400; second preview test file asserts the buggy call | `FilePreviewDialog.js:207`; `FilePreviewDialog/__tests__/FilePreviewDialog.test.jsx:193` | C3.2 |
| A3 | **Pending-request matcher key mismatch**: `buildPendingRequestState` reads `request.node_id` but real server + MSW return `file_node_id` → pending state never matches live data; C1.5 tests encode the wrong key | `buildPendingRequestState.js:21,26` vs `permissionRequestStore.js:34`, `handlers.js:631` | C3.3 |
| A4 | **Grid/list/detail keys path-keyed** (`file.path`) despite 4.8i "keyed by nodeId" | `FileGrid.js:80`, `FileList.js:71`, `FileDetail.js:104`, inner keys in `FileGridItemContainer.js:52`/`FileItem.js:52`/`FileDetailRow.js:60` | C3.4 |
| A5 | **C1.7 record inaccurate**: fail_log claims preview "implementation is correct" while `FilePreviewDialog.js:207` is a live path bug (folded into A2) | `docs/fail_log.md` 2026-08-05 C1.7 entry | C3.2 (update fail_log) |
| A6 | **Stale end-state docs**: Phase 3 `❌ DEFERRED` markers describe code that no longer exists (3.3b-2/3.3b-3/3.3c done); `ARCHITECTURE.md` lists deleted `ownerPathResolver`/`permissionFacade` + swapped thumbnail route comments; `api.md:35` path-based `{folderPath, permission}`; `folders.md` §2.4 Korean path text; `permissionRequests.md`/`middleware/permissions.md` stale payloads; `permissionPolicy.md` §2.8 claims deleted `inheritancePolicy.js` (still exists, orphaned); `thumbnails.md` "pending in S1"; `files-test-plan.md` stale counts; PLAN.md Phase 1 `NoOpBlobStore`/`createBlobStore(config)`/18-test wording | see 10.3 | D6 |
| A7 | **Admin user-permissions flow still path-based** (server `PUT /api/users/:id/permissions` reads `perm.folderPath` → `permissionStore.grant(userId, path, …)` which now requires `file_node_id`; `userService.js:60,112,191-192` pass `/${username}` paths; client `adminPermissionSaveUseCase.js` + `userService.updateUserPermissions` send `folderPath`). **Not Phase 4 scope** — admin-domain path-based permission helpers are Phase 7 legacy cleanup (PLAN.md 7.3/7.4). Recorded here to keep `api.md` truthful and prevent regression; leave code unchanged | `docs/api.md:35` annotated as Phase 7 item; no code change in this wave | D6 (annotate only) |

### 10.2 Correctness wave (after Tier 0 docs)

| # | Task | Verify | Deps |
|---|------|--------|------|
| C3.1 | **Single-file delete nodeId**: `FileManagerView.js:745,890` `openBulkDeleteDialog([file.nodeId])` (not `file.path`) | `FileManagerView.test.js` / bulk-delete flow | — |
| C3.2 | **Preview download nodeId**: `FilePreviewDialog.js:207` `downloadFile(targetFile.nodeId, …)`; update both preview test files to nodeId fixtures (assert `downloadFile(10, …)`); RCA-record the A5 correction in `docs/fail_log.md` | `FilePreviewDialog.test.js` (9) + `FilePreviewDialog.test.jsx` (7) pass | — |
| C3.3 | **Pending-request matcher**: `buildPendingRequestState.js` match on `request.file_node_id`; update `buildPendingRequestState.test.js` fixtures to `file_node_id` | `buildPendingRequestState.test.js` passes | — |
| C3.4 | **Grid/list/detail keys nodeId**: `FileGrid.js`, `FileList.js`, `FileDetail.js` list keys + inner keys on the item containers use nodeId-primary `getEntryKey(file)` (path fallback retained for synthetic `__recent__` entries) | File grid/list/detail tests pass | — |

### 10.3 Doc sweep (D6)

- PLAN.md Phase 1: reconcile `NoOpBlobStore`→`WebdavBlobStore`, `createBlobStore(config)`→parameterless, 18→22 test wording; Phase 3 markers 3.3b-2/3.3b-3/3.3c → ✅ (completed via Phase 4), 3.8/3.9 → ✅ (completed via 4.8a/4.8b).
- `docs/ARCHITECTURE.md`: `ownerPathResolver`→`ownerNodeResolver`; drop `permissionFacade`; fix swapped thumbnail route comments; keep `FsJsonMetadataAdapter` note as Phase 7 deprecation scope.
- `docs/api.md:35`: admin user-permissions endpoint — **annotate** as still path-based (`{ folderPath, permission }`), Phase 7 migration item (A7). Do **not** document it as nodeId while the code remains path-based.
- `docs/spec/server/routes/folders.md` §2.4: replace path-based Korean descriptions + WebDAV-mock strategy with nodeId/DB service strategy.
- `docs/spec/server/routes/permissionRequests.md`: `folderPath`/`filePath` → `nodeId`/`file_node_id`.
- `docs/spec/server/middleware/permissions.md`: drop `canAccessPath` export listing.
- `docs/spec/server/utils/permissionPolicy.md` §2.8: `inheritancePolicy.js` still exists (orphaned) — annotate, don't claim deletion.
- `docs/spec/server/routes/thumbnails.md`: Status line → S1 complete.
- `docs/spec/server/routes/files-test-plan.md`: refresh line/test counts to actual suite.
- `docs/spec/server/store/permissionRequestStore.md:16`: correct "no dedicated store unit test" (it is `requestStore.test.js`).
- Phase 1 doc reconciliation (A6): `docs/features/core-service-layer.md:17` `NoOpBlobStore`→`WebdavBlobStore`; `docs/spec/server/store/storage.md:69` `WEA_FILE_STORAGE` default `webdav`→`s3` + remove "not yet implemented"; `docs/spec/server/store/blobstore.md` webdav→`WebdavBlobStore` (NoOpBlobStore = dead code), factory description; `blobstoreFactory.test.js` stale `config.fileStorageMode` test titles → `WEA_FILE_STORAGE`.

### 10.4 Success criteria (audit wave)

1. Zero path-string payloads into nodeId-only client file operations (single-file delete, preview download).
2. `buildPendingRequestState` matches live server `file_node_id` shape.
3. Grid/list/detail React keys nodeId-primary.
4. Stale end-state docs reconciled (Phase 1 wording, Phase 3 markers, ARCHITECTURE, api.md, folders, permissionRequests, middleware/permissions, permissionPolicy, thumbnails, files-test-plan, permissionRequestStore).
5. No regression in previously passing suites.

### 10.5 Verification (applied 2026-08-05)

**Client** (`CI=true npx react-scripts test --watchAll=false`): 147 passed / 3 failed suites, 1254 passed /
12 failed. The 3 failing suites are the pre-existing out-of-scope set — `apiClient.test.js` +
`apiClient.msw-smoke.test.js` (retry config, §2 out of scope) and `FileActionSheet.test.js` (4/8, C1.7
documented out-of-scope; spec/implementation disable-vs-hide decision pending). Zero new failures from
A1–A4; all targeted suites (FilePreviewDialog ×2, FileGrid, FileList, FileDetail, FileManagerView,
useExplorerCommands, useSharedManage, buildPendingRequestState) pass.

**Server** (`npx jest`): 54 passed / 12 failed suites, 1075 passed / 55 failed / 3 skipped / 1133 total.
The 12 failing suites are exactly the pre-existing Phase 4 baseline: Phase 5 scope (sharePublic,
shareLinks, shareLinkStore, recentFiles, recentFilesStore, models ShareLink, models PermissionRequest),
environmental `postgresqlNotConfigured` (auth, admin, lockManager), and the pre-existing Settings
double-serialization bug (Settings, settingsStore). Phase 1–4 suites (infrastructure, blobstore, store,
service incl. `_ancestryHelper`/`composition`, permissions, files, folders, thumbnails) all pass.

**Recorded-baseline reconciliation:** server failure count unchanged at 55 (12 suites) vs PLAN.md/fail_log
2026-08-05; passed count rose 1032 → 1075 (+43 from T1/T2 + thumbnail + gap-closure test additions).
Client failing suites dropped 8 → 3 (C1.3/C1.5/C1.7 fixes held; remaining 3 are the documented out-of-scope set).
No regression introduced by the A1–A5 wave.

### 10.6 Addendum wave 2 — exhaustive cross-cutting audit (2026-08-05)

A five-sweep audit (client path remnants, server residual paths, client↔server contract, docs drift,
test drift) found the gap-closure waves A1–A6 had missed **cross-cutting contract breaks** that unit
tests masked because MSW `handlers.js` mirrors the *client's* expectations instead of the *server's*
responses. All items below verified against current source.

#### 10.6.1 Gap register (C-series)

| ID | Gap | Evidence | Severity |
|----|-----|----------|----------|
| C1 | **`GET /files/list` response shape mismatch**: server sends `{name, display_path, mimeType, modifiedAt}`; client reads `file.basename/path/lastmod/mime` with **no normalization layer** (MSW returns client-shaped keys → tests pass). Real server renders blank names/paths/dates in grid/list/detail + breaks e2e `[data-file-path]` selectors | `server/domains/files/services/fileService.js:53-66` vs `client/src/components/file-manager/FileListItem.js:142,163`, `FileGridItem.js:224`, `FileDetailRow.js:159`, `useFileManager.js:277-278`; `client/src/mocks/handlers.js:105-111` | **LIVE** |
| C2 | `explorerGateway.js:42` reads `permission.node_id`; server `GET /permissions/user/:userId` returns `{nodeId}` | `client/src/services/explorerGateway.js:39-43` vs `server/domains/permissions/routes/folderPermissions.js:109` | **LIVE** (admin-folder flag never set) |
| C3 | `ConflictResolveDialog.js:63-64` reads `conflict.path`; server conflict objects carry `{name}` only | `conflictResolver.js:46-52` vs `ConflictResolveDialog.js:63-64` | **LIVE** (crash) |
| C4 | `FilePropertiesDialog.js:38-49` passes `file.path` as `nodeId` (`getFolderPermissions(path,…)`, `getFolderStats(path)`); also `false` bound to `fileNodeId` positional arg | `FilePropertiesDialog.js:38-49`; `permissionService.js:63-68`; `fileService.js:314-319` | **LIVE** (properties dialog 400/404) |
| C5 | **Legacy ShareDialog v1 is path-based and live in MyPage**: `useShareDialog.js:98` `listFiles(path)`; `:232,296` path→`getFolderPermissions`; `adminPermissionSaveUseCase.js:15-25` posts `{folderPath}`; `sharePermissionSaveUseCase`/`shareReviewUseCase` receive `initialFolderPermissions/folderPermissions` but destructure `initialNodePermissions/nodePermissions` → zero grants | `useShareDialog.js`, `adminPermissionSaveUseCase.js`, `usePermissionManager.js`, `buildPermissionDiff.js`, `deriveShareFolderAccessView.js`, `ShareFolderTree.js`; reachable via `SharingContent.js:279,401`, `UserManagementContent.js:312`, `AdminContent.js:434` | **LIVE** |
| C6 | `SharingContent.js:334,345,354,409,461` reads `target_type`/`file_path`/`folder_path` on permission requests; server returns `targetType` + `file_node_id` | `permissionRequestStore.js:26-44` vs `SharingContent.js` | **LIVE** (file-request approve dead, empty paths) |
| C7 | `UploadDialog.js:59` passes `currentPath` (path) to `handleUploadStart` which expects `parentNodeId` | `UploadDialog.js:59` vs `useExplorerCommands.js:367` | **LIVE** (upload 400) |
| C8 | `useExplorerProgress` retryData key mismatch: producer writes `parentNodeId`/`startedNodeId`, consumer reads `currentPath`/`startedPath` | `useExplorerCommands.js:180` vs `useExplorerProgress.js:89,152` | **LIVE** (upload retry/refresh broken) |
| C9 | **File-level permission grants hit directory-only endpoint**: client `grantPermission({target:'file'})` → `POST /permissions/grant` (ignores `target`, rejects file nodes); dedicated `POST /permissions/file/grant` never called | `permissionService.js:74-79`; `fileService.js:514-526`; `shareTargetPermissionSaveUseCase.js:87-92`; `folderPermissions.js:21-48` | **LIVE** (file grants 400) |
| C10 | Drop-target/`isDragging` highlight compares `dropTarget` (nodeId) against `file.path` → dead highlight in grid/list/detail | `FileGrid.js:73-75`, `FileList.js:64-66`, `FileDetail.js:97-98` vs `useDragAndDrop.js:58` | **LIVE** (UI regression) |
| C11 | MSW masks C1/C3/C5/C6/C9: `handlers.js` returns client-shaped keys (`path`/`basename`/`lastmod`, `display_path` rename, `node_id` permissions/folder) instead of server shapes; missing handlers for `/share/:token/check-my-permission`, `/share/:token/add-to-my-permissions`, `/folders/stats`, `PUT /users/:id/permissions` | `client/src/mocks/handlers.js` | **LIVE (test-env mask)** |

#### 10.6.2 Fix tasks (client-normalization approach for C1; all fixes land in this wave)

| # | Task | Files | Verify |
|---|------|-------|--------|
| C1F | Normalize `/files/list` items in `explorerGateway.listDirectory` (server keys → client keys: `display_path→path`, `name→basename`, `mimeType→mime`, `modifiedAt→lastmod`; keep raw `name`/`display_path`); repoint MSW list/rename handlers to server response shapes | `explorerGateway.js`, `mocks/handlers.js`, affected tests | list renders names/paths/dates against MSW-server-shape |
| C2F | `explorerGateway.js:42` `permission.node_id` → `permission.nodeId` | `explorerGateway.js` | admin-folder flag works |
| C3F | `ConflictResolveDialog` render `conflict.name` (+ `sourceNodeId`/`destinationParentNodeId` labels); fix fixtures | `ConflictResolveDialog.js`, test | no `conflict.path` crash |
| C4F | `FilePropertiesDialog` use `file.nodeId` (+ `file.parentNodeId` for dir) for `getFolderPermissions`/`getFolderStats`; fix arg order | `FilePropertiesDialog.js`, test | properties panel loads |
| C5F | Migrate ShareDialog v1 callers to nodeId maps end-to-end: `useShareDialog.js` permission Maps → nodeId keys; `adminPermissionSaveUseCase` build `{nodeId, permission}`; align `sharePermissionSaveUseCase`/`shareReviewUseCase` param names; fix `ShareFolderTree`/`usePermissionManager`/`deriveShareFolderAccessView`; update MSW `PUT /users/:id/permissions`; MyPage callers pass `folderNodeId` | `useShareDialog.js`, `adminPermissionSaveUseCase.js`, `sharePermissionSaveUseCase.js`, `shareReviewUseCase.js`, `usePermissionManager.js`, `deriveShareFolderAccessView.js`, `ShareFolderTree.js`, `ShareDialog.js`, tests | share/review/admin save persists nodeId grants |
| C6F | `SharingContent` reads `targetType`/`file_node_id`; approve path sends `{userId, nodeId: r.file_node_id, permission, target:'file'}`; review dialog `folderPath`→nodeId prop | `SharingContent.js`, tests | inbox/outbox render + file approve works |
| C7F | `UploadDialog` passes `parentNodeId` (not `currentPath`) | `UploadDialog.js`, test | upload reaches server with nodeId |
| C8F | `useExplorerProgress` consume `parentNodeId`/`startedNodeId`; update fixtures | `useExplorerProgress.js`, tests | upload retry refreshes |
| C9F | Route file grants to `POST /permissions/file/grant` when `target==='file'` (extend `permissionService.grantPermission` + MSW handler) | `permissionService.js`, `mocks/handlers.js`, tests | file grants hit file route |
| C10F | Grid/list/detail compare `dropTarget`/`isDragging` by nodeId (`getEntryKey`) | `FileGrid.js`, `FileList.js`, `FileDetail.js` | drop highlight works |
| C11F | Repoint MSW to server response shapes for list/rename/permissions-folder; add missing handlers | `mocks/handlers.js` | MSW == server contract |

#### 10.6.3 Out of scope (recorded, not fixed in this wave)

- **Phase 5**: share-links (`shareLinkService.js` INSERTs removed `file_path` column → 500) and recent-files (store reads `path/name/type` columns absent from DDL; client sends nodeIds into path fields) — Task 5.1/5.3 scope, live today.
- **Phase 7**: admin user create/approve/bulk-permission path→`permissionStore.grant` NaN break (`userService.js:60,112,191`, `routes/users.js:81-82`), boot `ensureHomeOwnerAdminForAllUsers` silent no-op (`cleanupService.js:216,240,247`), `bootstrap.js:44` root grant, `metaPathGuard` no-op on nodeId routes, orphaned `selective*`/`FsJsonMetadataAdapter`/`NoOpBlobStore`, `permissionStore.js` JSON-doc/cache cleanup.
- Client `file.path` display-only uses and the `resolve-path` shim (Rule 13 exception) remain.

#### 10.6.4 Success criteria (wave 2)

1. All C1–C10 production bugs fixed; MSW (C11) mirrors real server response shapes.
2. Client + server suites: no regression in previously passing suites; previously-masked suites (ShareDialog, FilePropertiesDialog, ConflictResolveDialog, UploadDialog, SharingContent, explorerGateway admin-flag) pass against server-shaped MSW.
3. `docs/fail_log.md` records the C-series RCA.

#### 10.6.5 Verification (applied 2026-08-05)

All C1–C11 fixes landed (C1/C2/C11 by agent, C3/C4/C7/C8 re-applied after a parallel-agent write conflict, C5 by agent, C6/C9/C10 by agents, C1F rename-newName handling). `getEntryKey` imports added to FileGrid/FileList/FileDetail (C10) and lint errors cleared.

**Client** (`CI=true npx react-scripts test --watchAll=false`): 147 passed / 3 failed suites, 1263 passed /
12 failed / 1275 total. The 3 failing suites remain the pre-existing out-of-scope set (`apiClient.test.js`,
`apiClient.msw-smoke.test.js`, `FileActionSheet.test.js` 4/8). Previously-masked suites now pass against
server-shaped MSW: FilePropertiesDialog, ConflictResolveDialog, UploadDialog, useExplorerProgress,
explorerGateway (admin nodeId), permissionService (file grant routing), SharingContent, useShareDialog,
ShareDialog, ShareFolderTree, usePermissionManager, MyPage. Passed count rose 1254 → 1263 (+9 from the
new dialog/progress/permission assertions). Zero regressions.

**Server** (`npx jest`): unchanged baseline — 54 passed / 12 failed suites, 1075 passed / 55 failed /
3 skipped / 1133 total. Failures remain exactly Phase 5 scope (sharing/recentFiles/legacy models),
environmental (`postgresqlNotConfigured`), and the pre-existing Settings double-serialization bug.

**ESLint** on all touched client files: 0 errors (pre-existing warnings only, e.g. `handleLeaveSharePathClick`).

**Residual (documented, not fixed):**
- Admin home-folder `baseFolderNodeId` derives via `resolvePath('/username')` fallback; if it fails the home-folder write safeguard is skipped (pure diff applies). `UserSelectionMenu` out-of-scope.
- ShareDialog review-for-file grants still route through the folder endpoints via `shareReviewUseCase` (the MyPage inbox file-approve flow uses `grantPermission({target:'file'})` directly, so the review-dialog file path isn't exercised in production).
- Phase 5 share-links (`file_path` column INSERT → 500) and recent-files (schema/column mismatch) remain live but are Task 5.1/5.3 scope.
- Phase 7 admin `PUT /users/:id/permissions` remains path-based (`Number(path)=NaN`); the client now bypasses it (C5F admin mode uses per-nodeId grant/revoke), so the broken route is no longer client-called. Server route + `userService.js` grants + boot `ensureHomeOwnerAdminForAllUsers` are Phase 7 cleanup items.
