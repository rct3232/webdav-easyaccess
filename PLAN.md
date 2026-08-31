# PLAN — Config Correctness Fixes & Backend Health (k3s-safe)

Status: PLANNED — priorities finalized, to be expanded during implementation.
Branch: `feature/backend-health` (base: `dev`) — to be created.

## 1. Objective

Two-phase scope:

- **Phase A (priority — live bugs): config-correctness fixes (F3–F6).** Configuration edits that
  silently don't take effect, missing server-side guards, and absent operator warnings — fixed
  first.
- **Phase B: backend health alerts & config guard.** Operator visibility into DB/S3/WebDAV health,
  connection-key save gating, and a k3s-safe boot rule.

Future scope (not in this phase) stays at the end: metadata DB migration and blob-migration
cutover integration (F1/F2).

---

# Phase A — Config-correctness fixes (priority)

## A1. F3 — Silent no-op config edits (bug)

Config saved in the admin editor (or via API) that **never takes effect**, either immediately or
after restart.

### A1.1 Require-time-const T1 keys
`server/index.js:85-116` requires route modules before `runBoot()` runs `populateT1Env`
(`index.js:158-171`). Modules that capture a T1 key into a module-level `const` freeze the
`.env`/default value and can never see the DB copy — yet the editor lists them as editable T1
("restart required") keys. After restart the value still has no effect.

Affected keys (all T1 in `configRegistry.js`):
`LOGIN_RATE_LIMIT_MAX`/`LOGIN_RATE_LIMIT_WINDOW_MS` (auth/service.js:12-13),
`MAX_THUMBNAIL_SIZE`/`FFMPEG_INIT_TIMEOUT_MS` (videoProcessor.js:11-12),
`THUMBNAIL_TOKEN_SECRET`/`THUMBNAIL_TOKEN_EXPIRY` (thumbnailService.js:7-8),
`PERMISSION_CACHE_TTL_MS` (permissionStore.js:17),
`PERMISSIONS_EXISTENCE_*` (permissionExistenceIndex.js:12-16),
`USER_CACHE_TTL_MS` (aclService.js:17), `WEA_PREVIEW_TICKET_TTL_MS` (operationProgress.js:7).

Fix direction (per key, with evidence):
- Move the read to the boot snapshot / lazy resolver (like `PORT` at index.js:219), OR
- Reclassify to a tier whose semantics match the actual read path, OR
- Make the value lazily read (T2) where the consumer is per-operation.

### A1.2 EMAIL_* "applied" but restart-only
`EMAIL_*` are T2 (configRegistry.js:72-76) → the PUT returns them under `applied` and the editor
shows no restart banner. But the nodemailer transporter is a process singleton built once
(email.js:13-17, 30-62) — edits show "Configuration saved" with no effect until restart.

Fix direction: **reclassify EMAIL_* to T1** (restart-required, honest banner) OR rebuild the
transporter on config change.

## A2. F4 — Server-side env-shadow guard (bug)

The UI blocks editing `source=env` rows, but `PUT /api/admin/config` (config.js:40-69) does **not**
refuse a DB write to an env-sourced key — an API/script write is silently stored and forever
shadowed by `.env`. Add server-side enforcement:

- Reject (400) a write whose key's current source is `env` (config.js), matching the UI's
  read-only rule; keep the UI behavior identical.
- (Optional in this phase) env-vs-DB drift detection for the health surface.

## A3. F5 — Config editor pre-save feedback (UX gap)

- Per-field **tier / "restart required" badge** while editing (tier is already in the GET payload
  but not rendered; the restart banner only appears after save, SystemConfigEditor.js:400-407).
- Surface the PUT **`applied` (T2, took-effect-now) list** client-side (currently ignored,
  SystemConfigEditor.js:211-216) so the operator sees what applied live vs what awaits restart.

## A4. F6 — Missing operator warnings (bug)

- **A4.1 `key_lost_warning` never rendered**: computed (setup/routes.js:866, 980) but not shown in
  the admin UI — warn the operator when `encrypt_secret_key` is lost (DB secrets undecryptable).
- **A4.2 Stale terminal guidance**: WebDAV boot probe message references ".env file"
  (index.js:210) while WEBDAV_* can be DB-sourced — update to "effective configuration".
- **A4.3 `getBackend()` silent sqlite fallback** (storage.js:10-16): an invalid/typo'd
  `WEA_STORAGE_BACKEND` boots sqlite with only a deprecation warning — make it a terminal error
  (aligns with D6 in Phase B).

