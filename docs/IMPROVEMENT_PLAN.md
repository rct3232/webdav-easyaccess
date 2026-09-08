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
| DEF-14 | DEFERRED (trigger-gated) | New-RDB adoption gate: generalize the metadata store beyond the current sqlite + PostgreSQL pair to MySQL, MariaDB, MSSQL and Oracle via boot-time engine auto-detection from a generic connection block. **Decision (2026-09-04): do NOT adopt an ORM today** — keep the executor seam + per-dialect repositories + per-engine conformance for sqlite/PG. **Introduce a single-source query layer (ORM/query builder) at the moment a second new engine is actually added** (evaluate Drizzle/Kysely first). Full rationale in the DEF-14 note. | `docs/spec/server/store/storage.md`, `docs/features/config-source-resolution.md`, `docs/spec/server/infrastructure/configRegistry.md`, `docs/spec/server/store/executor.md`, `docs/spec/server/store/repository-contract.md` |
| DEF-15 | DONE | E2E assertion-context containment + hermetic overlap IMPLEMENTED on 2026-09-07 (PLAN.md W4/W4b/W5/W10 + Option A Phases 1–2; see the DEF-15 note): `core-flow.*` create/assert only inside per-case owned folders (docs/TESTING_STRATEGY.md); explicit `--workers=N` flags removed (Playwright auto-sizes to half the logical cores); the hermetic suites are independent siblings with per-suite scratch ports :5003/:5010/:5011, distinct scratch PG DBs, a dedicated migration bucket, and an up-front webdav restart. | `docs/TESTING_STRATEGY.md`, `PLAN.md` (W4/W5) |

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
- A failed **overwrite** still leaves the documented pending state (S3 `pending_upload` /
  WebDAV `orphaned_node`) with **no automatic recovery** — see DEF-12/DEF-13.

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
