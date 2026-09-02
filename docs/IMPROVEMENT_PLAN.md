# Codebase Improvement Plan — Consolidated Open-Item Tracker

> **Updated**: 2026-09-02
> **Purpose**: This is the **single tracking document** for every unresolved, undecided, or
> unimplemented item in the repository.
>
> **Governance rule**: Spec/feature docs describe only the **current implemented/decided**
> state. Planned/future/"pending implementation"/"target contract" work must **not** be written
> into individual docs — record it here instead (see AGENTS.md §2.1). Completed work is logged
> in [§5 Resolved & RCA log](#5-resolved--rca-log) with dates.
>
> **Status legend**: `UNDECIDED` · `CODE-FIX` · `DOC-FIX` · `DEFERRED` · `RESOLVED`

---

## 1. Open decisions (undecided)

| ID | Status | Item | Source | Proposed resolution |
| -- | ------ | ---- | ------ | ------------------- |
| D-1 | CODE-FIX | `refreshPolicy` direction — option (a) chosen: function must be migrated to the nodeId end-state the caller already sends (see C-3). | `docs/spec/client/utils/refreshPolicy.md` | **Decided 2026-09-02: option (a)** — migrate to nodeId params; implementation tracked as C-3. |
| D-2 | CODE-FIX | Remove the dead `fileService` legacy permission wrappers (`checkPermission`, `checkFilePermission`, `grantFilePermission`, `revokeFilePermission`, `updateFilePermission`) + `listFilePermissions` re-export — zero production consumers (only tests/mocks). | `client/src/services/fileService.js:534-560` | **Decided 2026-09-02: delete now** — file-level capability already consolidated in `permissionService` (`grant/revokePermission` with `target:'file'`); implementation tracked as C-2. |
| D-3 | RESOLVED | iOS Web Share "Save Image" hint for image preview download — decided: no hint; no code work. | `docs/spec/client/components/dialogs/FilePreviewDialog.md` | **Decided 2026-09-02: leave absent** — share-sheet native save options are self-explanatory; spec wording cleaned in `FilePreviewDialog.md` / `client-ui.md`. |

## 2. Code changes pending (detailed)

### C-1 — envFileWriter allowlist cleanup (was PLAN/fail-log note)
- **File:** `server/infrastructure/envFileWriter.js:10-43`
- **Problem:** `WIZARD_WRITABLE_KEYS` still lists metadata T0 keys (`WEA_STORAGE_BACKEND`, `WEA_PG_*`) and `ADMIN_DEFAULT_PASSWORD` even though `setupCore.applySetup` never emits them (`partitionEntries` excludes `METADATA_T0_KEYS`; only `JWT_SECRET` + auto-generated `encrypt_secret_key` reach `.env`). Non-behavioral latent mismatch; the stale state is pinned by a test.
- **Fix:** drop the metadata T0 rows and `ADMIN_DEFAULT_PASSWORD` from the allowlist; update the `envFileWriter.test.js:149-155` assertion and the module comment to match `docs/spec/server/routes/setup.md` ("only JWT_SECRET + encrypt_secret_key written").
- **Priority:** low (cleanliness).

### C-2 — Remove dead `fileService` permission wrappers
- **File:** `client/src/services/fileService.js:534-557` (+ `:560` re-export)
- **Problem:** legacy nodeId wrappers over `permissionService`; no production caller (only `fileService.test.js:34` and `testing/mocks/serviceMocks.js:21-24`).
- **Fix (decision 2026-09-02: delete now):** remove the exports (5 wrappers + `listFilePermissions` re-export + now-unused `permissionService` imports); update the `fileService.test.js` mock and `serviceMocks.js`; verify no remaining importer. Update `fileService.md:43` note with the code.
- **Priority:** low.

### C-3 — `refreshPolicy` caller/callee nodeId–path mismatch
- **Files:** `client/src/pages/FileManager/hooks/useExplorerCommands.js:80-85`, `client/src/utils/refreshPolicy.js:19-24`
- **Problem:** caller sends `{ opType, startedNodeId, currentNodeIdNow, targetParentNodeId }`; function destructures path names and normalizes `undefined` → both paths become `/` → **always returns refresh**. Per-operation refresh gating is ineffective and can cause mis-refreshes.
- **Fix (decision 2026-09-02: option (a) — migrate to nodeId):** rename `refreshPolicy` params to `startedNodeId`/`currentNodeIdNow`/`targetParentNodeId`, drop `normalizePath`; rewrite `refreshPolicy.test.js` fixtures (path strings → nodeIds; add identity/null edge cases); align the two stray path-keyed call sites in `FileManager.js:567/637`; update the `refreshPolicy.md:24` note with the code.
- **Priority:** medium (behavioral).

### C-4 — `setup.test.js` PostgreSQL gating (decision: option B)
- **File:** `server/domains/setup/__tests__/setup.test.js`
- **Problem:** under `npm run test:ci:pg` the suite fails 44/44 with `TypeError: Pool is not a constructor` — its `jest.mock('pg', () => ({ Client: jest.fn() }))` (line 22) lacks `Pool`, and `createTestDatabase → initMetadataStore → applyPendingMigrations('postgresql') → storage.getPgPool()` reaches `new Pool(...)` when the backend env is `postgresql`.
- **Decision (made):** **option B** — make the suite self-declare SQLite-only: gate the PG-touching metadata-store path (e.g. `describe.skipIf` for the PG backend run) consistent with existing per-suite backend gating.
- **Status:** DECIDED — scheduled for the next iteration, not part of the 2026-09-02 wave.

### M-1 — cosmetic cleanup (optional)
- `explorerGateway.js` `removeRecentFile` internal parameter is still literally named `path` although the contract is nodeId (docs already aligned). Rename the param.

## 3. Document drift backlog (residual after the 2026-09-02 alignment)

| ID | Item | Source |
| -- | ---- | ------ |
| 3-1 | Blob-job payload still described with the extended shape in a few spots (`progress:{percent,currentLabel}`) while code + `tools/blob-migration.md` §4.4 store scalar `progress` + top-level `current`/`results`. | `docs/features/migration-mode.md` (:18/:250/:307/:308) |
| 3-2 | `setFolderMenuAnchor` argument documented as "-" (code passes `e.currentTarget`); code `baseFolderNodeId` prop undocumented. | `docs/spec/client/components/dialogs/ShareFolderTree.md` §2.3 |
| 3-3 | `admin.health.*` i18n keys used by the backend-health card not listed. | `docs/spec/client/components/mypage/content/SystemSettingsContent.md` §2.5 |
| 3-4 | Spec tree folder naming inconsistent (`store/` vs `stores/`, `service/` vs `services/`); contents and source paths are accurate. | `docs/spec/server/{store,stores,service,services}` |

## 4. Deferred & future work (decided — no active owner)

| ID | Status | Item | Originating doc (now references here) |
| -- | ------ | ---- | ------------------------------------- |
| DEF-1 | DEFERRED | Admin/operator app split (recorded, not planned). | `docs/features/migration-mode.md` |
| DEF-2 | DEFERRED | env↔DB sync/alert tool (D9). | `docs/features/config-source-resolution.md` |
| DEF-3 | DEFERRED | `encrypt_secret_key` rotation tooling. | `docs/features/config-source-resolution.md` |
| DEF-4 | DEFERRED | Blob migration source-delete mode (`--delete-mode`). | `docs/spec/server/tools/blob-migration.md`, `docs/SETUP.md` |
| DEF-5 | DEFERRED | HTTP Range/206 support on public share download. | `docs/spec/server/routes/sharePublic.md` |
| DEF-6 | DEFERRED | Future raw-WebDAV protocol mount behind the migration gate. | `docs/spec/server/infrastructure/migrationGate.md` |
| DEF-7 | DEFERRED | Multi-version object history (`version_number > 1`). | `docs/spec/server/services/blobStorageService.md`, `docs/spec/server/store/fileNodesStore.md`, `docs/features/core-service-layer.md` |
| DEF-8 | DEFERRED | Redis-backed cache / operationProgress store. | `docs/spec/server/services/downloadService.md`, `docs/ARCHITECTURE.md` |
| DEF-9 | DEFERRED | schemaManager checksum-based modified-DDL detection. | `docs/spec/server/infrastructure/schemaManager.md` |
| DEF-10 | DEFERRED | Client test-quality refactor — 424 implementation-detail assertions, fragile mock factories. | former `docs/IMPROVEMENT_PLAN.md` §11 |
| DEF-11 | DEFERRED | FileManager `useMemo`/`useCallback` performance sprint (MutationObserver already applied). | former `docs/IMPROVEMENT_PLAN.md` §12 |
| DEF-12 | DEFERRED | CRA v5 → Vite migration (separate project/epic). | former `docs/IMPROVEMENT_PLAN.md` §13 |
| CLOSED | RESOLVED | Client↔server integration-test layer (former §20) — superseded by route-level integration tests + E2E coverage. | former `docs/IMPROVEMENT_PLAN.md` §20 |
| CLOSED | RESOLVED | Byte-weighted migration progress — out of scope. | `docs/spec/server/tools/blob-migration.md` |

## 5. Resolved & RCA log

### 2026-09-02 — Repo-wide doc↔code alignment wave (branch `chore/consolidate-open-items`)

- **Server spec:** `ensureHomeOwnerAdmin` marked REMOVED → real impl in `cleanupService.js` (nodeId); `configRegistry` `THUMBNAIL_TOKEN_SECRET` secret→yes; phantom "(T3)/boot snapshot loader" references removed (`configRegistry`/`configResolver`); `routes/setup.md` apply scenarios rewritten to the real contract (metadata T0 never written, `postgresql` rejected); `thumbnails`/`thumbnail` "pending implementation in S1" removed; `downloadService.getDownloadProgress` marked implemented; `files.md` mount → `/api/folders`; `users.md`/`auth.md` password + username-priority contracts fixed; `metadataMigrationService` explicit-target variant marked implemented; `fileNodesStore`/`userStore`/`locks` naming aligned to code; `bulkJobStore.md` renamed → `operationProgress.md`; `blobStorageService` multi-version note neutralized.
- **Client spec:** `ShareFolderTree` false "still path-keyed" claim removed; `FolderTree`/`BaseFolderTreeItem`/`SharedFoldersSection` target-contract wording → current state; `AuthContext` "(split target)" removed; `FileManager.md` "(planned)/still monolithic" → implemented; `sharePermissionSaveUseCase`/`shareTargetPermissionSaveUseCase` revoke semantics fixed (best-effort revoke, fatal grant); `FilePreviewDialog` iOS hint → optional + tracked; `SystemSettingsContent` key-lost-warning UI spec added; `explorerGateway.removeRecentFile` → nodeId; `fileViewUtils` path-fallback note updated.
- **Feature/infra:** `config-source-resolution` D3 apply rewritten + future-tooling moved here; `auth-users-settings` password semantics aligned; `client-ui` → v7 baseline; PLAN.md citations removed from `migration-mode`/`backend-health`/`E2E_COVERAGE_PLAN`/`TEST_GIT_GUIDE`/`TESTING_STRATEGY`; blob/metadata-migration payload docs made type-dependent; deferred statements moved to §4; E2E bucket wording (ensure both modes, empty s3) fixed; RCA references repointed from `.cursor/` to this document + AGENTS §3.2.
- **Retirement:** root `PLAN.md` content and `docs/fail_log.md` removed after review — future RCA entries are recorded here (AGENTS.md §3.2).

### 2026-09-02 — D-1/D-2/D-3 decisions (client cleanup)

- **D-1 (option (a) — migrate `refreshPolicy` to nodeId):** rename to `startedNodeId`/`currentNodeIdNow`/`targetParentNodeId`, drop `normalizePath`. Verified: every op payload producer (delete `useBulkOperations.js:284`, move/copy `:580-581`, rename, upload) already emits nodeId keys, so gating becomes effective once implemented. Implementation = C-3.
- **D-2 (delete now):** confirmed file-level capability is consolidated in `permissionService` (`grantPermission`/`revokePermission` with `target:'file'`, `checkPermission`, `listFilePermissions`); the `fileService` wrappers are pure delegates with zero production consumers. Implementation = C-2.
- **D-3 (no hint):** iOS image share sheet presents native save options and is self-explanatory; no product request. Spec wording updated to current state in `FilePreviewDialog.md` and `client-ui.md`.

### Historical completed improvement backlog (pre-2026-09-02)

All P0/P1/P2 items complete; P3 #16–#19 complete. Provenance commits: `1562613` (P0 security/leak/logging), `c133db0` (P1 Korean→English, asyncHandler, status constants), `ace302b` (lint/format config + P3-16), `b175854` (P3-17 JWT dev warning, P3-19 inline requires), `ded0ce8` (P2-15 structured logging), `250cc3a` (P2-12 MutationObserver), `fb83a55` (P3-18 JSDoc), `7c32b7e` (P2-10 test gaps), `1089e0f` (SQLite backend + Docker WebDAV scripts). Remaining former items (#11/#12/#13) are tracked in §4; #20 closed in §4.

---
