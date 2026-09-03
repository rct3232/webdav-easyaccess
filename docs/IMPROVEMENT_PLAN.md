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
| DEF-12 | DEFERRED | S3/WebDAV **overwrite** upload failure leaves `pending_upload` (S3) / `orphaned_node` (WebDAV) row with no automatic recovery; retry endpoint + GC cleanup of `pending` object_map rows and untracked S3 blobs is unimplemented. | `docs/spec/server/services/uploadService.md` §2.5, `docs/spec/server/services/fileService.md` §4, `docs/features/core-service-layer.md` |
| DEF-13 | DEFERRED | Process death between an upload's TX1 commit and the blob write leaves orphaned `pending_upload` rows that no automatic path cleans. | `docs/spec/server/services/uploadService.md` §2.5 |

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
  2026-09-03 via `refactor/filemanager-memo-sprint` (no behavior change).
- DEF-4 residual P4 items (previously "optional, remain open") implemented on 2026-09-03 via
  `refactor/filemanager-auth-context-perf`: `FileManager` selection reverse-lookups converted
  from O(selection × files) `.find` scans to a `key→file` Map; `AuthContext` provider value
  memoized by `useMemo`; dead props (`hasWritePermission`/`currentPath`/`onPathClick`) no longer
  forwarded to the memoized `FileList`/`FileGrid`/`FileDetail` views (restoring their
  `React.memo` bail-out on unrelated re-renders); `FileListItem`/`FileGridItem` spec memo
  checklist claims removed and the memoization-is-implementation-detail rule recorded in
  `docs/TESTING_STRATEGY.md`. No observable behavior change.
- DEF-3 (env↔DB config sync/alert CLI, `server/scripts/configSync.js` — `--check` drift report
  with `key-lost` alerting + `--apply --yes` reconcile, backed by the new
  `settingsStore.listRows()`) implemented on 2026-09-03 via `feature/env-db-sync-tool`. Its
  `key-lost` alert status was removed the same day by W-A (`refactor/remove-app-encryption`):
  DB `settings` secrets are stored as plaintext, so the sync tool compares plaintext strings
  and has no key-loss concept left (see W-A note below).
- DEF-5 (`encrypt_secret_key` rotation CLI, `server/scripts/rotateEncryptKey.js` — default dry-run
  decrypt-verify + `--apply --yes` DB-first re-encryption that writes the new key to `.env` last via
  the backed-up atomic writer, with a key-lost refusal) implemented on 2026-09-03 via
  `feature/encrypt-key-rotation`. The tool was **fully removed** the same day by W-A
  (`refactor/remove-app-encryption`), along with the whole app-layer field-encryption design
  it existed for (see W-A note below).
- DEF-2 (test black-box compliance refactor, client + server) implemented on 2026-09-03 via
  `refactor/black-box-test-compliance`: dropped redundant mock-call pins in favor of observable
  assertions (client hooks/dialogs + server blobStorage/upload/config suites, orchestrator
  count pins), converted `client/src/testing/mocks/serviceMocks.js` to behavior-based defaults and
  deleted the dead `createMigrationServiceMock`, and recorded the delegation-seam policy (a
  mock-call pin is exempt only where a spec documents the delegation as a contract; otherwise
  assert the observable) in `docs/TESTING_STRATEGY.md`.

### W-A note (2026-09-03, `refactor/remove-app-encryption`)

The following work was completed earlier the same day (see DEF-3/DEF-5 above) and is now
**removed/current-state** as part of W-A "remove app-layer field encryption":

- App-layer AES-256-GCM field encryption of DB-stored secrets is **gone**: `settings` rows hold
  plaintext strings, the registry `secret` flag means presentation-level `'****'` masking only,
  and no `key_lost_warning` is surfaced on any API/UI path.
- `encrypt_secret_key` no longer exists (registry entry, `.env`/wizard generation, `.env`
  examples all removed), and the `configEncryption` util, the `rotateEncryptKey` CLI, and their
  specs/feature docs were deleted.
- configSync still exists (CLI + admin web action) with plaintext comparison and no `key-lost`
  status; T0 keys remain excluded; `--apply` writes plaintext to the DB.
- Residual: ciphertext rows written by older versions are not auto-migrated; operators may need
  to clean them up manually if any exist.

### W-1 note (2026-09-03, `fix/upload-rollback-on-backend-failure`)

Current-state decision recorded here because the affected spec/feature docs now reference this
tracker instead of carrying planned statements:

- A failed **new-file** upload (S3 `uploadService.uploadFile`, WebDAV new-file upload, WebDAV
  `copyFile`) rolls the created node back — no phantom 0-byte/pending row is left in listings and
  retries are not blocked by a duplicate-name conflict.
- A failed **overwrite** still leaves the documented pending state (S3 `pending_upload` /
  WebDAV `orphaned_node`) with **no automatic recovery** — see DEF-12/DEF-13.
