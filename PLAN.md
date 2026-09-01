# PLAN — Unified Migration Mode (metadata DB migration + blob migration cutover)

Status: DESIGNED — full implementation plan agreed (2026-09-01). Not started.
Branch (planned): `feature/migration-mode` (base: `dev`).

## 1. Objective

Build a single, safe migration experience for both metadata (sqlite ↔ postgresql) and blobs
(s3 ↔ webdav), replacing the current manual/partial flows:

- **F1 (metadata DB migration)** — today completely unsupported: no sqlite↔PG tool/checklist/UI
  (old `migrateMetadataToPostgresql.js` removed, `server/scripts/migrate/` empty, docs only support
  fresh-DB boot). PG connection is `.env`-owned (T0), so a supported migration path + a
  ".env setup needed" notification are required.
- **F2 (blob migration cutover)** — today the operator is told to manually edit
  `WEA_FILE_STORAGE` + the target block in `.env` and restart (en.json:543); the dialog's
  destination credentials are used transiently for the copy and discarded; no post-restart
  verification of the cutover.
- **New: migration mode** — while a migration runs, the whole app is locked: a dedicated
  `/migration` page shows progress and forces the operator to stay until the migration reaches a
  terminal state (completed / failed / cancelled). Migrations must be cancellable mid-way.

## 2. Background / current state (verified 2026-09-01)

- **F1**: both schemas are structurally identical — the sqlite DDL is generated at runtime from
  `server/store/postgresql/ddl/001_initial_normalized_schema.sql` via `sqliteSchemaInit.js`
  type-conversion (JSONB→TEXT, TIMESTAMPTZ→TEXT, BOOLEAN→INTEGER, BIGSERIAL→INTEGER PK
  AUTOINCREMENT). Only `settings.value` differs semantically (sqlite raw TEXT vs PG JSONB-string)
  and `_schema_migrations` exists only in PG. The metadata adapters are legacy (broken
  `share_links.file_path` code, users-only) — use direct SQL. Encryption (AES-256-GCM,
  `sha256(encrypt_secret_key)`) survives the copy iff the key is identical and `settings.value`
  is wrapped as a JSON string for PG. `encrypt_secret_key` is T0/.env-only.
- **F2**: all storage keys are T1/DB-backed (`configRegistry.js:41-50`). A DB write does not
  affect the running process — `process.env` is only populated at boot
  (`populateT1Env`, `configResolver.js:234-252`); composition/blobstore snapshot
  `process.env.WEA_FILE_STORAGE` once (`composition.js:24`, `blobstore/index.js:32`). Restart is
  strictly required for a storage-backend switch. Migration verification building blocks already
  exist: `runProbe`/`probeS3`/`probeWebdav` (`backendProbe.js`), `POST /api/admin/config/test`
  pending-values merge (`config.js:177-209`), and the health tracker (`backendHealth.js`).
- **Blob migration today** (admin API + MigrationDialog): copy-only, source preserved, snapshot
  enumeration, `object_map`/`filecache` updated per node; progress is node-count based
  (`progress`/`total`/`current` job fields); cancel exists but the `runCopy` loop does not
  necessarily abort between nodes.
- **Boot**: PG pre-flight exits on missing `WEA_PG_*` (D6); WebDAV boot probe is warn-only
  (`index.js:214-228`); S3 has no boot probe; health tracker resets to `unknown` at boot.

## 3. Confirmed decisions

