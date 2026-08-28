# Config Source Resolution (`.env`-first + DB fallback)

This document is the **Source-of-Truth** for the config-source-resolution feature. It describes
the two-layer configuration model, the source precedence rules, the tier (T0/T1/T2) semantics,
the DB storage and secret-encryption design, the wizard apply changes, the boot order, the
setup-completeness rules against the effective config, and the admin "Advanced settings" UI.

Working plan with decisions D1–D11, resolved questions, and progress log:
`PLAN.md` (root, `feature/config-source-resolution`).

Detailed implementation contracts live in:

- `docs/spec/server/routes/config.md` — `GET /api/admin/config`, `PUT /api/admin/config`.
- `docs/spec/client/components/SystemConfigEditor.md` — the Advanced settings accordion editor.
- `docs/spec/server/infrastructure/configRegistry.md` — tier/secret/default catalog.
- `docs/spec/server/infrastructure/configResolver.md` — effective-config resolver + T2 cache.
- `docs/spec/server/utils/configEncryption.md` — AES-256-GCM secret encryption.
- `docs/spec/server/routes/setup.md` (updated) — wizard apply now targets DB storage for non-T0.
- `docs/SETUP.md` — operator environment-variable reference (updated classification).

---

## Overview

Today the app reads **all** configuration from `process.env` at require time
(`server/index.js:10-18`), and the first-run wizard persists everything to `.env`. This feature
moves the configuration surface to a two-layer model:

1. **T0 (startup) — `.env` only:** just enough to connect to the metadata DB
   (`WEA_STORAGE_BACKEND`, `WEA_PG_*` / `WEA_SQLITE_PATH`, `NODE_ENV`,
   `DOTENV_CONFIG_PATH`), the DB-secret master key `encrypt_secret_key`, and `JWT_SECRET`.
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
  absent. For encrypted secrets, an env value means "do not even decrypt".
- The DB copy can therefore become stale relative to `.env`; reconciling them (alert + sync
  feature) is explicitly future scope (D9).

---

## Tier model

| Tier    | Semantics                                              | Source             | Change to take effect |
| ------- | ------------------------------------------------------ | ------------------ | --------------------- |
| **T0**  | Required to connect to the metadata DB                 | `.env` only        | restart               |
| **T1**  | Read once at boot into a snapshot; consumers behave as require-time consts | env → DB → default | restart   |
| **T2**  | Read lazily per request/operation (small TTL cache, invalidated on write) | env → DB → default | immediate |

### Variable classification

**T0 — `.env` only** (D2, D4, D7): `WEA_STORAGE_BACKEND`, `WEA_SQLITE_PATH`, `WEA_PG_HOST`,
`WEA_PG_PORT`, `WEA_PG_DATABASE`, `WEA_PG_USER`, `WEA_PG_PASSWORD`, `WEA_PG_SSL`, `WEA_PG_MAX`,
`WEA_PG_IDLE_TIMEOUT_MS`, `WEA_PG_CONNECTION_TIMEOUT_MS`, `PGSSLMODE`, `NODE_ENV`,
`DOTENV_CONFIG_PATH`, `encrypt_secret_key`, `JWT_SECRET`.
Rationale: the metadata DB cannot be reached before its own connection info exists;
`JWT_SECRET` is the boot auth key (D4); `encrypt_secret_key` is needed to read DB secrets
before any request.

**T1 — env → DB fallback, restart required (boot-frozen):** `PORT`, `WEA_FILE_STORAGE`,
`S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` (secret, D8),
`S3_ENDPOINT`, `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD` (secret, D8),
`WEBDAV_AUTH_TYPE`, rate-limit config (`LOGIN_*_MAX` / `*_WINDOW_MS`), `MAX_THUMBNAIL_SIZE`,
`THUMBNAIL_CONCURRENCY_LIMIT`, `FFMPEG_PATH`, `GC_INTERVAL_MS`, `ADMIN_DEFAULT_PASSWORD`.
Rationale: consumed to construct boot-time singletons (blob store, listen port, scheduler,
module consts). The **source** can be DB; the **effect** requires a restart.

