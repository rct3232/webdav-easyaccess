# PHASE 5 PLAN: Sharing & RecentFiles → Node ID

Branch: `refactor/phase-5-sharing-recentfiles` (from `dev`)
Parent: [PLAN.md](PLAN.md) — Phase 5 (Sharing & RecentFiles → Node)
Status: COMPLETE (2026-08-06) — verified; pending merge to `dev`

---

## 1. Objective

Migrate the sharing domain (share links, public share access) and the recent-files domain from
path-string references (`file_path`, `path`, `folderPath`) to nodeId references (`file_node_id`,
`nodeId`) end-to-end (server stores/services/routes, client repositories/components, tests, specs).
The DB schema already uses `file_node_id`; this phase aligns all runtime code to it and removes the
`resolve-path` navigation shims introduced during Phase 4 gap closure.

## 2. Verified current state (evidence)

| Layer | State | Evidence |
|---|---|---|
| DDL `share_links` / `recent_files` | nodeId end-state (`file_node_id`) | `001_initial_normalized_schema.sql:114-121,125-130` |
| Store specs (`shareLinkStore.md`, `recentFilesStore.md`) | nodeId end-state | `file_node_id`; recentFilesStore.md:27 marks `applyBulkMove`/`removePaths` removed |
| Feature doc `files-sharing.md` | nodeId end-state | L93 `{ fileNodeId, expiresInDays }`; L106 `{ fileNodeId }`; L110 removed apply-moves/remove-paths |
| Server sharing code | path-based | `shareLinkService.js`, `shareAccessService.js`, `recentFiles/service.js`, `recentFilesStore.js`, `ShareLink.js`, PG/SQLite metadata adapters (`file_path` SQL) |
| Server route specs | path-based | `shareLinks.md`, `sharePublic.md`, `recentFiles.md` |
| Client code | path-based | `recentFilesRepository.js`, `shareLinkService.js:11`, `ExternalShareSection.js`, `RecentFilesSection.js` (shim), `ShareLinkSection.js` (shim), `useShareLinkInfo.js`, `useFileManager.js`, `useShareLinkOverlay.js`, `FileManager.js:445-462` |
| Client specs | path-based | `recentFilesRepository.md`, `recentFiles.md` (utils), `shareLinkService.md`, `useRecentFile.md`, `RecentFilesSection.md` |
| Failing server suites | 7 (Phase 5 scope) | recentFiles, recentFilesStore, shareLinks, sharePublic, shareLinkStore, ShareLink, PermissionRequest ≈ 39 tests |
| Live 500s | yes | `file_path` column INSERT → SQL error; `grantSharePermission(token, path)` → NaN (shareLinkService.js:61); `grantTestPermission` deleted from test-utils |

## 3. Constraints