---

# Phase B — Backend Health Alerts & Config Guard

## B1. Context / current state (verified)

- After `setup_complete=true` there is **no operator-visible surface** for missing/broken critical
  backends (console + per-user 500 toast only). Connectivity/auth verification exists **only** in
  the first-run wizard (`POST /api/setup/test`, gated 403 after complete).
- PG: boot failure is fatal (`process.exit(1)`) but unclassified; runtime PG errors are mostly
  unmapped → 500 `databaseQueryFailed`. No liveness check.
- S3: no boot/runtime probe; raw AWS errors → 500 `internalServerError`. WebDAV: boot probe
  (warn-only), runtime `webdav.*` codes. `/api/health` is static.
- Production is k3s: chart injects env → `.env` dynamically generated, multi-container, no local
  storage → sqlite is not viable; the DB connection must come from `.env`/env and fail fast when
  absent/incomplete.

## B2. Confirmed decisions

| # | Area | Decision |
|---|------|----------|
| D1 | UI save gating | Editing a **connection key** (below) in Advanced settings blocks Save until a connection test **with the pending values** passes (complete block). Changing a connection key invalidates the result. Non-connection keys don't require a test. |
| D2 | Detection | **Passive, event-based**: any PG/S3/WebDAV access attempt that fails records to an in-memory tracker (classified); any success marks the backend OK (self-recovery). No active polling. Admin login + file-manager load naturally exercise all three backends. |
| D3 | Surfaces | **Admin**: System Settings top status card + file-screen admin-only banner (OK/FAIL + classification + last-checked + hint). **Terminal**: transition-only logs (`[backend-health] … OK→FAIL / FAIL→OK`). **Normal user**: friendly message **only for connection-class failures** (unreachable / auth / resource-missing); existing 404/403/etc. keep current messages; no user banner; DB-down → maintenance notice. |
| D4 | State | Server **in-memory only** (resets on restart). |
| D5 | T0 in editor | **Remove the T0/metadata group entirely** from Advanced settings; the editor shows editable T1/T2 keys only. PG connection stays `.env`-owned (connection verification is provided by the health card, not an in-editor PG section). |
| D6 | Boot rule | `WEA_STORAGE_BACKEND` unset → **sqlite** (kept). Explicit `sqlite` → allowed. `postgresql` → `WEA_PG_HOST/PORT/DATABASE/USER/PASSWORD` required; incomplete → **terminal error + `process.exit(1)`** (remove the setup-mode fallback for the DB connection). |
| D7 | Wizard scope | Wizard serves **non-T0 only**: reachable when the DB is connected but non-T0 config is incomplete. `no .env → sqlite wizard` first-boot path is removed (DB connection is `.env`/env-owned). Wizard E2E scratch `.env` updated to declare the backend explicitly. |
| D8 | User message scope | Connection-class failures only → friendly text; no backend internals exposed. |

**Connection keys** (D1): S3 → `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`. WebDAV → `WEBDAV_URL`, `WEBDAV_USERNAME`,
`WEBDAV_PASSWORD`, `WEBDAV_AUTH_TYPE`.

## B3. Architecture / key components

### Server
- `server/infrastructure/backendHealth.js` (new): in-memory tracker
  - per-backend (`postgresql` | `s3` | `webdav`) state: `{ status: 'ok'|'fail', code?, reason?, hint?, lastCheckedAt, firstFailedAt, consecutiveFailures }`
  - `report(backend, { ok, code, reason })` — updates state; fires a **transition callback** (for terminal logging) only on OK→FAIL / FAIL→OK
  - `getHealth()` — snapshot for endpoints/UI; `reset()` (boot) + test hook
- **Classification reuse**: `classifyPgError` / `classifyS3Error` (server/domains/setup/routes.js) and `webdav.*` codes → normalize to a stable `code` (`unreachable` | `auth` | `missing_resource` | …) + a human `hint`.
- **Failure integration points** (report on failure / success): PG `mapDatabaseError` / pool `error` handler (storage.js); S3 blob store operation errors (S3BlobStore) + successes; WebDAV `utils/webdav.js` mapping + `webdavTest.testConnection` (boot probe).
- **Endpoints**: `GET /api/admin/health` (admin) → tracker snapshot; `GET /api/health` (public) → extend with `{ backends: { … } }` (no secrets); `POST /api/admin/config/test` (new, admin) — connection test **with pending values**, reuses the wizard probe/classification, serves D1.
- **Boot rule change** (D6): `runBoot` resolves the metadata backend first; `postgresql` with missing `WEA_PG_*` → `console.error('[config] …')` + `process.exit(1)`. Wizard flow kept for the DB-connected-incomplete case (D7).

