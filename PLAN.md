# PLAN — Config Source Resolution (`.env`-first + DB fallback)

Branch: `feature/config-source-resolution` (base: `dev`) — to be created.
Status: PLANNED — discussion summary. This document will be expanded before implementation.

## 1. Objective

Move the app's configuration surface from "everything in `.env`" to a two-layer source
model: the **minimum startup-critical config lives in `.env`** (T0), and **everything else
can be stored in the database** (`settings` table) with `.env` taking precedence when a
value is present there. This enables operator-facing config management (admin UI, hot
reload for safe keys) while keeping the boot path decoupled from anything that requires a
DB connection before it exists.

## 2. Confirmed Decisions (from discussion)

| #   | Decision                | Choice                                                                                                       |
| --- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| D1  | Source precedence       | `.env` (when set) → DB `settings` (when set) → built-in default                                              |
| D2  | `.env` contents         | **T0 only** — startup-critical DB connection info (+ `NODE_ENV`, `DOTENV_CONFIG_PATH`, `encrypt_secret_key`) |
| D3  | Wizard apply target     | Defaults to **DB storage**; only T0 keys are written to `.env`                                               |
| D4  | `JWT_SECRET`            | `.env`-only (never DB; rotation invalidates sessions + boot auth key)                                        |
| D5  | `JWT_EXPIRES_IN`        | **Not** `.env`-only — env → DB fallback (read lazily at sign time → hot)                                     |
| D6  | Secret encryption in DB | AES-256-GCM; master key env `encrypt_secret_key` (T0, `.env`-only)                                           |
| D7  | PG password             | `.env`-only (T0); **not encrypted / not in DB**                                                              |
| D8  | DB-eligible secrets     | `EMAIL_PASSWORD`, `WEBDAV_PASSWORD`, `AWS_SECRET_ACCESS_KEY` (encrypted)                                     |
| D9  | env vs DB inconsistency | `.env` wins at boot; **admin-login alert + sync feature = future scope**                                     |
| D10 | DB down                 | No fallback — boot fails (service is unusable anyway)                                                        |
| D11 | DB storage              | Reuse `settings(key PK, value JSONB, updated_at)`; **no schema change**; row key = raw env var name          |

## 3. Tier Model

| Tier                   | Semantics                                                                  | Source             | Change to take effect |
| ---------------------- | -------------------------------------------------------------------------- | ------------------ | --------------------- |
| **T0 — Startup**       | Required to connect to the metadata DB                                     | `.env` only        | restart               |
| **T1 — Boot (frozen)** | Read once at boot into a snapshot; consumers behave as require-time consts | env → DB → default | restart               |
| **T2 — Runtime (hot)** | Read lazily per request/operation (small TTL cache, invalidated on write)  | env → DB → default | immediate             |

Precedence invariant (D1): a value present in `.env` always wins; the DB copy is read only
when the env var is absent. For encrypted secrets, an env value means "do not even decrypt".

## 4. Variable Classification

### T0 — `.env` only (D2, D4, D7)

`WEA_STORAGE_BACKEND`, `WEA_SQLITE_PATH`, `WEA_PG_HOST` / `WEA_PG_PORT` / `WEA_PG_DATABASE` /
`WEA_PG_USER` / `WEA_PG_PASSWORD` / `WEA_PG_SSL` / `WEA_PG_MAX` / `WEA_PG_IDLE_TIMEOUT_MS` /
`WEA_PG_CONNECTION_TIMEOUT_MS`, `PGSSLMODE`, `NODE_ENV`, `DOTENV_CONFIG_PATH`,
`encrypt_secret_key`, `JWT_SECRET` (D4).
Rationale: chicken-and-egg — the metadata DB cannot be reached before its own connection
info exists; `JWT_SECRET` is the boot auth key (D4); `encrypt_secret_key` is needed to read
DB secrets before any request.

### T1 — env → DB fallback, restart required (boot-frozen)