| # | Area | Decision |
|---|------|----------|
| D1 | Config location | Migration **configuration stays in dialogs** (System Settings). Blob `MigrationDialog` is kept; a new metadata-migration dialog is added. The `/migration` page is for **execution/progress only**, not configuration. |
| D2 | Start flow | Clicking apply/start in a dialog begins the migration, sets the migration gate, and **auto-redirects to `/migration`**. While running, the operator is forced to stay on `/migration`. |
| D3 | Gating | **Server-side enforced**: a migration gate middleware returns `503 migrationInProgress` for all routes (including the WebDAV protocol) except the allow-list: `/api/health`, `/api/admin/login`, `/api/admin/migration/*`, `/api/migration/status`. Client app-guard polls `GET /api/migration/status` and redirects any route to `/migration` while active (double safety). |
| D4 | Cancellation | Migrations must be cancellable mid-way. **DB migration** = whole op (schema + wipe + copy) in one target transaction → cancel = ROLLBACK, both sides unharmed. **Blob migration** = cancel flag set immediately, current node finishes then stops; partial progress is kept (source preserved) and resumed on rerun (`shouldSkip`). `runCopy` loop needs a cancel check. |
| D5 | DB target handling | Before starting, **scan the target**: `schemaExists` + per-table row counts. If data exists → wipe alert in the config dialog listing affected tables/rows → explicit admin confirm (`wipeTarget=true`) before proceed. Wipe runs in the same transaction as the copy → cancel rolls back the wipe too. |
| D6 | Target schema | If the target has no schema, **auto-apply DDL** to the explicit target backend/connection. Requires refactoring the schema manager (`schemaManager`/`initSqliteSchema`) to apply DDL to an explicit target rather than only the active backend. |
| D7 | `/migration` content | Progress only: overall determinate %, current-operation label, counters (blob). **No per-step/table list** (dropped by request). |
| D8 | Blob progress | **Node-count based**: `total` = active file_nodes in the snapshot, `progress` incremented per processed node, `% = progress/total`. Show current file label (`current`) so stalls on large files are understandable. Byte-weighted progress is optional/out of scope. |
| D9 | Terminal UX | **No header back button.** When polling detects a terminal state, an **auto modal popup** appears: completed → summary + next-step guidance; failed → error + reason; cancelled → warning + partial summary. Each has a **"Go to settings"** button that immediately navigates back. |
| D10 | F2 persist | After a blob `apply` completes: **DB-sourced** storage keys → persist to the DB via `Settings.set` (secrets AES-encrypted with `encrypt_secret_key`, then `invalidateCache`), returning `configPersist { persisted, skippedEnvSourced }` on the job. **Env-sourced** keys → fall back to the existing manual `.env` guidance (no env↔DB sync tool). |
| D11 | Final DB cutover | T0 keys (`WEA_STORAGE_BACKEND`, `WEA_PG_*`) are env-owned by design → the final step remains **manual env edit + restart**. The UI guides it (".env setup needed") and the server shows a persistent banner while data lives in the non-active backend. |
| D12 | Boot verification | Add an **S3 boot probe** symmetric to the WebDAV one (warn-only) so a post-restart cutover to either storage backend is verified and reflected in the health tracker/card. |
| D13 | ".env setup needed" | New `metadataPresence` detection: when the non-active backend holds metadata (settings/users), expose it via an admin endpoint and render a banner in System Settings with a link to the migration flow. |
| D14 | F1 tool form | **Admin API + dialogs** (no standalone CLI). `migrateBlobs.js` CLI stays but is not the primary path. |

## 4. Architecture / key components

### Server
- `server/infrastructure/migrationGate.js` (new): in-memory `{ active, type: 'metadata'|'blobs', jobId, startedAt }`; `set/clear/reset/getStatus`. Set on migration start, cleared on terminal, reset at boot.
- Gating middleware (`server/index.js`): allow-list exception, `503 migrationInProgress` everywhere else including WebDAV protocol routes.
- `server/domains/admin/services/metadataMigrationService.js` (new): direct target connection (`pg.Client` / `sqlite3.Database`, `probePostgresql` pattern); target scan (`schemaExists`, per-table row counts); schema apply to explicit target (D6 refactor); wipe + copy (FK order: users → file_nodes → object_map/filecache/node_ancestors → permissions_* → share_links/recent_files/permission_requests → locks → settings) with settings JSON-string serialization, explicit ids + `setval`/`sqlite_sequence` resync; single target transaction; cancel = rollback.
- Migration router extensions (`server/domains/admin/routes/migration.js`): new `GET /api/migration/status` (public), `POST /api/admin/migration/metadata` `{ targetBackend, pg | sqlitePath, wipeTarget }`, `GET /api/admin/migration/target-scan`; extended job payload (`type`, `stage: 'scan'|'schema'|'wipe'|'copy'|'done'`, `progress: { percent, currentLabel, counters? }`).
- Blob worker: cancel check inside the `runCopy` loop (finish current node, stop, keep resume).
- F2 persist: `persistStorageConfigToDb(destConfig)` (D10) wired into `runMigrationWorker.then()` when `mode==='apply'`; result stored on the job as `configPersist`.
- `server/infrastructure/metadataPresence.js` (new, D13) + admin endpoint; S3 boot probe (D12).
- `server/infrastructure/configResolver.js` / `settingsStore.js` / `backendProbe.js` reused as-is.

### Client
- Route `/migration` at App.js top level (same level as `/login`, `/setup`); `MigrationPage`.
- App guard: poll `GET /api/migration/status`; while active, force-redirect every route to `/migration`.
- `MigrationPage` layout:
  - Header: title + migration type badge + elapsed time (no back button).
  - Direction/status card: `sqlite → postgresql`, status badge (Running/Completed/Failed/Cancelled), started/elapsed.
  - Progress card: overall determinate `%` bar, current-operation label, counters (blob: copied/failed/skipped).
  - State alerts: failed → error + reason; cancelled → warning + partial summary.
  - Terminal modal popup (D9): summary + guidance + **"Go to settings"** (navigates back immediately).
  - Empty state when no active job: "No active migration" + back.
