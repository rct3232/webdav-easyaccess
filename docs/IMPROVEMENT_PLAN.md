# Codebase Improvement Plan — Consolidated Open-Item Tracker

> **Updated**: 2026-09-03
> **Purpose**: This is the **single tracking document** for every unresolved, undecided, or
> unimplemented item in the repository.
>
> **Governance rule**: Spec/feature docs describe only the **current implemented/decided**
> state. Planned/future/"pending implementation"/"target contract" work must **not** be written
> into individual docs — record it here instead (see AGENTS.md §2.1).
>
> **Status legend**: `DEFERRED`

---

## 1. Deferred & future work (no active owner)

Ordered by urgency review (2026-09-02): highest priority first.

| ID | Status | Item | Originating doc (now references here) |
| -- | ------ | ---- | ------------------------------------- |
| DEF-6 | DEFERRED | HTTP Range/206 support on public share download. | `docs/spec/server/routes/sharePublic.md` |
| DEF-7 | DEFERRED | Blob migration source-delete mode (`--delete-mode`). | `docs/spec/server/tools/blob-migration.md`, `docs/SETUP.md` |
| DEF-8 | DEFERRED | Admin/operator app split (recorded, not planned). | `docs/features/migration-mode.md` |
| DEF-9 | DEFERRED | Redis-backed cache / operationProgress store. | `docs/spec/server/services/downloadService.md`, `docs/ARCHITECTURE.md` |
| DEF-10 | DEFERRED | CRA v5 → Vite migration (separate project/epic). | former improvement-plan backlog (pre-2026-09-02, item #13) |
| DEF-11 | DEFERRED | Multi-version object history (`version_number > 1`). | `docs/spec/server/services/blobStorageService.md`, `docs/spec/server/store/fileNodesStore.md`, `docs/features/core-service-layer.md` |

---

### Completion note (2026-09-02)

All previously open items were resolved on 2026-09-02 and removed from this tracker during
consolidation:

- decisions D-1…D-3 (refreshPolicy direction, dead `fileService` permission wrappers, iOS
  "Save Image" hint),
- code changes C-1…C-4 and M-1 (envFileWriter allowlist, `fileService` wrapper removal,
  `refreshPolicy` nodeId migration, setup-suite PG gating, `removeExplorerRecentFile` param),
- residual doc drift 3-1…3-4, and the pre-2026-09-02 completed backlog.

The resolved-work log and its provenance commits were removed with the completed items. No
open items remain outside the DEF list above.

---

### Completion note (2026-09-03)

- DEF-1 (schemaManager checksum-based modified-DDL detection, Option A hard fail) implemented
  on 2026-09-03 via `feature/checksum-ddl-detection`.
- DEF-4 (FileManager `useMemo`/`useCallback` performance sprint, P2/P1/P3) implemented on
  2026-09-03 via `refactor/filemanager-memo-sprint` (P4 optional items remain open, no behavior change).
- DEF-3 (env↔DB config sync/alert CLI, `server/scripts/configSync.js` — `--check` drift report
  with `key-lost` alerting + `--apply --yes` reconcile, backed by the new
  `settingsStore.listRows()`) implemented on 2026-09-03 via `feature/env-db-sync-tool`.
- DEF-5 (`encrypt_secret_key` rotation CLI, `server/scripts/rotateEncryptKey.js` — default dry-run
  decrypt-verify + `--apply --yes` DB-first re-encryption that writes the new key to `.env` last via
  the backed-up atomic writer, with a key-lost refusal) implemented on 2026-09-03 via
  `feature/encrypt-key-rotation`.
- DEF-2 (test black-box compliance refactor, client + server) implemented on 2026-09-03 via
  `refactor/black-box-test-compliance`: dropped redundant mock-call pins in favor of observable
  assertions (client hooks/dialogs + server blobStorage/upload/config suites, orchestrator
  count pins), converted `client/src/testing/mocks/serviceMocks.js` to behavior-based defaults and
  deleted the dead `createMigrationServiceMock`, and recorded the delegation-seam policy (a
  mock-call pin is exempt only where a spec documents the delegation as a contract; otherwise
  assert the observable) in `docs/TESTING_STRATEGY.md`.
