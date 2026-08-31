# PLAN — Backend Health Alerts & Config Guard (k3s-safe)

Status: PLANNED — policy finalized, to be expanded during implementation.
Branch: `feature/backend-health` (base: `dev`) — to be created.

## 1. Objective

Give the operator visibility into service-critical configuration health (metadata DB /
S3 / WebDAV) and prevent saving broken connection settings from the admin UI. Concretely:

- **Guard**: changing a file-storage connection key in the admin UI is blocked until a
  connection test with the pending (changed) values passes.
- **Detect**: any backend access failure (from any user attempt) is recorded in an in-memory
  health tracker; success self-recovers the backend.
- **Surface**: admins get a status card/banner, the terminal logs state transitions, and
  normal users get a friendly message for connection-class failures only.
- **k3s-safe boot**: the metadata DB connection is owned by `.env`/injected env; a declared
  `postgresql` backend with incomplete `WEA_PG_*` exits with a terminal error instead of
  falling back to a sqlite setup wizard.

## 2. Context / current state (verified)

- After `setup_complete=true` there is **no operator-visible surface** for missing/broken
  critical backends (console + per-user 500 toast only). Connectivity/auth verification exists
  **only** in the first-run wizard (`POST /api/setup/test`, gated 403 after complete).
- PG: boot failure is fatal (`process.exit(1)`) but unclassified; runtime PG errors are mostly
  unmapped → 500 `databaseQueryFailed`. No liveness check.
- S3: no boot/runtime probe; raw AWS errors → 500 `internalServerError`. WebDAV: boot probe
  (warn-only), runtime `webdav.*` codes. `/api/health` is static.
- Production is k3s: chart injects env → `.env` dynamically generated, multi-container, no
  local storage → sqlite is not viable; the DB connection must come from `.env`/env and fail
  fast when absent/incomplete.

## 3. Confirmed decisions

| # | Area | Decision |
|---|------|----------|
| D1 | UI save gating | Editing a **connection key** (below) in Advanced settings blocks Save until a connection test **with the pending values** passes (complete block). Changing a connection key invalidates the result. Non-connection keys don't require a test. |
| D2 | Detection | **Passive, event-based**: any PG/S3/WebDAV access attempt that fails records to an in-memory tracker (classified); any success marks the backend OK (self-recovery). No active polling. Admin login + file-manager load naturally exercise all three backends. |
| D3 | Surfaces | **Admin**: System Settings top status card + file-screen admin-only banner (OK/FAIL + classification + last-checked + hint). **Terminal**: transition-only logs (`[backend-health] … OK→FAIL / FAIL→OK`). **Normal user**: friendly message **only for connection-class failures** (unreachable / auth / resource-missing); existing 404/403/etc. keep current messages; no user banner; DB-down → maintenance notice. |
| D4 | State | Server **in-memory only** (resets on restart). |
| D5 | T0 in editor | **Remove the T0/metadata group entirely** from Advanced settings; the editor shows editable T1/T2 keys only. PG connection stays `.env`-owned (`연결 확인` verification is provided by the health card, not an in-editor PG section). |
| D6 | Boot rule | `WEA_STORAGE_BACKEND` unset → **sqlite** (kept). Explicit `sqlite` → allowed. `postgresql` → `WEA_PG_HOST/PORT/DATABASE/USER/PASSWORD` required; incomplete → **terminal error + `process.exit(1)`** (remove the setup-mode fallback for the DB connection). |
| D7 | Wizard scope | Wizard serves **non-T0 only**: reachable when the DB is connected but non-T0 config is incomplete. `no .env → sqlite wizard` first-boot path is removed (DB connection is `.env`/env-owned). Wizard E2E scratch `.env` updated to declare the backend explicitly. |
| D8 | User message scope | Connection-class failures only → friendly text; no backend internals exposed. |

**Connection keys** (D1): S3 → `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`. WebDAV → `WEBDAV_URL`, `WEBDAV_USERNAME`,
`WEBDAV_PASSWORD`, `WEBDAV_AUTH_TYPE`.

## 4. Architecture / key components

### Server
- `server/infrastructure/backendHealth.js` (new): in-memory tracker
  - per-backend (`postgresql` | `s3` | `webdav`) state: `{ status: 'ok'|'fail', code?, reason?, hint?, lastCheckedAt, firstFailedAt, consecutiveFailures }`
  - `report(backend, { ok, code, reason })` — updates state; fires a **transition callback** (for terminal logging) only on OK→FAIL / FAIL→OK
  - `getHealth()` — snapshot for endpoints/UI
  - `reset()` (boot) + test hook
