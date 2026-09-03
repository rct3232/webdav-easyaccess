# Config Source Resolution (`.env`-first + DB fallback)

This document is the **Source-of-Truth** for the config-source-resolution feature. It describes
the two-layer configuration model, the source precedence rules, the tier (T0/T1/T2) semantics,
the DB storage design (plaintext secrets with presentation-level masking), the wizard apply
changes, the boot order, the setup-completeness rules against the effective config, and the
admin "Advanced settings" UI.

Detailed implementation contracts live in:

- `docs/spec/server/routes/config.md` — `GET /api/admin/config`, `PUT /api/admin/config`.
- `docs/spec/client/components/SystemConfigEditor.md` — the Advanced settings accordion editor.
- `docs/spec/server/infrastructure/configRegistry.md` — tier/secret/default catalog.
- `docs/spec/server/infrastructure/configResolver.md` — effective-config resolver + T2 cache.
- `docs/spec/server/routes/setup.md` (updated) — wizard apply now targets DB storage for non-T0.
- `docs/features/config-sync.md` + `docs/spec/server/tools/config-sync.md` — env↔DB
  sync CLI/web action (`configSync`): drift detection and `--apply`/web reconcile over
  plaintext DB rows.
- `docs/SETUP.md` — operator environment-variable reference (updated classification).

---

## Overview

Today the app reads configuration from `process.env` at require time
(`server/index.js:10-18`) plus the metadata DB `settings` table, and the first-run wizard
persists values across both layers. This feature describes the two-layer model in detail:

1. **T0 (startup) — `.env` only:** just enough to connect to the metadata DB
   (`WEA_STORAGE_BACKEND`, `WEA_PG_*` / `WEA_SQLITE_PATH`, `NODE_ENV`,
   `DOTENV_CONFIG_PATH`) and `JWT_SECRET`.
2. **Everything else — DB `settings` table with `.env` fallback:** a value present in `.env`
   always wins (D1); otherwise the DB row is used; otherwise the built-in default.

This enables operator-facing config management (admin "Advanced settings" UI, hot reload for
runtime-safe keys) while keeping the boot path decoupled from anything that requires a DB
connection before the metadata DB exists.

---

## Source precedence (D1)

```
.env (when set) → DB settings row (when set) → built-in default
```

- A value present in `.env` **always wins**; the DB copy is read only when the env var is
  absent.
- The DB copy can therefore become stale relative to `.env`; the configSync CLI/web action
  (`server/domains/admin/services/configSyncService.js` shared core) detects and reports
  env-vs-DB drift and can reconcile the DB rows to mirror `.env` (`--apply --yes` / the admin
  "Sync environment → DB" action) — `docs/features/config-sync.md` /
  `docs/spec/server/tools/config-sync.md`.

---

## Tier model

| Tier   | Semantics                                                                  | Source             | Change to take effect |
| ------ | -------------------------------------------------------------------------- | ------------------ | --------------------- |
| **T0** | Required to connect to the metadata DB                                     | `.env` only        | restart               |
| **T1** | Read once at boot into a snapshot; consumers behave as require-time consts | env → DB → default | restart               |
| **T2** | Read lazily per request/operation (small TTL cache, invalidated on write)  | env → DB → default | immediate             |

### Variable classification

**T0 — `.env` only** (D2, D4, D7): `WEA_STORAGE_BACKEND`, `WEA_SQLITE_PATH`, `WEA_PG_HOST`,
`WEA_PG_PORT`, `WEA_PG_DATABASE`, `WEA_PG_USER`, `WEA_PG_PASSWORD`, `WEA_PG_SSL`, `WEA_PG_MAX`,
`WEA_PG_IDLE_TIMEOUT_MS`, `WEA_PG_CONNECTION_TIMEOUT_MS`, `PGSSLMODE`, `NODE_ENV`,
`DOTENV_CONFIG_PATH`, `JWT_SECRET`.
Rationale: the metadata DB cannot be reached before its own connection info exists;
`JWT_SECRET` is the boot auth key (D4) and, like the metadata connection, is startup-critical
and `.env`-only.