`PORT`, `WEA_FILE_STORAGE`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`,
`AWS_SECRET_ACCESS_KEY` (secret, D8), `S3_ENDPOINT`, `WEBDAV_URL`, `WEBDAV_USERNAME`,
`WEBDAV_PASSWORD` (secret, D8), `WEBDAV_AUTH_TYPE`, rate-limit config
(`LOGIN_*_MAX`/`*_WINDOW_MS`), `MAX_THUMBNAIL_SIZE`, `THUMBNAIL_CONCURRENCY_LIMIT`,
`FFMPEG_PATH`, `GC_INTERVAL_MS`, `ADMIN_DEFAULT_PASSWORD`.
Rationale: consumed to construct boot-time singletons (blob store, listen port, scheduler,
module consts). The **source** can be DB; the **effect** requires a restart.

### T2 — env → DB fallback, immediate (hot)

`registration_enabled` (already DB), `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`,
`EMAIL_PASSWORD` (secret, D8), `EMAIL_SECURE`, `EMAIL_FROM_NAME`, `CORS_ORIGINS`,
`GC_ORPHAN_TTL_DAYS`, `WEBDAV_UPSTREAM_URL`, `JWT_EXPIRES_IN` (D5).
Rationale: read per-request/per-operation today (or trivially made so); changing them has no
boot-time singleton impact.

## 5. DB Storage Design (D11)

Reuse the existing `settings` table (already present in both backends):

```sql
CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,          -- sqlite conversion: TEXT
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **No new table, no DDL change, no migration file.**
- Row key = the raw env var name (e.g. `EMAIL_HOST`, `CORS_ORIGINS`). No collision with
  runtime flags (`registration_enabled`).
- Value shapes:
  - plaintext config → JSON string, e.g. `"smtp.gmail.com"`
  - encrypted secret (D6/D8) → object `{ "enc": "aes-256-gcm", "iv": "<b64>", "tag": "<b64>", "data": "<b64>" }`
- Tier / source / restart-required are derived at runtime from the registry, never stored.
- `updated_at` is already available for the future env-vs-DB sync/alert feature (D9).

## 6. Secret Encryption (D6–D8)

- Algorithm: **AES-256-GCM** via Node `crypto` (no new dependency), random 96-bit IV,
  128-bit auth tag.
- Master key: env `encrypt_secret_key` (T0). Value = free-length passphrase or 32-byte hex;
  derived to a 32-byte key with `crypto.createHash('sha256')`.
- Encrypt at write time (wizard apply / admin config write); decrypt at read time only when
  the env var is absent (D1).
- Rotation: changing `encrypt_secret_key` requires re-encrypting all DB secrets (future
  tooling; documented).
- Exposure model: a DB backup leak exposes ciphertext only; plaintext requires both DB and
  `.env` (same class as `JWT_SECRET`).

## 7. Wizard Apply Changes (D3)

Current: apply writes every collected value to `.env` via `envFileWriter`.
New principle: **apply stores operator-entered values in the DB by default; only T0 keys
are written to `.env`.**

- T0 written to `.env`: metadata connection (`WEA_STORAGE_BACKEND`, `WEA_PG_*` /
  `WEA_SQLITE_PATH`) + generated `encrypt_secret_key` + (non-production) `JWT_SECRET`.
- All non-T0 blocks (file storage, email, server/CORS, JWT_EXPIRES_IN) upserted into the
  metadata DB `settings` table; secrets encrypted with `encrypt_secret_key`.
- Admin password effect: unchanged semantics (sqlite direct update / PG via
  `ADMIN_DEFAULT_PASSWORD` — T1).
- **PG case (resolved, Q1a)**: apply connects to the target PG with the entered credentials
  and ensures the `settings` table exists by executing the same idempotent
  `CREATE TABLE IF NOT EXISTS settings (...)` DDL that mirrors `001_initial_normalized_schema.sql`
  (comment must state "keep in sync with 001"). The full app schema (`users`, `_schema_migrations`,
  …) is still created by normal boot migrations on restart — no conflict (IF NOT EXISTS +
  file-based tracking).