### Client
- `SystemConfigEditor.js`: remove the `metadata` (T0) group (D5); per-group **connection-test gating** (D1) — connection key dirty → "Test connection" control posting the pending values to `/api/admin/config/test`; Save disabled until that group's test passes; editing a connection key invalidates it.
- Admin health card (SystemSettingsContent top) + file-screen admin-only banner (D3): read `GET /api/admin/health` (admin) / `GET /api/health` (banner), render per-backend status + hint + last-checked.
- User friendly message (D8): file-domain error handling maps connection-class failures to one friendly i18n message (e.g. `files.storageUnavailable`); no AWS/webdav internals leaked to users.

---

# Future scope (not in this phase)

## F1. Metadata DB migration (sqlite ↔ PG) + ".env setup needed" notification
Currently **completely unsupported**: `server/scripts/migrateMetadataToPostgresql.js` was removed
(docs/ARCHITECTURE.md:172), `server/scripts/migrate/` is empty, and docs/SETUP.md:117-119 only
supports fresh-DB boot. An operator moving sqlite→PG (or reverse) must manually export/transform/load
all tables (users, settings, file_nodes, object_map, filecache, permissions, shares, locks) with no
tool/checklist/UI. Under D6/D7 (PG connection is `.env`-owned) the wizard is no longer a PG on-ramp,
so this needs: a supported migration path **and** a UX that notifies the operator when ".env setup is
needed" (e.g. after migration, point WEA_PG_* at the target and restart).

## F2. Blob migration (s3 ↔ webdav) — integrate the DB connection-info change
Today after a blob migration the operator is told to **manually edit `WEA_FILE_STORAGE` + the target
storage block in `.env` and restart** (MigrationDialog popup, en.json:526) — the destination
credentials entered in the dialog are discarded, the guidance contradicts the DB-backed (T1) config
model (configRegistry.js:41-50), and there is **no post-restart verification** of the cutover. Future
feature: on migration completion, update the DB settings (WEA_FILE_STORAGE + the target's connection
keys from the migration input), then verify the new backend (reuse the health tracker) before/after
the switch.

---

# Task dependency graph

```
Phase A (priority)
  A1 F3 silent no-ops ──┐
  A2 F4 env-shadow guard ──┼─ T1..T6 (server+client, mostly independent)
  A3 F5 editor pre-save feedback ──┘
  A4 F6 warnings (key_lost / stale messages / sqlite fallback)

Phase B
  B1 backendHealth tracker + classification + endpoints   (server)
  B2 boot rule change + wizard scope                      (server)
  B3 admin config/test endpoint + PUT guard               (server)
  B4 editor: T0 removal + connection gating               (client)
  B5 health card/banner + user friendly message           (client)

  └─ T7 tests + E2E updates (A+B) → T8 regression + merge to dev
```

- Phase A tasks are parallelizable (independent files); Phase B depends on A where they touch the
  same files (config editor, storage).
- E2E updates include: setup-wizard scratch `.env` declares the backend (D7); admin-config spec
  extended for T0 removal, connection-gating, health card, and the A1/A2/A3/A4 behaviors.

# Success criteria

Phase A:
1. Every A1.1 key's saved value actually takes effect (lazy read / snapshot / reclassified) — no
   silent no-op; EMAIL_* shows an honest tier (A1.2).
2. `PUT /api/admin/config` refuses env-sourced writes server-side (A2).
3. Editor shows per-field tier/restart feedback and the `applied` list (A3).
4. `key_lost_warning` visible to the admin; stale ".env file" guidance fixed; invalid
   `WEA_STORAGE_BACKEND` fails loudly instead of sqlite fallback (A4).

Phase B:
5. k3s boot with `postgresql` + incomplete `WEA_PG_*` → clear terminal error + `exit(1)`; no
   sqlite wizard fallback for the DB connection.
6. Admin editing an S3/WebDAV connection key cannot Save until a test with the pending values
   passes; non-connection keys save without a test.
7. A backend access failure from any user attempt records to the in-memory tracker; admin sees
   the status card/banner; terminal logs only transitions; the user sees the friendly message
   for connection-class failures (and current messages otherwise).
8. T0 keys are absent from the Advanced settings editor.
9. No schema change; server + client `test:ci` and the E2E suites stay green (with intended test
   updates).