- **Classification reuse**: `classifyPgError` / `classifyS3Error` (server/domains/setup/routes.js) and `webdav.*` codes → normalize to a stable `code` (`unreachable` | `auth` | `missing_resource` | …) + a human `hint`.
- **Failure integration points** (report on failure / success):
  - PG: `mapDatabaseError` / pool `error` handler (storage.js), query failures
  - S3: blob store operation errors (S3BlobStore) + success paths
  - WebDAV: `utils/webdav.js` error mapping + `webdavTest.testConnection` (boot probe)
- **Endpoints**:
  - `GET /api/admin/health` (authenticateToken + isAdmin) → tracker snapshot
  - `GET /api/health` (public) → extend with `{ backends: { … } }` (no secrets) — used by the user-friendly-message routing and admin banner
  - `POST /api/admin/config/test` (new, admin) — connection test **with pending values** (body = connection keys), reuses the wizard probe/classification. Serves the D1 UI gating.
- **Boot rule change** (D6): `runBoot` resolves the metadata backend first; `postgresql` with missing `WEA_PG_*` → `console.error('[config] …')` + `process.exit(1)`. `setupStatus`/wizard flow kept for the DB-connected-incomplete case (D7).

### Client
- `SystemConfigEditor.js`:
  - remove the `metadata` (T0) group from `CONFIG_DISPLAY_META` / rendering (D5)
  - per-group **connection-test gating** (D1): when a connection key in the S3/WebDAV group is dirty → show a "Test connection" control that POSTs the pending values to `/api/admin/config/test`; Save stays disabled until that group's test passes; editing a connection key after a pass invalidates it
- Admin health card (`SystemSettingsContent` top) + file-screen admin-only banner (D3): read `GET /api/admin/health` (admin) / `GET /api/health` (banner), render per-backend status + hint + last-checked.
- User friendly message (D8): file-domain error handling maps connection-class failures to a single friendly i18n message (e.g. `files.storageUnavailable`); connection errors no longer leak AWS/webdav internals to users.

## 5. Task dependency graph

```
T1 docs (SoT + this PLAN)
  ├─ T2 backendHealth tracker + classification + endpoints   (server)
  ├─ T3 boot rule change + wizard scope (server)             [depends: T1]
  ├─ T4 admin config/test endpoint + config PUT guard (server) [depends: T2]
  ├─ T5 config editor: T0 removal + gating (client)          [depends: T4]
  ├─ T6 health card/banner + user friendly message (client)  [depends: T2]
  └─ T7 tests + E2E updates (server+client)                  [depends: T2-T6]
      └─ T8 regression (test:ci server+client, e2e) + merge to dev
```

- T2 is the hub; T3/T4 are independent server tasks; T5/T6 are independent client tasks
  (parallelizable after T2).
- E2E updates include: setup-wizard scratch `.env` declares the backend (D7); admin-config
  spec extended for T0 removal, connection-gating, and the health card.

## 6. Success criteria

1. k3s boot with `postgresql` + incomplete `WEA_PG_*` → clear terminal error + `exit(1)`; no
   sqlite wizard fallback for the DB connection.
2. Admin editing an S3/WebDAV connection key cannot Save until a test with the pending values
   passes; non-connection keys save without a test.
3. A backend access failure from any user attempt records to the in-memory tracker; admin sees
   the status card/banner; terminal logs only transitions; the user sees the friendly message
   for connection-class failures (and current messages otherwise).
4. T0 keys are absent from the Advanced settings editor.
5. No schema change; server + client `test:ci` and the E2E suites stay green (with intended
   test updates).

## 7. To confirm during implementation

- Exact `/api/admin/config/test` request/response shape (pending-values subset + classification).
- Whether `GET /api/health` (public) should expose backend OK/FAIL (no codes/hints) for the
  user-friendly routing, vs an admin-only endpoint.
- File-screen admin banner placement and whether it appears on all authed pages vs file screen only.

## 8. Future scope (not in this phase) — user-requested + codebase findings

### F1. Metadata DB migration (sqlite ↔ PG) + ".env setup needed" notification
Currently **completely unsupported**: `server/scripts/migrateMetadataToPostgresql.js` was removed
(docs/ARCHITECTURE.md:172), `server/scripts/migrate/` is empty, and docs/SETUP.md:117-119 only
supports fresh-DB boot. An operator moving sqlite→PG (or reverse) must manually export/transform/load
all tables (users, settings, file_nodes, object_map, filecache, permissions, shares, locks) with no
tool/checklist/UI. Under D6/D7 (PG connection is `.env`-owned) the wizard is no longer a PG on-ramp,
so this needs: a supported migration path **and** a UX that notifies the operator when ".env setup is
needed" (e.g. after migration, point WEA_PG_* at the target and restart).