- Sequential after Phase 4 gap closure (merged to `dev`).
- Docs-first: all spec updates (Tier 0) before any code task.
- No net behavior change per public API; only payload key changes (path → nodeId) as mandated by the
  nodeId-only contract (Execution Rule #13). `resolve-path` remains the sole path-accepting endpoint.
- Keep error-code keys stable (`share.pathRequired`, etc.) to avoid client error-mapping churn.
- Commit per task; tests move with source; update `test-utils.js` imports per phase.

---

## 4. Task graph

### Tier 0 — Docs-First gate

| # | Doc | Change |
|---|---|---|
| D1 | `docs/spec/server/routes/shareLinks.md` | Service signatures + POST body → `fileNodeId`; response `{ token, nodeId, fileName, fileType, isDirectory, displayPath, ... }` |
| D2 | `docs/spec/server/routes/sharePublic.md` | Closure-table descendant checks; `/info` returns `nodeId` + `displayPath` |
| D3 | `docs/spec/server/routes/recentFiles.md` | POST `{ fileNodeId }`; DELETE `/:fileNodeId`; remove apply-moves/remove-paths |
| D4 | `docs/spec/client/services/recentFilesRepository.md` | `RecentEntry = { nodeId, ... }`; remove `apply*` helpers |
| D5 | `docs/spec/client/utils/recentFiles.md` | Mark 3 path-mutation helpers removed |
| D6 | `docs/spec/client/services/shareLinkService.md` | `createShareLink(fileNodeId)` |
| D7 | `docs/spec/client/hooks/useRecentFile.md`, `RecentFilesSection.md` | nodeId tracking; remove shim note |
| D8 | `docs/spec/client/components/folder-tree/ShareLinkSection.md` | nodeId-only; remove fallback note |
| D9 | `docs/api.md` | Share-links/recent-files nodeId contracts |
| D10 | **New** `docs/spec/server/services/shareAccessService.md` | nodeId + closure table contract |
| D11 | `docs/features/files-sharing.md` | Verify consistency only |

### S — Server

| # | Task | Files | Verify | Deps |
|---|---|---|---|---|
| S1 | **ShareLink store → `file_node_id`**: rewrite `shareLinkStore.js` as direct dual-backend SQL store (drop metadata-adapter delegation for share_links); `ShareLink.js` `create(fileNodeId, ...)` | `store/shareLinkStore.js`, `models/ShareLink.js` | `shareLinkStore.test.js`, `ShareLink.test.js` pass | D1 |
| S2 | **shareLinkService → nodeId**: `createShareLink(fileNodeId, userId, expires)`; resolve node via `fileNodeService.getNode`; `isDirectory` from `node.type`; return `nodeId`/`displayPath`; list/get/update/delete return `nodeId` | `domains/sharing/services/shareLinkService.js` | route tests; no `filePath` in responses | S1 |
| S3 | **shareAccessService → closure table**: metadata/preview/download via `fileNodeService` + `blobStorageService.downloadBlob`; `checkUserSharePermission` via `getDescendantIds`; `addToMyPermissions` via `ownerNodeResolver.isOwnerNode` + grant READ | `domains/sharing/services/shareAccessService.js` | `sharePublic.test.js`; closure descendant scenarios | S2 |
| S4 | **recentFiles server → nodeId**: `recentFilesStore.js` SQL → `(user_id, file_node_id, last_accessed)`; drop applyBulkMove/removePaths; service + routes nodeId; `getNodePath` display enrichment | `store/recentFilesStore.js`, `domains/recentFiles/service.js`, `domains/recentFiles/routes.js` | `recentFilesStore.test.js`, `recentFiles.test.js` | D3 |
| S5 | Server route/model tests rewrite (Case B) | 7 suites | all pass | S1-S4 |

### C — Client

| # | Task | Files | Verify | Deps |
|---|---|---|---|---|
| C1 | **recentFilesRepository → nodeId**; delete `applyRecentFilesAfterRename/BulkDelete/BulkMove`; remove `utils/recentFiles.js` helpers | `client/src/services/recentFilesRepository.js`, `client/src/utils/recentFiles.js`, callers `useFileOperations.js`, `useBulkOperations.js` | `recentFilesRepository.test.js` | S4 |
| C2 | **RecentFiles UI nodeId**: `useFileManager` synthetic entries carry `nodeId`; `explorerGateway.getEntriesMetadata` enrichment fires; `RecentFilesSection` remove shim; `useRecentFile` nodeId tracking | `useFileManager.js`, `explorerGateway.js`, `RecentFilesSection.js`, `useRecentFile.js` | `RecentFilesSection.test.js`, `useRecentFile.test.js` | C1 |
| C3 | **shareLinkService → nodeId**; `ExternalShareSection` prop `fileNodeId`; `ShareFolderTree` nodeId arg | `shareLinkService.js`, `ExternalShareSection.js`, `ShareDialog.js`, `ShareTargetDialog.js`, `FileManagerView.js`, `ShareFolderTree.js` | `shareLinkService.test.js`, `ExternalShareSection.test.js` | S2 |
| C4 | **Remove share-mode `resolve-path` shims**: `useShareLinkInfo`, `ShareLinkSection`, `useFileManager` share-root, `useShareLinkOverlay`, `FileManager` share-mode fallback; `SharingContent.js` `link.filePath` → display | listed client files | share-view smoke + tests | C3 |
| C5 | Client tests + MSW handlers nodeId | `handlers.js`, client test files | client suites pass | C1-C4 |

---

## 5. Verification

1. Server: `npm run test:ci -w server` — the 7 Phase 5 suites pass; full-suite failures drop from 55 → 16 (environmental auth/admin/lockManager + Settings bug, out of scope).
2. Client: `CI=true npx react-scripts test --watchAll=false` — no regression; remaining failures = documented out-of-scope 3 suites (apiClient ×2, FileActionSheet).
3. Live: create share link via UI → no 500; recent-file click navigates by nodeId; `__recent__` grid shows size/mime (metadata enrichment fires).
4. Zero path-string payloads remain in share-link/recent-files client layer; share-mode `resolve-path` shims removed.
5. `docs/fail_log.md` updated with Phase 5 RCA records.
6. Merge `refactor/phase-5-sharing-recentfiles` → `dev`, delete branch.

## 7. Execution log (2026-08-06)

- Tier 0 (D1-D10 + api.md): committed `8778eeb`; `files-sharing.md` verified consistent (no change).
- S1 shareLinkStore + ShareLink model: committed `f131e1f`.
- S2 shareLinkService → nodeId + getNodePath ordering fix: committed `7bfcd25`.
- S3 shareAccessService → closure table: committed `344acb7`.
- S4 recentFiles server → nodeId: committed `76fbcd3`.
- Fixes from test rewrite (updateShareLink null-expiry, mapServiceError status): committed `d26d337`.
- S5 server test rewrite (7 suites, 59 tests): committed `0d71745`.
- C1-C5 client migration (recent-files + share-links + MSW + tests): committed `a47b750`.
- fail_log RCA: committed `7db20f5`.
- **Final counts:** server 1111 passed / 16 failed (env+Settings, baseline); client 1248 passed / 12 failed (3 out-of-scope suites, baseline).

## 6. Risks

- `useRecentFile.js` (365 lines, deeply path-based): migrate in its own commit with its test.
- `grantSharePermission` NaN bug is live today (shareLinkService.js:61) — fixed by S2.
- Keep error-code keys unchanged to avoid client error-mapping churn.
- Metadata adapters remain dead code until Phase 7 — do not delete here.