- **Setup-phase reads are always direct (resolved, Q1b)**: during setup the wizard
  **always reads/prefills from the target metadata DB via a direct connection** (whether or not
  the `.env` already has the PG connection info). `settingsStore` (the app's own store) is used
  only **after** setup completes — runtime T2 reads and the admin config page (Q3). No
  "app's-current-metadata vs target" distinction in the setup phase.
- **Setup-vs-boot decision (resolved, Q1b)**: `setup_complete` = T0 resolvable (metadata
  connection from `.env`) **AND** the required non-T0 blocks are satisfiable from the
  **effective config** (env-first over DB rows). Consequently, when the `.env` has the PG
  connection info, boot still branches on what the DB holds:
  1. **DB lacks required non-T0 config** → `setup_complete=false` → wizard shown; it reads and
     applies against the target DB directly.
  2. **DB already has all required config** → `setup_complete=true` → no wizard; boot normally.
  - **Encryption-key lifecycle rules (critical, D6/Q1b — independent of the read path)**: DB
    secrets are encrypted with `encrypt_secret_key` (T0, in `.env`), so the key's location and
    lifecycle govern decryptability regardless of which DB path reads the row:
    1. **keep-existing**: if `.env` already has a key, apply/prefill must **keep it** (never
       regenerate, D1). Only auto-generate when no key exists.
    2. **key-lost warning**: if no key exists in `.env` but encrypted DB secret rows are
       detected (via the wizard's direct read), surface an explicit "key lost" warning — such
       rows cannot be decrypted/prefilled.
    3. **only re-encrypt on new value**: a masked (unchanged) secret keeps its existing
       ciphertext; a new value is the only trigger to encrypt with the current key. This
       prevents unrecoverable data loss when the key is missing or on rotation.

## 8. Boot Order

1. Load `.env` → T0 (metadata connection + `NODE_ENV` + `encrypt_secret_key` + `JWT_SECRET`).
2. Connect to the metadata DB using T0 only (D10: failure = boot failure). For sqlite this is the
   local store; for postgresql the `WEA_PG_*` connection.
3. Compute the **effective config** = env-first over DB `settings` rows (decrypt DB secrets when
   env absent) and derive `setup_complete` from it.
   - `setup_complete=false` → run in **setup mode** (wizard serves; reads/applies against the
     target DB directly, §7).
   - `setup_complete=true` → load the T1 snapshot and boot normally.
4. Mount app; T1 consumers read from the snapshot; T2 consumers use the lazy resolver
   (env → DB → default, TTL + invalidate-on-write).

## 9. Admin Config UI (Q3) — design

**Placement (user-confirmed): no sidebar category.** The config editor lives inside the existing
System Settings page as an **"Advanced settings" accordion** (`MUI Accordion`) within
`SystemSettingsContent.js`. (A full-screen modal is the fallback if the editor proves too long.)

| Item         | Location                                                                                                                                                |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Component    | `client/src/components/mypage/content/SystemConfigEditor.js` (new) — rendered inside an "Advanced settings" Accordion in `SystemSettingsContent.js`     |
| Registry     | **none** — no new mypage category (no `myPageRegistry.js` change)                                                                                       |
| Service      | `client/src/services/adminService.js`: `getConfig()` / `updateConfig(values)` (mirror `getSettings`/`updateSettings`)                                   |
| Server route | `server/domains/admin/routes/config.js` (new): `GET /config` + `PUT /config`, mounted under `/api/admin` (setupModeGuard + authenticateToken + isAdmin) |
| MSW          | `client/src/mocks/handlers.js`: `GET/PUT /api/admin/config` + reset state                                                                               |
| i18n         | en/ko `admin.advancedSettings` (accordion title) + `admin.config.*` (groups, generic strings)                                                           |
| Docs         | `docs/spec/server/routes/config.md` + client component spec + `docs/api.md` admin table                                                                 |

**GET `/api/admin/config`** → `{ config: { "<envKey>": { value, source: 'env'|'db'|'default', tier, secret } } }` for every registry key; secrets always `"****"` (never decrypted to the client). Display metadata (`labelKey`, `group`, `inputType`, `options`) lives client-side in a `CONFIG_DISPLAY_META` map; the server registry is authoritative for tier/secret/source.

**UI structure**:

- The "Advanced settings" accordion sits below the main settings rows in `SystemSettingsContent`
  (title i18n `admin.advancedSettings`); config is fetched lazily on first expand.
- Grouped sections (Metadata T0 — read-only, File storage, Server & security, Email, Runtime); type-aware inputs (TextField / Switch / Select / Number).
- **source=env rows are read-only** with a "Set in `.env` (env takes precedence)" note (D9) — DB edits would be silently ignored while the env var is present.
- **Secrets**: always masked; a "set new value" toggle reveals the field; blank on save = keep existing ciphertext (only-re-encrypt-on-new-value).
- **Save**: dirty-tracked "Save changes" → `PUT { values: { KEY: value } }` (changed keys only) → server validates allowlist/types (T0 keys rejected), encrypts secrets, upserts `settingsStore`, invalidates T2 cache → responds `{ applied: [T2 keys], restartRequired: [T1 keys], messageCode }`.
- **Feedback**: Snackbar + "restart required" Alert banner listing the T1 keys changed (applied immediately for T2).
- `registration_enabled` stays in the main settings rows (above the accordion); no duplication.
- Editor feedback reuses the page-level Snackbar; the "restart required" Alert banner renders inside
  the expanded accordion.

## 10. Future Scope (not in this phase)

- Admin-login alert when env and DB values diverge, plus a sync/apply-from-env feature (D9).
- `encrypt_secret_key` rotation tooling.
- `WEA_SETUP_TOKEN`-style hardening.

## 11. Resolved Questions (user-confirmed)

1. **Wizard apply for PostgreSQL** — apply connects to the target PG with the entered creds,
   ensures `settings` exists (idempotent DDL mirroring 001, see §7), upserts config rows; sqlite
   uses the local store. Full schema via normal boot migrations (Q1a confirmed — no conflict).
2. **T2 cache** — in-memory per-key cache; **invalidate on write** (admin/wizard) + small TTL
   (≈5s) as a backstop for direct-DB edits. Single-instance assumption.
3. **Admin config API/UI** — **full implementation** (not split): `GET /api/admin/config`
   (effective, masked secrets, source/tier/restart-required) + `PUT` (allowlisted → DB → T2
   invalidate → restart-required list) + mypage-admin editing UI. Secret rule: always `****`,
   only "set new value" allowed, blank = keep existing.
4. **`encrypt_secret_key`** — wizard **auto-generates** when absent; **keeps existing** when
   `.env` already has it (Q1b key consistency). Loss ⇒ DB secrets unrecoverable (documented).
5. **Row-key naming** — **raw env var names** (D11), resolver is a 1:1 map; registry supplies the
   UI's key list (no prefix needed).
6. **`JWT_EXPIRES_IN`** — **T2 lazy**: read via `getConfig('JWT_EXPIRES_IN')` at token-sign time
   (async), not a require-time const → no boot-snapshot ordering constraint. Applies to other T1
   consumers as well: DB-sourced values are either lazy-read (→ T2) or boot-snapshot-sourced
   with index.js ordering.

## 12. Success Criteria (tentative)

1. With only T0 in `.env` and config rows in DB: app boots, behavior identical to the
   env-configured equivalent; `.env` values win when present.
2. T2 changes via admin UI take effect immediately; T1 changes require restart and are
   flagged as such.
3. DB secrets are stored encrypted; env-sourced secrets are never decrypted from DB.
4. Wizard apply writes T0 to `.env` and the rest to DB; existing full-`.env` installs keep
   working unchanged (`.env` wins).
5. No schema change; existing unit + e2e suites stay green.

## 13. Draft Task Sketch (to be expanded)

- T1 — Docs: this PLAN + `docs/features/config-source-resolution.md` (SoT) + spec updates.
- T2 — `configRegistry` (tier/secret/default table) + `configResolver` (env→DB→default,
  T2 lazy cache, invalidation) + encryption util (AES-256-GCM).
- T3 — Boot snapshot loader + read-site migration for T1/T2 (replace module-const
  `process.env` reads where categorized).
- T4 — Admin config API (GET effective masked / PUT allowlisted→DB) + UI.
- T5 — Wizard apply → DB storage + T0-only `.env` write (incl. `encrypt_secret_key`).
- T6 — `setupStatus`/guard to use the effective (env+DB) view.
- T7 — Tests (precedence, encryption round-trip, hot reload, boot snapshot) + regression.
- T8 — Merge to `dev`.

## 14. Progress Log

- 2026-08-28: Discussion summary captured (D1–D11, tier model, classification, DB/encryption
  design, wizard apply principle). Previous completed setup-wizard PLAN was deleted on `dev`
  (`595707e`). This plan is a fresh start and will be expanded.
- 2026-08-28: §11 resolved (user-confirmed): Q1 PG apply (idempotent settings DDL, direct
  connection; prefill scenarios + encrypt_secret_key keep-existing) — recorded in §7; Q2
  invalidate-on-write + TTL; Q3 full admin config API + UI; Q4 auto-generate key; Q5 raw env
  names; Q6 JWT_EXPIRES_IN as T2 lazy sign-time read.
- 2026-08-28: Q1b corrected (user feedback): setup-phase reads are **always direct** (no
  app-metadata-vs-target distinction; settingsStore is admin/runtime-only, post-setup); boot
  branches on DB contents — DB lacks config → wizard, DB has all → boot normally. Recorded in
  §7/§8.
- 2026-08-28: Encryption-key lifecycle rules made explicit in §7 (keep-existing / key-lost
  warning / only-re-encrypt-on-new-value) — independent of the read-path model.
- 2026-08-28: Admin Config UI design added (§9): SystemConfigContent + admin-config registry
  category + adminService.getConfig/updateConfig + server config.js route; GET returns masked
  value/source/tier, source=env rows read-only, secrets masked with set-new-value, dirty-tracked
  save with applied/restartRequired feedback; sections renumbered (was §9-13).
- 2026-08-28: §9 placement changed (user feedback): **no sidebar category** — the editor is an
  "Advanced settings" accordion inside SystemSettingsContent (`SystemConfigEditor.js`), config
  loaded lazily on expand; no myPageRegistry change; i18n `admin.advancedSettings`.
- 2026-08-28: **T5 implemented** — wizard apply writes T0 keys to `.env`, non-T0 keys (secrets
  AES-256-GCM encrypted) to the metadata DB `settings` (sqlite via `Settings.set`; PG via direct
  connection + idempotent settings DDL mirrored from 001 + upsert); `encrypt_secret_key`
  keep-existing/auto-generate; `GET /api/setup/status` prefills from the effective (env+DB) view
  with `key_lost_warning`; `requireSetupIncomplete` gates on the effective view. Docs: setup spec
  + SETUP.md updated. (T5)
- 2026-08-28: **T4 UI (client, TASK B) implemented** — `SystemConfigEditor` Advanced settings
  accordion in `SystemSettingsContent` (§9): `adminService.getConfig/updateConfig`, `CONFIG_DISPLAY_META`
  grouping (metadata T0 read-only / fileStorage / serverSecurity / email / runtime), env-read-only +
  T0-read-only rows, masked secrets with set-new-value toggle, dirty-tracked save (changed keys only),
  applied/restartRequired feedback (Snackbar + banner). MSW GET/PUT `/api/admin/config` + reset.
  Docs: `docs/spec/client/components/SystemConfigEditor.md` + SystemSettingsContent spec. (T4-UI)
- 2026-08-28: **COMPLETED** — full regression green (server `test:ci` 80 suites / 1490 tests; client
  `test:ci` 152 suites / 1336 tests). Bonus fix: sqlite transaction serialization (`storage.js`,
  nested BEGIN race surfaced by the integration suite). Merged to `dev` (`a506179`, `--no-ff`),
  feature branch deleted. No schema change; existing suites green. (T7-T8)
- 2026-08-28: **Wizard prefill fix (Q1b enforcement)** — `GET /api/setup/status` prefill reads the
  app's own (default sqlite) store, so it never saw the PG entered in step 1. Added
  `POST /api/setup/prefill` (guarded by `requireSetupIncomplete`): direct `SELECT key, value FROM
  settings` against the entered PG, `current` built with secrets masked (`****`), `key_lost_warning`
  on encrypted rows without `encrypt_secret_key`, missing-table (`42P01`) → empty rows. Client
  `handleNext` on the metadata step (postgresql) merges the prefill best-effort and still advances
  on failure. Docs updated (setup + Setup specs, config-source-resolution §7). Branch
  `fix/setup-prefill-from-target-db` (base `dev`).
- 2026-08-28: **Apply masked-secret fix (user-reported 400)** — when the target DB already has an
  encrypted secret, prefill masks it (`'****'`), the client previously stripped it via `stripMasked`,
  and apply validation then failed `file.secretAccessKey: required` (HTTP 400). Fix: the client now
  sends `'****'` as a keep-existing marker (file/email blocks; the T0 metadata password is still
  re-entered), and the server drops masked secret entries before `writeSettings` (only-re-encrypt-on-
  new-value, PLAN §7). Also fixed: `envFileWriter` allowlist lacked `encrypt_secret_key`, failing a
  fresh-install apply. Branch `fix/wizard-apply-encrypt-key-allowlist` + `fix/masked-secret-apply`.
- 2026-08-28: **Masked PG password fallback (user-reported 400/500 chain)** — once `.env` holds the
  PG password, status masks it; the client previously stripped it (`metadata.password: required`,
  HTTP 400) and the direct PG write connected with `'****'` (auth failure, HTTP 500). Fix: the client
  sends `'****'` as the keep-existing marker for ALL masked secrets (incl. the T0 metadata password),
  and the server's direct PG connections (test / prefill / apply write) fall back to
  `process.env.WEA_PG_PASSWORD` for a masked value; masked `'****'` entries are dropped before the
  `.env`/DB write so existing values/ciphertext are preserved. Branch
  `fix/setup-masked-pg-password`.