**T1 — env → DB fallback, restart required (boot-frozen):** `PORT`, `WEA_FILE_STORAGE`,
`S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (secret, D8),
`S3_ENDPOINT`, `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` (secret, D8),
`WEBDAV_AUTH_TYPE`, `THUMBNAIL_CONCURRENCY_LIMIT`, `FFMPEG_PATH`, `GC_INTERVAL_MS`,
`ADMIN_DEFAULT_PASSWORD`, `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD` (secret,
D8), `EMAIL_SECURE`, `EMAIL_FROM_NAME`.
Rationale: consumed to construct boot-time singletons (blob store, listen port, scheduler,
module consts, the nodemailer transporter). The **source** can be DB; the **effect** requires a
restart. EMAIL\_\* were formerly T2, but the transporter is built once per process — edits only
take effect after a restart, so they are honestly classified T1 (F3).

**T2 — env → DB fallback, immediate (hot):** `registration_enabled` (already DB),
`CORS_ORIGINS`, `GC_ORPHAN_TTL_DAYS`, `WEBDAV_UPSTREAM_URL`, `JWT_EXPIRES_IN` (D5),
`LOGIN_RATE_LIMIT_MAX`, `LOGIN_RATE_LIMIT_WINDOW_MS`, `MAX_THUMBNAIL_SIZE`,
`THUMBNAIL_TOKEN_SECRET` (secret, D8), `THUMBNAIL_TOKEN_EXPIRY`, `FFMPEG_INIT_TIMEOUT_MS`,
`WEA_PREVIEW_TICKET_TTL_MS`, `PERMISSION_CACHE_TTL_MS`, `USER_CACHE_TTL_MS`,
`PERMISSIONS_EXISTENCE_INDEX_TTL_MS`, `PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE`,
`PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY`.
Rationale: read per-request/per-operation via the lazy resolver (F3 fix — these keys were
mislabeled T1 but never boot-frozen in practice); changing them has no boot-time singleton
impact.

---

## DB storage design (D11)

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
- **Value shape — every row stores a plain string** (JSON-stringified by the store on
  PostgreSQL, raw TEXT on sqlite), secret values included. There is no field-level
  encryption: no ciphertext payload shape `{ enc, iv, tag, data }` is ever written.
- Tier / source / restart-required are derived at runtime from the registry, never stored.
- `updated_at` is consumed by the configSync drift report
  (`docs/features/config-sync.md`), which surfaces it per DB-backed finding as
  `db_updated_at` (ISO 8601).

---

## Secret storage and masking

The registry's `secret: true` flag does **not** imply encryption at rest. DB-stored secret
values (e.g. `EMAIL_PASSWORD`, `WEBDAV_PASSWORD`, `AWS_SECRET_ACCESS_KEY`) are persisted as
**plaintext strings** exactly like any other config value. The flag drives **presentation-level
masking only**:

- Effective-config surfaces (`GET /api/admin/config`, `GET /api/setup/status`,
  `POST /api/setup/prefill`) and the setup/admin UIs render a set secret as `'****'` and never
  return the stored value to the client.
- **keep-existing on masked write:** a secret submitted as `'****'` (or blank/absent) leaves
  the previously stored value untouched; only an explicit new value overwrites the DB row
  (written as plaintext). This applies on the admin config `PUT`, wizard/CLI `apply`, and the
  config-sync reconcile.
- **Write paths:** admin `PUT /api/admin/config`, `setupCore.writeSettings` (wizard/CLI
  `apply`), and the configSync reconcile all store secret values via
  `Settings.set(key, String(value))` — the same plaintext path used for non-secret keys.

---

## Wizard apply changes (D3)

Apply (`POST /api/setup/apply`, shared by the wizard and the CLI via
`server/domains/setup/setupCore.js` `applySetup`) stores operator-entered values in the
metadata DB by default; only T0 keys are written to `.env`.

- **`.env` gets only `JWT_SECRET`.** The apply payload never produces metadata entries
  (`buildEnvEntries` emits no `WEA_STORAGE_BACKEND` / `WEA_PG_*` / `WEA_SQLITE_PATH` keys),
  and `partitionEntries` (`setupCore.js`) additionally drops the `WEA_STORAGE_BACKEND` /
  `WEA_PG_*` set — the DB connection is `.env`-owned, so apply never writes it. No other
  key (in particular no master/encryption key) is generated or written to `.env`.
- **Metadata backend `postgresql` is rejected with 400 `metadata.backend: notAllowed`**
  (`validateMetadata` via `validateApplyPayload`, `setupCore.js`) — PostgreSQL metadata is
  not configurable through the wizard/CLI apply.
- **All non-T0 values** (file storage, email, server/CORS, `JWT_EXPIRES_IN`) are upserted
  into the metadata DB `settings` table via the **booted app's own `Settings` store**
  (`writeSettings`, `setupCore.js`); secret values are written as **plaintext**. A masked
  (`'****'`) secret input is dropped before the write so the previously stored value is kept
  (keep-existing).
- **Admin password:** apply calls `User.updatePassword` directly on the booted app's `admin`
  user (`updateAdminPassword`, `setupCore.js`) — there is no `ADMIN_DEFAULT_PASSWORD` path.
- **Setup-phase prefill is a direct read (wizard-only, Q1b):** during setup the wizard
  prefill (`POST /api/setup/prefill`) reads the target metadata DB `settings` rows via a
  **direct connection** using the credentials entered in wizard step 1 and returns
  `{ current }` (secret rows masked as `'****'`, never plaintext). It does not use the
  app's own store; runtime T2 reads and the admin config page use `Settings`/the resolver.
  Best-effort — a prefill failure does not block advancing. Full contract:
  `docs/spec/server/routes/setup.md` (§"POST /api/setup/prefill").

---

## Boot order

1. Load `.env` → T0 (metadata connection + `NODE_ENV` + `JWT_SECRET`).
2. Connect to the metadata DB using T0 only (D10: failure = boot failure). For sqlite this is
   the local store; for postgresql the `WEA_PG_*` connection.
3. Compute the **effective config** = env-first over the plaintext DB `settings` rows and
   derive `setup_complete` from it.
   - `setup_complete=false` → run in **setup mode** (wizard serves; reads/applies against the
     target DB directly).
   - `setup_complete=true` → load the T1 snapshot and boot normally.
4. Mount app; T1 consumers read from the snapshot; T2 consumers use the lazy resolver
   (env → DB → default, TTL + invalidate-on-write).

### Setup-vs-boot decision (`setup_complete`)

`setup_complete` = T0 resolvable (metadata connection from `.env`) **AND** the required
non-T0 blocks are satisfiable from the **effective config** (env-first over DB rows).
Consequently, when `.env` has the PG connection info, boot still branches on what the DB holds:

1. **DB lacks required non-T0 config** → `setup_complete=false` → wizard shown; it reads and
   applies against the target DB directly.
2. **DB already has all required config** → `setup_complete=true` → no wizard; boot normally.

---

## Admin "Advanced settings" UI (Q3)

**Placement: no sidebar category.** The config editor lives inside the existing System Settings
page as an "Advanced settings" accordion (`MUI Accordion`) within
`SystemSettingsContent.js`. (A full-screen modal is the fallback if the editor proves too long.)

| Item         | Location                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Component    | `client/src/components/mypage/content/SystemConfigEditor.js` (new) — inside the accordion       |
| Registry     | none — no new mypage category (`myPageRegistry.js` unchanged)                                   |
| Service      | `client/src/services/adminService.js`: `getConfig()` / `updateConfig(values)`                   |
| Server route | `server/domains/admin/routes/config.js` (new): `GET /config` + `PUT /config` under `/api/admin` |
| MSW          | `client/src/mocks/handlers.js`: `GET/PUT /api/admin/config` + reset state                       |
| i18n         | en/ko `admin.advancedSettings` (accordion title) + `admin.config.*` (groups, generic strings)   |

**GET `/api/admin/config`** →
`{ config: { "<envKey>": { value, source: 'env'|'db'|'default', tier, secret } } }` for every
registry key; secrets always `"****"` (never returned to the client). Display metadata
(`labelKey`, `group`, `inputType`, `options`) lives client-side in a `CONFIG_DISPLAY_META`
map; the server registry is authoritative for tier/secret/source.

**UI structure:**

- The "Advanced settings" accordion sits below the main settings rows; config is fetched
  lazily on first expand.
- Grouped sections (File storage, Server & security, Email, Runtime). **The Metadata (T0)
  group is removed from the editor entirely (D5)** — the DB connection is `.env`-owned and the
  backend is verified via the health card, not an in-editor metadata section.
- **Connection-key save gating (D1):** editing an S3/WebDAV connection key (see
  `docs/features/backend-health.md`) blocks Save until `POST /api/admin/config/test` with the
  pending values passes; changing a connection key invalidates the result; non-connection keys
  save without a test.
- Type-aware inputs (TextField / Switch / Select / Number); **source=env rows are read-only**
  with a "Set in `.env` (env takes precedence)" note (D9) — DB edits would be silently ignored
  while the env var is present. The server **enforces** this
  too: `PUT` rejects (400) a write to a key whose current source is `env`, so the UI rule
  cannot be bypassed via the API (F4).
- **Secrets:** always masked as `'****'`; a "set new value" toggle reveals the field;
  submitting `'****'` or blank on save = keep the existing stored value (keep-existing); a new
  value is written to the DB as plaintext.
- **Save:** dirty-tracked "Save changes" → `PUT { values: { KEY: value } }` (changed keys
  only) → server validates allowlist/types (T0 keys rejected), upserts `settingsStore`
  (plaintext), invalidates T2 cache → responds
  `{ applied: [T2 keys], restartRequired: [T1 keys], messageCode }`.
- **Feedback:** Snackbar + "restart required" Alert banner listing the T1 keys changed
  (applied immediately for T2). Each editable field shows a **tier badge** ("restart required"
  for T1 / "applies immediately" for T2) while editing, and after a save the T2 `applied` list
  is surfaced in its own banner — the operator sees exactly what took effect now vs what awaits
  a restart (F5). Editor feedback reuses the page-level Snackbar. There is no key-loss banner:
  with no encryption there is no master key to lose.
- `registration_enabled` stays in the main settings rows (above the accordion); no
  duplication.

---

## API surface summary

| Endpoint                | Guard                       | Behavior                                                    |
| ----------------------- | --------------------------- | ----------------------------------------------------------- |
| `GET /api/admin/config` | authenticateToken + isAdmin | effective config, masked secrets, source/tier               |
| `PUT /api/admin/config` | authenticateToken + isAdmin | allowlisted keys → DB (plaintext), invalidate T2 cache      |

The setup-mode guard (503 `setup.incomplete`) continues to block admin-write routes while
`setup_complete=false`, so the admin config surface is reachable only when setup is complete.

---

## Security

- Secret values are stored in the DB `settings` table as **plaintext strings**; masking is
  presentation-level only. A DB backup leak therefore exposes stored secret values in
  plaintext — treat DB backups with the same care as the `.env` file (a plaintext-backup leak
  replaces the former "ciphertext only" property). Residual: ciphertext rows written by older
  versions are not auto-migrated; the operator may need to clean them up manually if any exist.
- Secrets are never returned in plaintext over the API (`"****"`); a new value is the only
  write path for a secret (set-new-value toggle).
- T0 keys (`WEA_PG_*`, `JWT_SECRET`, …) are rejected by `PUT` — they
  can only live in `.env` (D2/D4/D7).
- `source=env` rows are read-only in the UI, and `PUT` rejects (400) an env-sourced write
  server-side — a DB copy would be silently shadowed by the env value (D1/F4).
- Without encryption there is no master-key lifecycle: no key to keep, lose, or rotate, and no
  key-loss warning on any surface.

---

## Testing anchors

Representative observable behaviors to cover:

- With only T0 in `.env` and config rows in DB: app boots, behavior identical to the
  env-configured equivalent; `.env` values win when present.
- T2 changes via admin UI take effect immediately; T1 changes require restart and are flagged
  as such.
- Secret rows round-trip as plaintext: a value written via the admin UI or wizard apply is
  stored verbatim and read back verbatim on the server; env-sourced secrets are never read from
  DB.
- Wizard apply writes `JWT_SECRET` to `.env` and the rest (secrets included) to the DB as
  plaintext; existing full-`.env` installs keep working unchanged (`.env` wins).
- Masked `'****'`/blank secret submissions keep the previously stored value on every write
  path; a new value overwrites it.
- `GET /api/setup/status`, `GET /api/admin/config`, and `POST /api/setup/prefill` never return
  a secret in plaintext and carry no key-loss field.
- No schema change; existing unit + e2e suites stay green.