- Config dialogs (System Settings): blob `MigrationDialog` kept (apply now routes to `/migration`); new metadata-migration dialog (target connection fields → target-scan → wipe alert → confirm → start).
- System Settings: metadata-migration entry + ".env setup needed" banner (D13) + blob entry unchanged.
- i18n: en/ko keys for page, states, popups, guidance.

## 5. Progress model

- Job payload (extended): `{ id, type, direction, status, stage, progress: { percent, currentLabel, counters? }, results?, startedAt, completedAt?, error?, configPersist? }`.
- Blob `%`: `progress / total` (snapshot node count), updated per node; `current` = current file label.
- Metadata `%`: per-source-table `COUNT(*)` pre-aggregation, `Σ done / Σ total`; `currentLabel` = current table + rows (e.g. "Copying users … 3,420/5,100").
- Polling: reuse the 400ms job-poll pattern; stop on terminal; client computes elapsed timer locally.
- Edge cases: refresh during migration restores the current job via polling; app guard blocks other pages; DB wipe alert lives in the config dialog (pre-start), `/migration` only shows the "Wiping target DB …" stage.

## 6. Implementation tasks (dependency graph)

```
M1  docs-first (features/specs/SETUP/ARCHITECTURE updates)          ─┐
M2  migrationGate + gating middleware + GET /api/migration/status  ─┼─ parallelizable after M1
M3  metadataMigrationService (scan/schema/wipe/copy/rollback)       ─┤
M4  migration router extensions + extended job payload              ─┤
M5  blob worker cancel check + resume                               ─┤
M6  F2 persistStorageConfigToDb + worker wiring + job.configPersist ─┤
M7  S3 boot probe + metadataPresence + ".env setup needed" endpoint ─┘
M8  /migration route + app guard (poll + force redirect)
M9  MigrationPage (layout, progress, alerts, terminal modal popup)
M10 metadata-migration config dialog (target-scan + wipe alert) + blob dialog reroute
M11 SystemSettings entries + ".env setup needed" banner + i18n
M12 tests (unit, test:ci:pg sqlite↔PG roundtrip, E2E) + regression + merge to dev
```

- Single branch `feature/migration-mode` (base `dev`): M2–M7 share the gate, so one cohesive branch.
- E2E: setup-wizard untouched; migration spec updated (docker-gated where S3/PG needed).

## 7. Success criteria

- Gate active → every route except the allow-list returns `503 migrationInProgress` (WebDAV included); all screens forced to `/migration`; external clients blocked.
- DB migration: target scan → wipe alert → explicit confirm → transactional copy. Cancel → full rollback on both sides. Completion → env-cutover guidance → restart → data live; ".env setup needed" banner persists while data sits in the non-active backend.
- Blob migration: apply starts in the dialog and auto-redirects to `/migration`; cancellable mid-copy (resume on rerun); DB-sourced storage config auto-persisted (+restart guidance), env-sourced falls back to manual `.env` guidance; restart → S3/WebDAV boot probe verifies the new backend on the health card.
- Terminal always surfaces an auto modal with summary + "Go to settings".
- No schema change beyond existing DDL; `client`/`server` `test:ci` + E2E stay green.

## 8. Progress log

- 2026-09-01: Full redesign designed and agreed. Scope: unified migration mode (metadata DB + blob cutover). Decisions D1–D14 recorded above. `/migration` page = execution/progress only (config stays in dialogs); node-count blob progress; terminal auto-popup with "Go to settings"; server-side gating; cancellable migrations (DB=transaction rollback, blob=loop check+resume); DB target scan→wipe-alert→confirm; F2 auto-persist (DB-sourced) with manual fallback; ".env setup needed" banner; S3 boot probe. This PLAN replaced the previous (completed Phase A/B) PLAN.
- 2026-09-01 (branch `test/migration-e2e`): new `e2e/migration.spec.ts` suite (E2E-MIG-001..007, desktop+mobile, hermetic :5003 scratch servers) added and green. Applied the authorized presence-cache clear (`clearPresenceCache()` in both worker `.finally` blocks) so the ".env setup needed" banner is not served a stale pre-migration snapshot (verified by E2E-MIG-005/B8). Surfaced two Case A defects (logged in `docs/fail_log.md`): (A1) metadata cancel is defeated because `runMetadataMigrationWorker`'s onProgress resets the job status to `running`, overwriting the cancel flag — FIXED (onProgress now preserves a `'cancelled'` status), E2E-MIG-007's `test.fail()` placeholder removed and asserting real cancel→rollback; route-level regression unit test added; (A2) webdav-mode uploads never reach `sync_status='active'` (and create no `object_map` row), so a webdav→s3 migration snapshots nothing — verdict: pre-existing webdav design + genuine migration-feature gap, recommended `enumerateSnapshot` source-mode fix documented but NOT applied (decision deferred); the spec seeds the migration's documented snapshot precondition instead.
