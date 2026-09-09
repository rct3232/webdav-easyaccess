# Codebase Improvement Plan — Consolidated Open-Item Tracker

> **Updated**: 2026-09-08
> **Purpose**: This is the **single tracking document** for every unresolved, undecided, or
> unimplemented item in the repository.
>
> **Governance rule**: Spec/feature docs describe only the **current implemented/decided**
> state. Planned/future/"pending implementation"/"target contract" work must **not** be written
> into individual docs — record it here instead (see AGENTS.md §2.1).
>
> **Status legend**: `DEFERRED`, `DONE`

---

## 1. Deferred & future work (no active owner)

Ordered by urgency review (2026-09-08): highest priority first.

| ID | Status | Item | Originating doc (now references here) |
| -- | ------ | ---- | ------------------------------------- |
| DEF-12 | DONE (2026-09-09) | R1 (S3 overwrite rollback) + R2 (`pending_upload` scan/repair/startup report, S3 mode) + R3 (retention-category GC foundation with last-good guard + stale pending-live cleanup) + D5a (`retry-delete` deletes the remote WebDAV blob/file bottom-up) + D5d (`force-active` remote-existence check with 409 refusal) all landed. Specs: `uploadService.md` §2.3/§2.5/§2.5.1, `gcService.md` §2, `admin.md` §2.2.3. Residual WebDAV remote↔DB reconciliation remains separately as DEF-18; rename/move old-path orphan as DEF-17. | `docs/spec/server/services/uploadService.md` §2.5, `docs/spec/server/services/gcService.md` §2, `docs/features/core-service-layer.md` |
| DEF-13 | DONE (2026-09-09) | Crash residue between TX1 and the blob write is now bounded and recoverable: R1 rollback removes the common case; the GC last-good guard protects the previous version's row/blob, stale pending rows+blobs are cleaned after `GC_PENDING_STALE_DAYS` (default 3d, 0=off), Tier 2 keeps pending-live keys; the startup report lists stuck `pending_upload` nodes (report-only, threshold-gated) and admin repair actions (`complete`/`restore-previous`/`delete`/`auto`) resolve them. | `docs/spec/server/services/uploadService.md` §2.5/§2.5.1 |
| DEF-6 | DEFERRED | HTTP Range/206 support on public share download. | `docs/spec/server/routes/sharePublic.md` |
| DEF-7 | DEFERRED | Blob migration source-delete mode (`--delete-mode`). | `docs/spec/server/tools/blob-migration.md`, `docs/SETUP.md` |
| DEF-9 | DEFERRED | Redis-backed cache / operationProgress store. | `docs/spec/server/services/downloadService.md`, `docs/ARCHITECTURE.md` |
| DEF-11 | DEFERRED | Multi-version object history (`version_number > 1`). | `docs/spec/server/services/blobStorageService.md`, `docs/spec/server/store/fileNodesStore.md`, `docs/features/core-service-layer.md` |
| DEF-16 | DEFERRED (P1 schema slice landed 2026-09-09) | Trash / recycle-bin (soft delete + retention + restore). Model: `file_nodes.deleted_at` (orthogonal to `sync_status`); global trash with permission-based visibility; read-gating so a trashed node is hidden from all listings (folder, `__recent__`, `__shared__`) and returns not-found on direct access. **Requires the retention-category GC foundation built under DEF-12/13 (R3)** (trash = one retention category + a purge tier + `TRASH_RETENTION_DAYS`). **P1 done**: `ddl/002_trash_soft_delete.sql` adds `deleted_at` and converts the `(parent_id, name)` uniqueness (incl. root variant) to partial unique indexes over `deleted_at IS NULL`; sqlite schema application moved to the tracked `applyPendingMigrations('sqlite')` path (constraint drop requires a table rebuild, emitted by the transpiler). Remaining: P2 soft-delete, P3 restore/purge, P4 read-gating, P5 GC category, P6 scheduling, P7 permissions, P8 migration proof, P9 UI. See the retention-GC note (2026-09-09); full design in `PLAN.md` (2026-09-09 workstream). | `docs/spec/server/store/fileNodesStore.md` §2.2, `docs/spec/server/infrastructure/schemaManager.md`, `PLAN.md` |
| DEF-8 | DEFERRED | Admin/operator app split (recorded, not planned). | `docs/features/migration-mode.md` |
| DEF-10 | DEFERRED | CRA v5 → Vite migration (separate project/epic). | former improvement-plan backlog (pre-2026-09-02, item #13) |
| DEF-14 | DEFERRED (trigger-gated) | New-RDB adoption gate: generalize the metadata store beyond the current sqlite + PostgreSQL pair to MySQL, MariaDB, MSSQL and Oracle via boot-time engine auto-detection from a generic connection block. **Decision (2026-09-04): do NOT adopt an ORM today** — keep the executor seam + per-dialect repositories + per-engine conformance for sqlite/PG. **Introduce a single-source query layer (ORM/query builder) at the moment a second new engine is actually added** (evaluate Drizzle/Kysely first). Full rationale in the DEF-14 note. | `docs/spec/server/store/storage.md`, `docs/features/config-source-resolution.md`, `docs/spec/server/infrastructure/configRegistry.md`, `docs/spec/server/store/executor.md`, `docs/spec/server/store/repository-contract.md` |
| DEF-17 | DEFERRED | WebDAV rename/move leaves the **old-path** remote file undeleted — a physical orphan both on success and on re-upload failure; a failed remote delete leaves an orphan with no DB row. Separate fix from DEF-12/13: capture the old path and delete it (no reconciliation sweep). | `docs/spec/server/services/fileService.md` |
| DEF-19 | DEFERRED | `npm run lint:ci` fails on `dev` (pre-existing since `00c762c`): `e2e/reporters/test-end-logger.js` reports 4 × `no-undef` (`require`/`process`/`console`/`module`) — the file is a Node reporter but the ESLint environment for it doesn't declare Node globals. Unrelated to the S1 branch; found while running the S1 merge gate on 2026-09-09. | `e2e/reporters/test-end-logger.js` |
| DEF-18 | DEFERRED (retention-gated) | WebDAV remote↔DB reconciliation sweep ("Tier 2" for WebDAV; today `WebdavBlobStore.listOrphanedKeys()` returns `[]`). Must be **retention-category aware** (active/trash/version/garbage), NOT a naive "delete anything not in DB" walk — co-design with DEF-16/DEF-11. | `docs/spec/server/services/gcService.md` |

---

### DEF-14 note (2026-09-04) — New-RDB adoption gate: ORM decision

Deferred, trigger-gated item (no active owner). Recorded here per AGENTS.md §2.1; **not**
written into any spec/feature doc.

- **Current state (updated 2026-09-04)**: the metadata store supports only `sqlite` and
  `postgresql`, and the D-phase DB-interface work landed: all dialect branching is now
  confined to a small executor seam (`server/infrastructure/db/`), per-domain repositories
  (`server/store/repositories/*` + `domains/permissions/stores/repositories/*`), with the
  stores as facades over repository contracts. Services never see SQL or dialect branches.
  Schema stays PG-canonical and is transpiled to sqlite (`convertPostgresToSqlite`). The
  backend-agnostic L2 conformance suites run the same behavioural contract against both
  real engines (sqlite in `test:ci`, PostgreSQL in `test:ci:pg:adapters`).
- **Decided (2026-09-04)**: do NOT adopt an ORM/query builder for the current sqlite+PG
  support. The executor + two-dialect repositories + per-engine conformance is the standing
  architecture; a query layer would require reworking the DDL/migration pipeline and still
  need raw escape hatches for the ancestor-closure, partial-index, GC-interval and JSONB-vs-
  TEXT constructs, while engine-behaviour differences (ordering ties, locking, isolation,
  timestamp precision) would still need the same conformance suites.
- **Trigger**: introducing the NEXT engine from the DEF-14 target list (MySQL / MariaDB /
  MSSQL / Oracle — only when it enters the real deployment/test matrix) is the decision
  point to introduce a single-source query layer (one implementation instead of N dialect
  files). Evaluation order at that point: **Drizzle / Kysely** first (typed query builders
  with sqlite/pg/mysql/mariadb dialect compilation and raw-SQL escape hatches); the
  originally-listed Sequelize (ORM-first, heavy) and Knex (builder-first) are fallback
  candidates. The repository interfaces and facades stay; the ORM replaces the per-dialect
  repository *implementations* only, and per-engine conformance suites remain mandatory.
- **Remaining undecided (only relevant at the trigger)**:
  - Per-engine DDL/migration strategy (replaces the PG-canonical + regex-transpile model).
  - Generalization of code-level backend identifiers baked today (`'postgresql'`/`'sqlite'`
    in health keys, `activeMetadataBackend`, `postgresqlNotConfigured` error code, sqlite↔pg
    migration directions, `mapDatabaseError` PG SQLSTATE mapping).
  - Metadata migration tooling beyond sqlite↔pg; e2e/docker-compose matrices (only
    PostgreSQL is provisioned today).
- **Related workstream (landed)**: the engine-agnostic connection block with presence-based
  selection (`WEA_DB_*`, W-9 `3a51213`), the env-config cleanup (jest isolation via
  `WEA_TEST_PG_*` + storage test-only override, DB-only tuning keys), and the DB-interface
  rollout (executor seam + repositories + L2 conformance + adapter-leg retirement of the
  full-suite PG run). Runtime support intentionally stays at sqlite + PostgreSQL; wiring a
  new engine is the trigger for the ORM decision above.

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
- A failed **overwrite** no longer leaves a stuck state on S3: since S1 (2026-09-09,
  `fix/upload-overwrite-recovery`) the S3 overwrite rolls back to the pre-state on S3 PUT/TX2
  failure (previous version stays downloadable). The WebDAV overwrite `orphaned_node` path still
  has no automatic recovery — see DEF-12/DEF-13.

### DEF-15 note (2026-09-07) — E2E assertion-context containment refactor (IMPLEMENTED)

Resolved on 2026-09-07 (PLAN.md W4/W4b/W5/W10 + Option A Phases 1–2). Recorded here per
AGENTS.md §2.1. Root cause and shipped state:

- Root cause (fixed): the admin home is the filesystem root and the client renders at most 50
  items per listing, so visibility assertions against the shared root coupled tests to creation
  order and blocked intra-project parallelism. The containment policy landed in
  `docs/TESTING_STRATEGY.md` (§ Assertion-context containment); the core-flow specs now
  create/assert only inside a per-case owned base folder under the root (`openPrivateWorkspace`
  in `e2e/helpers/files.ts`) and delete that base folder via the API in `test.afterEach`
  (`flushPrivateWorkspaceCleanups`), so per-case data never accumulates at the root across a run.
- Auto-sized workers (post-merge 2026-09-07): explicit `--workers=N` flags were removed from all
  e2e scripts — Playwright now auto-sizes the pool to half the logical cores (min 1). Runs at the
  auto value match the baseline sets (full s3 185 pass / 3 skip / 0 fail; core 122 exec / 119
  pass / 3 skip).
- Hermetic overlap (W5 + Option A Phases 1–2): mypage-admin moved to dedicated post-reset
  projects (B2); share-public's describe is serial (B3). The hermetic suites
  (setup-wizard/admin-config/migration) are now INDEPENDENT siblings — each owns a distinct
  scratch port (:5003 wizard / :5010 admin-config / :5011 migration) mirrored by its
  playwright.config baseURL, distinct scratch PG DB names (wizard `webdav_e2e_setup`, migration
  `webdav_e2e_migration_<case>`), and migration targets a dedicated MinIO bucket
  (`e2e-migration-bucket`). The webdav container restart is done once up-front in
  `e2e/global-setup.ts` (both modes), removing the mid-run lazy restarts. A suite's mobile
  variant still depends on its desktop, so one suite never overlaps itself on its own port.
- W6 reassessment (2026-09-07): the migration/setup/admin-config "depth" is NOT trimmed — those
  deep DB/.env/blob asserts are the suite's only real-webdav / real-config-write coverage (server
  tier tests those paths with mocked/fake stores only), and hermetic test time is only ≈ 4 min.
   Prerequisite for any future depth move: a real-webdav server leg (see W3 option B).

