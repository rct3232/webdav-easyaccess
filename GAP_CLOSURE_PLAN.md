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
