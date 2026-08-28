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
  - **Encryption-key consistency (critical)**: existing DB secrets are encrypted with the
    original `encrypt_secret_key` — if `.env` already has a key, apply/prefill must **keep it**
    (never regenerate, D1); if no key exists but encrypted DB secrets are present, surface a
    "key lost" warning.

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

## 9. Future Scope (not in this phase)

- Admin-login alert when env and DB values diverge, plus a sync/apply-from-env feature (D9).
- `encrypt_secret_key` rotation tooling.
- `WEA_SETUP_TOKEN`-style hardening.

## 10. Resolved Questions (user-confirmed)

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

## 11. Success Criteria (tentative)

## 11. Success Criteria (tentative)

1. With only T0 in `.env` and config rows in DB: app boots, behavior identical to the
   env-configured equivalent; `.env` values win when present.
2. T2 changes via admin UI take effect immediately; T1 changes require restart and are
   flagged as such.
3. DB secrets are stored encrypted; env-sourced secrets are never decrypted from DB.
4. Wizard apply writes T0 to `.env` and the rest to DB; existing full-`.env` installs keep
   working unchanged (`.env` wins).
5. No schema change; existing unit + e2e suites stay green.

## 12. Draft Task Sketch (to be expanded)

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

## 13. Progress Log

- 2026-08-28: Discussion summary captured (D1–D11, tier model, classification, DB/encryption
  design, wizard apply principle). Previous completed setup-wizard PLAN was deleted on `dev`
  (`595707e`). This plan is a fresh start and will be expanded.
- 2026-08-28: §10 resolved (user-confirmed): Q1 PG apply (idempotent settings DDL, direct
  connection; prefill scenarios + encrypt_secret_key keep-existing) — recorded in §7; Q2
  invalidate-on-write + TTL; Q3 full admin config API + UI; Q4 auto-generate key; Q5 raw env
  names; Q6 JWT_EXPIRES_IN as T2 lazy sign-time read.
- 2026-08-28: Q1b corrected (user feedback): setup-phase reads are **always direct** (no
  app-metadata-vs-target distinction; settingsStore is admin/runtime-only, post-setup); boot
  branches on DB contents — DB lacks config → wizard, DB has all → boot normally. Recorded in
  §7/§8.
