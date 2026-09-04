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

1. **T0 (startup) — `.env` only:** the boot-required set is just enough to connect to the
   metadata DB (the remote-DB block `WEA_DB_HOST` / `WEA_DB_DATABASE` / `WEA_DB_USER` /
   `WEA_DB_PASSWORD` plus optional pool/SSL keys — selecting the PostgreSQL backend
   when any is set — or `WEA_SQLITE_PATH` for the default SQLite backend, `NODE_ENV`,
   `DOTENV_CONFIG_PATH`). `JWT_SECRET` is also `.env`-owned T0 but **optional**: when unset or
   empty the server generates an ephemeral random secret at boot for that process (a restart
   yields a new secret and invalidates all sessions); multi-instance deployments must set one
   unified value.
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

**T0 — `.env` only** (D2, D4, D7): `WEA_SQLITE_PATH`, `WEA_DB_HOST`, `WEA_DB_PORT`,
`WEA_DB_DATABASE`, `WEA_DB_USER`, `WEA_DB_PASSWORD`, `WEA_DB_SSL`, `WEA_DB_MAX`,
`WEA_DB_IDLE_TIMEOUT_MS`, `WEA_DB_CONNECTION_TIMEOUT_MS`, `PGSSLMODE`, `NODE_ENV`,
`DOTENV_CONFIG_PATH`, `JWT_SECRET`.
Rationale: the metadata DB cannot be reached before its own connection info exists.
`JWT_SECRET` is the boot auth key (D4): it stays `.env`-only and frozen at require time, but it
is **optional** — when unset or empty the server generates an ephemeral random secret at boot
for that process (a restart yields a new secret and invalidates all sessions). Multi-instance
deployments must set one unified `JWT_SECRET` so every instance signs with the same secret.

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
  `POST /api/setup/prefill`) and the setup/admin UIs render a **set** secret as `'****'` and never
  return the stored value to the client. An **unset** secret has no effective value (`undefined`,
  omitted from JSON) — it is never fabricated into `'****'`, so presence/completeness checks
  (metadata-backend and file-backend selection, `setup_complete`) never mistake it for a
  configured secret.
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

- **`.env` gets only `JWT_SECRET`, and only when the operator supplies one.** An omitted `jwt`
  payload block leaves `.env` untouched and the boot-time ephemeral random secret applies. The
  apply payload never produces metadata entries (`buildEnvEntries` emits no `WEA_DB_*` /
  `WEA_SQLITE_PATH` keys), and `partitionEntries` (`setupCore.js`) additionally drops the
  `WEA_DB_*` / `WEA_SQLITE_PATH` set — the DB connection is `.env`-owned, so apply never writes
  it. No other key (in particular no master/encryption key) is generated or written to `.env`.
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

1. Load `.env` → T0 (metadata connection + `NODE_ENV`; plus `JWT_SECRET`, which is optional —
   an ephemeral random fallback is generated at boot when it is unset).
2. Connect to the metadata DB using T0 only (D10: failure = boot failure). For sqlite this is
   the local store; for the remote backend the `WEA_DB_*` connection.
3. Compute the **effective config** = env-first over the plaintext DB `settings` rows and
   derive `setup_complete` from it.
   - `setup_complete=false` → run in **setup mode** (wizard serves; reads/applies against the
     target DB directly).
   - `setup_complete=true` → load the T1 snapshot and boot normally.
4. Mount app; T1 consumers read from the snapshot; T2 consumers use the lazy resolver
   (env → DB → default, TTL + invalidate-on-write).

### Setup-vs-boot decision (`setup_complete`)

`setup_complete` = the metadata connection resolvable from `.env` **AND** the required
non-T0 blocks satisfiable from the **effective config** (env-first over DB rows). `JWT_SECRET`
is not part of this decision. Presence checks run against the merged effective view in which an
unset secret resolves to `undefined` — it never contributes a fabricated `'****'`, so e.g. an
unset `WEA_DB_PASSWORD` cannot make the metadata backend look like PostgreSQL.
Consequently, when `.env` has the PG connection info, boot still branches on what the DB holds:

1. **DB lacks required non-T0 config** → `setup_complete=false` → wizard shown; it reads and
   applies against the target DB directly.
2. **DB already has all required config** → `setup_complete=true` → no wizard; boot normally.

---

## Admin "Advanced settings" UI (Q3)

**Placement: no sidebar category.** The config editor lives inside the existing System Settings
page as an "Advanced settings" accordion (`MUI Accordion`) within
`SystemSettingsContent.js`.

| Item         | Location                                                                                        |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Component    | `client/src/components/mypage/content/SystemConfigEditor.js` — inside the accordion          |
| Registry     | none — no new mypage category (`myPageRegistry.js` unchanged)                                   |
| Service      | `client/src/services/adminService.js`: `getConfig()` / `updateConfig(values)`                   |
| Server route | `server/domains/admin/routes/config.js` (new): `GET /config` + `PUT /config` under `/api/admin` |
| MSW          | `client/src/mocks/handlers.js`: `GET/PUT /api/admin/config` + reset state                       |
| i18n         | en/ko `admin.advancedSettings` (accordion title) + `admin.config.*` (section titles, section note, subgroups, generic strings) |

**GET `/api/admin/config`** →
`{ config: { "<envKey>": { value, source: 'env'|'db'|'default', tier, secret } } }` for every
registry key. Set secrets are masked `"****"` (never returned to the client); **unset** secrets
carry no `value` (the field is omitted) so an operator/API consumer can tell a secret is not
configured. Display metadata
(`labelKey`, `group`, `inputType`, `options`) lives client-side in a `CONFIG_DISPLAY_META`
map; the server registry is authoritative for tier/secret/source.

