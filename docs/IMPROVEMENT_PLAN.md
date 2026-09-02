# Codebase Improvement Plan — Consolidated Open-Item Tracker

> **Updated**: 2026-09-02
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
| DEF-10 | DEFERRED | Client test-quality refactor — 424 implementation-detail assertions, fragile mock factories. | former improvement-plan backlog (pre-2026-09-02, item #11) |
| DEF-11 | DEFERRED | FileManager `useMemo`/`useCallback` performance sprint (MutationObserver already applied). | former improvement-plan backlog (pre-2026-09-02, item #12) |
| DEF-12 | DEFERRED | CRA v5 → Vite migration (separate project/epic). | former improvement-plan backlog (pre-2026-09-02, item #13) |

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