### F2. Blob migration (s3 ↔ webdav) — integrate the DB connection-info change
Today after a blob migration the operator is told to **manually edit `WEA_FILE_STORAGE` + the target
storage block in `.env` and restart** (MigrationDialog popup, en.json:526) — the destination
credentials entered in the dialog are discarded, the guidance contradicts the DB-backed (T1) config
model (configRegistry.js:41-50), and there is **no post-restart verification** of the cutover. Future
feature: on migration completion, update the DB settings (WEA_FILE_STORAGE + the target's connection
keys from the migration input), then verify the new backend (reuse the health tracker) before/after
the switch.

### F3. Silent no-op fixes (config edits that never take effect)
- **T1 require-time-const keys**: `LOGIN_RATE_LIMIT_*` (auth/service.js:12-13), `MAX_THUMBNAIL_SIZE` /
  `FFMPEG_INIT_TIMEOUT_MS` (videoProcessor.js:11-12), `THUMBNAIL_TOKEN_*` (thumbnailService.js:7-8),
  `PERMISSION_CACHE_TTL_MS` (permissionStore.js:17), `PERMISSIONS_EXISTENCE_*`
  (permissionExistenceIndex.js:12-16), `USER_CACHE_TTL_MS` (aclService.js:17),
  `WEA_PREVIEW_TICKET_TTL_MS` (operationProgress.js:7) are frozen at module require (index.js:85-116)
  before `populateT1Env` — DB edits show "restart required" but **still have no effect after restart**.
  Fix: move the reads behind the resolver/boot snapshot or reclassify.
- **EMAIL_* "applied" but restart-only**: EMAIL_* are T2 → no restart banner, but the transporter is a
  process singleton (email.js:13-17, 30-62) — editing shows "Configuration saved" with no effect until
  restart. Fix: rebuild the transporter on change or reclassify to T1.

### F4. Server-side env-shadowing guard + drift detection
The UI blocks editing env-sourced keys, but `PUT /api/admin/config` does **not** refuse DB writes to a
key whose current source is `env` (config.js:40-69; spec config.md:111) — an API/script write is
silently stored forever. Future: server rejects/ warns on env-shadowed writes + env-vs-DB drift
detection (D9 from config-source-resolution).

### F5. Config editor pre-save feedback
- Per-field tier / "restart required" badge before saving (currently only a post-save banner).
- Surface the PUT `applied` (T2 live-apply) list client-side (currently ignored, SystemConfigEditor.js:211-216).

### F6. Missing operator warnings
- `key_lost_warning` is computed (setup/routes.js:866, 980) but never rendered in the admin UI —
  warn the operator when `encrypt_secret_key` is lost.
- Stale terminal guidance: WebDAV boot probe message references ".env file" (index.js:210) while
  WEBDAV_* can be DB-sourced; `getBackend()` silently falls back to sqlite on an invalid
  `WEA_STORAGE_BACKEND` (storage.js:10-16).

### F7. Wizard apply feedback
Apply returns only `{ restart_required: true }`; no breakdown of what was written to `.env` (T0) vs
DB (non-T0), no key list, no indication of which values already took effect (T2). Optional step (step 3)
has no "skip" affordance.

## 9. Progress log

- 2026-08-31: Policy finalized with the user — D1 UI save gating (complete block, pending-values
  test), D2 passive event-based detection (admin login/file load auto-cover), D3 surfaces
  (admin card+banner / terminal transitions / user friendly message for connection-class only),
  D4 in-memory state, D5 T0 removed from Advanced settings, D6 boot rule (sqlite default kept;
  postgresql incomplete → exit), D7 wizard non-T0 only, D8 user-message scope. k3s context:
  chart injects env → dynamic `.env`; DB connection `.env`-owned. This PLAN created.
- 2026-08-31: Future scope added (§8) — F1 metadata DB migration (sqlite↔PG) + ".env setup needed"
  notification (unsupported today); F2 blob-migration cutover integrates the DB connection-info
  change + post-cutover verification; F3 silent-no-op fixes (require-time-const T1 keys, EMAIL
  "applied"-but-restart-only); F4 server-side env-shadow guard + drift detection; F5 pre-save
  tier/restart feedback + `applied` surface; F6 missing warnings (key_lost_warning, stale terminal
  guidance, silent sqlite fallback); F7 wizard apply feedback. Source: codebase exploration.