**T2 — env → DB fallback, immediate (hot):** `registration_enabled` (already DB),
`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASSWORD` (secret, D8), `EMAIL_SECURE`,
`EMAIL_FROM_NAME`, `CORS_ORIGINS`, `GC_ORPHAN_TTL_DAYS`, `WEBDAV_UPSTREAM_URL`,
`JWT_EXPIRES_IN` (D5).
Rationale: read per-request/per-operation today (or trivially made so); changing them has no
boot-time singleton impact.

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
- Value shapes:
  - plaintext config → JSON string, e.g. `"smtp.gmail.com"`
  - encrypted secret (D6/D8) → object
    `{ "enc": "aes-256-gcm", "iv": "<b64>", "tag": "<b64>", "data": "<b64>" }`
- Tier / source / restart-required are derived at runtime from the registry, never stored.
- `updated_at` is already available for the future env-vs-DB sync/alert feature (D9).

---

## Secret encryption (D6–D8)

- Algorithm: **AES-256-GCM** via Node `crypto` (no new dependency), random 96-bit IV,
  128-bit auth tag.
- Master key: env `encrypt_secret_key` (T0). Value = free-length passphrase or 32-byte hex;
  derived to a 32-byte key with `crypto.createHash('sha256')`.
- Encrypt at write time (wizard apply / admin config write); decrypt at read time only when
  the env var is absent (D1).