# To confirm during implementation

- Exact `/api/admin/config/test` request/response shape (pending-values subset + classification).
- Whether `GET /api/health` (public) should expose backend OK/FAIL (no codes/hints) for the
  user-friendly routing, vs an admin-only endpoint.
- File-screen admin banner placement and whether it appears on all authed pages vs file screen only.
- A1.1 per-key fix strategy (lazy-read vs snapshot vs reclassification) — decide per key with
  evidence during implementation.

# Progress log

- 2026-08-31: **Phase B implemented and merged to `dev`** (branch `feature/backend-health`).
  B1: `backendHealth` in-memory tracker (transition-only `[backend-health]` logs) + `backendProbe`
  (classification/probes extracted from the wizard for reuse). Passive hooks: PG
  `mapDatabaseError`/pool-`error`/`withTransaction`, S3/WebDAV blob stores + `webdavTest`
  boot probe + `listDirectory`. Endpoints: `GET /api/health` (backends status strings),
  `GET /api/admin/health`, `POST /api/admin/config/test` (pending-values, merged over effective
  config). B2: D6 boot pre-flight (`postgresql` + missing `WEA_PG_*` → `[config]` error +
  `exit(1)`); D7 wizard non-T0 only (metadata optional/`postgresql` rejected on apply, T0 keys
  dropped from `current`, direct-PG apply writers removed, wizard client metadata step removed).
  B4: editor T0-group removal + connection-key save gating. B5: admin health card + file-screen
  admin banner + user-friendly connection-class messages (`files.storageUnavailable` /
  `files.maintenanceNotice`). Server test:ci 81 suites / 1545; client test:ci 152 suites /
  1365; lint 0 errors; E2E admin-config 12 passed (1 docker-gated skip) + setup-wizard 4 passed.
  Docs updated first (backend-health feature/specs, health routes, config.md, setup.md,
  bootSequence, SystemConfigEditor/SystemSettingsContent/FileManagerView specs, api.md, SETUP.md).
- 2026-08-31: **Phase A (F3–F6) implemented and merged to `dev`** (branch
  `feature/backend-health`, commit `ce65b59`, merge into `dev`). A1.1: the 12
  mislabeled T1 keys reclassified to T2 with lazy `getSharedResolver().getConfig`
  reads (auth rate-limit, thumbnails, permission/user cache TTLs, existence-index,
  preview-ticket); A1.2: EMAIL_* reclassified to T1 (honest restart). A2: PUT
  rejects env-sourced writes (400 `configEnvSourcedProtected`). A3: editor tier
  badges + `applied` banner. A4: `key_lost_warning` on the admin config surface,
  WebDAV probe message now says "effective configuration", invalid
  `WEA_STORAGE_BACKEND` → terminal error + `exit(1)`. Server test:ci 80 suites /
  1515 passed; client test:ci 152 suites / 1350 passed; lint 0 errors; admin-config
  E2E 6 passed. Docs (features + specs) updated first per the docs-first workflow.
- 2026-08-31: Policy finalized with the user — D1 UI save gating (complete block, pending-values
  test), D2 passive event-based detection (admin login/file load auto-cover), D3 surfaces
  (admin card+banner / terminal transitions / user friendly message for connection-class only),
  D4 in-memory state, D5 T0 removed from Advanced settings, D6 boot rule (sqlite default kept;
  postgresql incomplete → exit), D7 wizard non-T0 only, D8 user-message scope. k3s context:
  chart injects env → dynamic `.env`; DB connection `.env`-owned. This PLAN created.
- 2026-08-31: Future scope added — F1 metadata DB migration (sqlite↔PG) + ".env setup needed"
  notification (unsupported today); F2 blob-migration cutover integrates the DB connection-info
  change + post-cutover verification; F3 silent-no-op fixes (require-time-const T1 keys, EMAIL
  "applied"-but-restart-only); F4 server-side env-shadow guard + drift detection; F5 pre-save
  tier/restart feedback + `applied` surface; F6 missing warnings (key_lost_warning, stale terminal
  guidance, silent sqlite fallback). Source: codebase exploration.
- 2026-08-31: Re-prioritized per user feedback — F3–F6 promoted to **Phase A (priority, live bugs)**
  at the top; the health-alert scope became Phase B; F7 (wizard apply feedback / optional-step skip
  affordance) **removed** (wizard input always requires restart, "immediate" notices are useless; the
  optional step already communicates optionality by name); F1/F2 remain future scope.