---

### Retention-category GC note (2026-09-09) — shared foundation for DEF-11 / DEF-12 / DEF-13 / DEF-16

Recorded here per AGENTS.md §2.1 (single tracking doc; the full design lives in `PLAN.md`,
"Workstream 2026-09-09").

- **Root fact**: GC today is binary — keep exactly the `active` object_map set, garbage-collect the
  rest (`gcService.js` Tier 1/2, keep-set `getAllActiveS3Keys`). Every "keep old data" feature breaks
  that single assumption.
- **Decision (Option Y, user-confirmed 2026-09-09)**: DEF-12/13's R3 builds the **retention-category**
  GC foundation — category-aware Tier 1/2/3 + a single keep-set seam `getKeptS3Keys()`
  (= active ∪ trash ∪ version ∪ pending-live) + config keys + an extracted `purgeNodeSubtree`.
  DEF-11 and DEF-16 are then **additive** (one category + one config each; trash adds a purge tier);
  no GC rework. **Guardrail**: with default configs the GC is observably identical to today
  (version TTL = 1 day = today; trash category disabled; pending-stale strictly additive) so
  DEF-12/13 merges/verifies on its own tests.
- **Categories** (derived by query, NOT stored as new status values): `active`, `trash`
  (node `deleted_at` set, DEF-16), `version` (orphaned prior versions, DEF-11), `pending-live`
  (stuck `pending_upload`, DEF-12/13), `garbage`, `untracked` (S3-only).
- **Dependencies / sequencing**:
  - DEF-12/13 (R3) provides the foundation → unblocks DEF-11 (S7) and DEF-16 (P5+).
  - DEF-11 needs only the foundation (raise `GC_VERSION_TTL_DAYS` + browse/restore-version API/UI).
  - DEF-16 P1–P4 (schema / soft-delete / restore / read-gating) are GC-independent → parallel with
    DEF-12/13; DEF-16 P5–P6 (trash GC + purge) need the foundation.
  - DEF-18 (WebDAV reconciliation) is deferred and must be retention-aware — do NOT build a naive sweep.
  - DEF-17 (WebDAV rename/move old-path orphan) is a separate bug fix, out of DEF-12/13 core scope.
- **In scope for DEF-12/13 core**: R1 (overwrite rollback) + R2 (scan/repair/startup report) + R3
  (GC foundation), plus the small D5a (`retry-delete` also deletes the remote blob) and D5d
  (`force-active` remote-existence check). **Not in scope**: the D5c sweep (→ DEF-18) and the
  rename/move old-path leak (→ DEF-17).