- **Encryption-key lifecycle rules** (independent of the read-path model):
  1. **keep-existing** — if `.env` already has `encrypt_secret_key`, apply/prefill must keep
     it (never regenerate). Only auto-generate when no key exists.
  2. **key-lost warning** — if no key exists but encrypted DB secret rows are detected (via
     the wizard's direct read), surface an explicit "key lost" warning; such rows cannot be
     decrypted/prefilled.
  3. **only re-encrypt on new value** — a masked (unchanged) secret keeps its existing
     ciphertext; a new value is the only trigger to encrypt with the current key.
- Rotation: changing `encrypt_secret_key` requires re-encrypting all DB secrets (future
  tooling; documented).
- Exposure model: a DB backup leak exposes ciphertext only; plaintext requires both DB and
  `.env` (same class as `JWT_SECRET`).

---

## Wizard apply changes (D3)

Current: apply writes every collected value to `.env` via `envFileWriter`.
New principle: **apply stores operator-entered values in the DB by default; only T0 keys are
written to `.env`.**

- T0 written to `.env`: metadata connection (`WEA_STORAGE_BACKEND`, `WEA_PG_*` /
  `WEA_SQLITE_PATH`) + generated `encrypt_secret_key` + (non-production) `JWT_SECRET`.
- All non-T0 blocks (file storage, email, server/CORS, JWT_EXPIRES_IN) upserted into the
  metadata DB `settings` table; secrets encrypted with `encrypt_secret_key`.
- Admin password effect: unchanged semantics (sqlite direct update / PG via
  `ADMIN_DEFAULT_PASSWORD` — T1).
- **PG case:** apply connects to the target PG with the entered credentials and ensures the
  `settings` table exists by executing the same idempotent
  `CREATE TABLE IF NOT EXISTS settings (...)` DDL that mirrors
  `001_initial_normalized_schema.sql` (comment must state "keep in sync with 001"). The full
  app schema (`users`, `_schema_migrations`, …) is still created by normal boot migrations on
  restart — no conflict (IF NOT EXISTS + file-based tracking).
- **Setup-phase reads are always direct:** during setup the wizard always reads/prefills from
  the target metadata DB via a direct connection (whether or not `.env` already has the PG
  connection info). `settingsStore` (the app's own store) is used only after setup completes —
  runtime T2 reads and the admin config page. No "app's-current-metadata vs target"
  distinction in the setup phase.
- **Prefill implementation (Q1b):** at wizard step 1 (metadata), clicking **Next** with
  `postgresql` issues `POST /api/setup/prefill` carrying the entered credentials; the server
  reads `SELECT key, value FROM settings` from the **target PG directly** and returns
  `{ current, key_lost_warning }` (secrets masked, never plaintext) which the client merges
  into the form via the same `prefillForm` used for `GET /status`. Best-effort — a prefill
  failure does not block advancing. Full contract: `docs/spec/server/routes/setup.md`
  (§"POST /api/setup/prefill").

---

## Boot order

1. Load `.env` → T0 (metadata connection + `NODE_ENV` + `encrypt_secret_key` + `JWT_SECRET`).
2. Connect to the metadata DB using T0 only (D10: failure = boot failure). For sqlite this is
   the local store; for postgresql the `WEA_PG_*` connection.
3. Compute the **effective config** = env-first over DB `settings` rows (decrypt DB secrets
   when env absent) and derive `setup_complete` from it.
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

| Item         | Location                                                                                                    |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| Component    | `client/src/components/mypage/content/SystemConfigEditor.js` (new) — inside the accordion                   |
| Registry     | none — no new mypage category (`myPageRegistry.js` unchanged)                                                |
| Service      | `client/src/services/adminService.js`: `getConfig()` / `updateConfig(values)`                                |
| Server route | `server/domains/admin/routes/config.js` (new): `GET /config` + `PUT /config` under `/api/admin`              |
| MSW          | `client/src/mocks/handlers.js`: `GET/PUT /api/admin/config` + reset state                                    |
| i18n         | en/ko `admin.advancedSettings` (accordion title) + `admin.config.*` (groups, generic strings)                |

**GET `/api/admin/config`** →
`{ config: { "<envKey>": { value, source: 'env'|'db'|'default', tier, secret } } }` for every
registry key; secrets always `"****"` (never decrypted to the client). Display metadata
(`labelKey`, `group`, `inputType`, `options`) lives client-side in a `CONFIG_DISPLAY_META`
map; the server registry is authoritative for tier/secret/source.

**UI structure:**

- The "Advanced settings" accordion sits below the main settings rows; config is fetched
  lazily on first expand.
- Grouped sections (Metadata T0 — read-only, File storage, Server & security, Email,
  Runtime); type-aware inputs (TextField / Switch / Select / Number).
- **source=env rows are read-only** with a "Set in `.env` (env takes precedence)" note (D9) —
  DB edits would be silently ignored while the env var is present.
- **Secrets:** always masked; a "set new value" toggle reveals the field; blank on save =
  keep existing ciphertext (only-re-encrypt-on-new-value).
- **Save:** dirty-tracked "Save changes" → `PUT { values: { KEY: value } }` (changed keys
  only) → server validates allowlist/types (T0 keys rejected), encrypts secrets, upserts
  `settingsStore`, invalidates T2 cache → responds
  `{ applied: [T2 keys], restartRequired: [T1 keys], messageCode }`.
- **Feedback:** Snackbar + "restart required" Alert banner listing the T1 keys changed
  (applied immediately for T2). Editor feedback reuses the page-level Snackbar.
- `registration_enabled` stays in the main settings rows (above the accordion); no
  duplication.

---

## API surface summary

| Endpoint                  | Guard                                    | Behavior                                   |
| ------------------------- | ---------------------------------------- | ------------------------------------------ |
| `GET /api/admin/config`   | authenticateToken + isAdmin              | effective config, masked secrets, source/tier |
| `PUT /api/admin/config`   | authenticateToken + isAdmin              | allowlisted keys → DB, encrypt secrets, invalidate T2 cache |

The setup-mode guard (503 `setup.incomplete`) continues to block admin-write routes while
`setup_complete=false`, so the admin config surface is reachable only when setup is complete.

---

## Security

- DB secrets are encrypted at rest (AES-256-GCM); a DB backup leak exposes ciphertext only.
- Secrets are never returned in plaintext over the API (`"****"`); a new value is the only
  write path for a secret (set-new-value toggle).
- T0 keys (`WEA_PG_*`, `JWT_SECRET`, `encrypt_secret_key`, …) are rejected by `PUT` — they
  can only live in `.env` (D2/D4/D7).
- `source=env` rows are read-only in the UI; a DB edit would be silently shadowed by the env
  value (D1/D9).
- `encrypt_secret_key` follows the keep-existing rule; losing it makes DB secrets
  unrecoverable (documented warning).

---

## Testing anchors

Representative observable behaviors to cover:

- With only T0 in `.env` and config rows in DB: app boots, behavior identical to the
  env-configured equivalent; `.env` values win when present.
- T2 changes via admin UI take effect immediately; T1 changes require restart and are flagged
  as such.
- DB secrets round-trip: written encrypted, decrypted on read only when env absent; env-sourced
  secrets are never decrypted from DB.
- Wizard apply writes T0 to `.env` and the rest to DB; existing full-`.env` installs keep
  working unchanged (`.env` wins).
- `encrypt_secret_key`: auto-generated when absent, kept when present; masked secrets keep
  their ciphertext on save.
- No schema change; existing unit + e2e suites stay green.