**UI structure:**

- The "Advanced settings" accordion sits below the main settings rows; config is fetched
  lazily on first expand.
- **Two top-level sections (config UI section split, 2026-09):**
  - **Section A — "Runtime settings" (editable).** The four existing subgroups (File storage,
    Server & security, Email, Runtime) render only keys whose effective state is editable:
    registry tier T1/T2 AND `source !== 'env'` (db/default). All type-aware inputs, the
    masked-secret "set new value" flow, the per-field tier badges and the connection-test
    gating live here, unchanged.
  - **Section B — "Deploy-time / platform configuration" (read-only).** Rendered below
    Section A as a flat read-only list in registry order (the order keys arrive in the GET
    payload). A key is platform-managed — listed here, never editable — when `tier === 'T0'`
    **or** `source === 'env'`. Section B therefore shows **all T0 keys** (the metadata DB/boot
    set — `WEA_SQLITE_PATH`, the `WEA_DB_*` remote-DB block incl. `WEA_DB_PASSWORD`, `NODE_ENV`,
    `DOTENV_CONFIG_PATH`, `JWT_SECRET` — previously hidden from the editor) **plus any T1/T2 key
    whose effective `source === 'env'`**. Each row shows the translated label, the value
    (masked `'****'` for secrets; "(unset)"-style text when undefined) and a caption with the
    tier + a "set in env" note. An intro note explains that these values are provided at deploy
    time (env / `.env`), cannot be edited here, and require a deployment change + restart.
  - This **supersedes the earlier "Metadata (T0) group removed (D5)" behavior**: T0 keys are no
    longer hidden — they are shown read-only — and the per-row env/T0 "locked field" styling
    inside the editable list is gone: an env-sourced or T0 key is never rendered as a disabled
    editable field, it is relocated to Section B. The metadata DB connection / boot secrets stay
    non-editable (health-card verification for the DB is unchanged).
  - **Classification is state-driven** from the GET payload (`source` / `tier`); there is no
    static key list and **no server change** — `PUT` still rejects (400) T0 keys
    (`configT0Protected`) and keys whose current source is `env` (`configEnvSourcedProtected`),
    so Section A membership cannot be bypassed via the API (F4).
- **Connection-key save gating (D1):** editing an S3/WebDAV connection key (see
  `docs/features/backend-health.md`) blocks Save until `POST /api/admin/config/test` with the
  pending values passes; changing a connection key invalidates the result; non-connection keys
  save without a test. Connection keys are editable only when db/default-sourced (Section A);
  an env-sourced connection key appears read-only in Section B (D9 rationale unchanged: a DB
  edit would be silently shadowed while the env var is present).
- **Secrets:** Section A secrets are always masked as `'****'`; a "set new value" toggle
  reveals the field; submitting `'****'` or blank on save = keep the existing stored value
  (keep-existing); a new value is written to the DB as plaintext. Section B secrets are masked
  `'****'` and never editable (no toggle).
- **Save:** dirty-tracked "Save changes" → `PUT { values: { KEY: value } }` (changed **Section A**
  keys only; Section B is never submitted) → server validates allowlist/types (T0 keys rejected),
  upserts `settingsStore`
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
- Secrets are never returned in plaintext over the API (`"****"`); in Section A the only write
  path for a secret is the set-new-value toggle, and Section B secrets are read-only masked rows.
- T0 keys (`WEA_DB_*`, `WEA_SQLITE_PATH`, `JWT_SECRET`, …) are rejected by `PUT` — they
  can only live in `.env` (D2/D4/D7).
- `source=env` keys are read-only in the UI (Section B summary, never an editable field), and
  `PUT` rejects (400) an env-sourced write server-side — a DB copy would be silently shadowed by
  the env value (D1/F4).
- Without encryption there is no master-key lifecycle: no key to keep, lose, or rotate, and no
  key-loss warning on any surface.

---

## Testing anchors

Representative observable behaviors to cover:

- With only T0 in `.env` and config rows in DB: app boots, behavior identical to the
  env-configured equivalent; `.env` values win when present.
- T2 changes via admin UI take effect immediately; T1 changes require restart and are flagged
  as such.
- The admin editor shows two sections: Section A lists only editable T1/T2 keys
  (`source` db/default) in the existing subgroups; Section B lists every T0 key plus env-sourced
  T1/T2 keys read-only in registry order (secrets masked `'****'`, undefined values shown as
  "(unset)") with a tier + "set in env" caption. `PUT` still rejects T0 and env-sourced writes.
- Secret rows round-trip as plaintext: a value written via the admin UI or wizard apply is
  stored verbatim and read back verbatim on the server; env-sourced secrets are never read from
  DB.
- Wizard apply writes `JWT_SECRET` to `.env` only when the operator supplies one (an empty `jwt`
  block writes nothing and the boot-time ephemeral secret applies); the rest (secrets included)
  goes to the DB as plaintext; existing full-`.env` installs keep working unchanged (`.env` wins).
- Masked `'****'`/blank secret submissions keep the previously stored value on every write
  path; a new value overwrites it.
- `GET /api/setup/status`, `GET /api/admin/config`, and `POST /api/setup/prefill` never return
  a secret in plaintext and carry no key-loss field.
- No schema change; existing unit + e2e suites stay green.
