# setup routes Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/setup`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Role       | First-run setup wizard backend: reports derived setup-completeness state from the **effective** (env-first over DB) config, runs connection tests (s3/webdav), and persists wizard-chosen **non-T0** configuration into the connected metadata DB `settings` table. The metadata (DB) connection is `.env`-owned (D6/D7): the backend is selected by **presence** of the `WEA_DB_*` credential block (any of `WEA_DB_HOST`/`WEA_DB_DATABASE`/`WEA_DB_USER`/`WEA_DB_PASSWORD` set → remote PostgreSQL; none set → sqlite default; a partial set is a boot-time configuration error). The wizard never writes these metadata-backend T0 keys (only a sqlite-default configuration is available through the wizard; a remote DB requires operator `.env` edits) and rejects a `metadata` block whose backend is `postgresql`. Public while setup is incomplete; auto-gated with 403 once complete. |

Feature Source-of-Truth: [config-source-resolution.md](../../../features/config-source-resolution.md) (§7 wizard apply, §8 boot order) and [setup-wizard.md](../../../features/setup-wizard.md).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/setup/routes.js` (new), mounted at `/api/setup` in `server/index.js`
- **Validator:** `server/infrastructure/setupStatus.js` — `computeSetupStatus(env, { effectiveConfig })` → `{ setup_complete, missing: string[], current: {…masked} }`
- **Effective config:** `server/infrastructure/configResolver.js` (`getSharedResolver().getEffectiveConfig()`) — env-first over DB `settings` rows; secrets always masked
- **Classification:** `server/infrastructure/configRegistry.js` (`isT0`, `isSecret`) — tiers per PLAN §4
- **DB store:** `server/models/Settings.js` (sqlite path) — plaintext config passed as-is, secret values as plaintext strings too (no encryption at rest)
- **PG direct write:** same idempotent `settings` DDL as `server/store/postgresql/ddl/001_initial_normalized_schema.sql` + upsert against the target PG
- **Env writer:** `server/infrastructure/envFileWriter.js` — merge-write **only the T0 subset** to the resolved env path, atomic, `0600`
- **Test file:** `server/domains/setup/__tests__/setup.test.js`

### 2.2 Route List

| Method | Path       | Auth                                              | Description                                                                                                                                                                   |
| ------ | ---------- | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/status`  | None                                              | Derived setup completeness from the effective config + missing keys + safe current values (non-T0 only).                                                                      |
| POST   | `/test`    | None (403 `setup.complete` when already complete) | Connection test for `s3` or `webdav` targets (postgresql is `.env`-owned under D7; probed via the admin `/api/admin/config/test` instead).                                    |
| POST   | `/apply`   | None (403 `setup.complete` when already complete) | Validate (metadata block optional; `postgresql` rejected); write **non-T0** keys to the connected metadata DB as plaintext; apply admin-password effect. Returns `restart_required: true`. |
| POST   | `/prefill` | None (403 `setup.complete` when already complete) | **Deprecated under D7** — metadata-driven prefill. Retained for backward compat; the wizard client prefills from `GET /status` `current` only.                                |

### 2.3 Middleware Used

- `requestLogger` (already mounted globally at `/api` in `server/index.js:61-62`; never logs request bodies — `server/middleware/requestLogger.js:4-5`)
- Setup-mode guard (new middleware in `server/domains/setup/routes.js` or `server/middleware/`): when `!setup_complete`, file-domain and admin-write routes return `503 { errorCode: 'setup.incomplete' }`; setup, auth-login, public settings, and health stay open.

### 2.4 Request/Response Spec

#### GET /api/setup/status

Public, always available. Computes `setup_complete` from the currently **effective** (env-first over DB `settings` rows) configuration via `getSharedResolver().getEffectiveConfig()` merged into `process.env` per the completeness rules (feature doc §"Boot order"):

- `metadata`: presence-selected — sqlite (default) when none of `WEA_DB_HOST`/`WEA_DB_DATABASE`/`WEA_DB_USER`/`WEA_DB_PASSWORD` is set; the remote PostgreSQL backend when all four are set (a partial set is a boot-time configuration error listing the missing keys; `server/store/storage.js:getBackend()`).
- `file`: `WEA_FILE_STORAGE` (default `s3`) — `s3` requires the 4 `S3_*`/`AWS_*` keys (`server/infrastructure/adapters/blobstore/index.js:7-13`); `webdav` requires `WEBDAV_URL`/`WEBDAV_USERNAME`/`WEBDAV_PASSWORD`.
- `jwt`: `JWT_SECRET` non-default required only when `NODE_ENV=production` (`server/utils/auth.js:5-12`; D7).

The `current` block therefore prefills operator-entered values from the DB `settings` table (plaintext values as stored; secrets masked, never surfaced here).

**200:**

```jsonc
{
  "setup_complete": false,
  "missing": ["S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "current": {
    // safe values for prefill (env → DB → default; secrets masked)
    // metadata backend is presence-derived (WEA_DB_* creds → postgresql, else sqlite), not a current key
    "WEA_FILE_STORAGE": "s3",
    "PORT": "5001",
    "JWT_SECRET": "****",
    "WEBDAV_URL": "",
    "EMAIL_HOST": "",
  },
}
```

Masking rule: secrets (`JWT_SECRET`, `AWS_SECRET_ACCESS_KEY`, `WEBDAV_PASSWORD`, `WEA_DB_PASSWORD`, `EMAIL_PASSWORD`, `ADMIN_DEFAULT_PASSWORD`) are rendered as `"****"` when set and absent when unset. DB secret rows are stored plaintext but are masked here (presentation only) — the status endpoint never leaks a stored secret value.

#### POST /api/setup/test

Public; **403 `setup.complete` when already complete**. Accepts one of three target shapes; performs the corresponding connection probe and returns a pass-through result. Failure responses use `{ ok: false, errorCode, message, reason? }` (see error taxonomy below).

**Request (one of three shapes):**

```jsonc
{ "target": "postgresql", "host": "…", "port": "5432", "database": "…", "user": "…", "password": "…", "ssl": false }
{ "target": "s3", "bucket": "…", "region": "…", "accessKeyId": "…", "secretAccessKey": "…", "endpoint": "" }
{ "target": "webdav", "url": "…", "username": "…", "password": "…" }
```

**Success:** `200 { "ok": true }`

**Errors:** `4xx { "ok": false, "errorCode": "…", "message": "…", "reason": "…" }`

- `errorCode` — stable i18n key (dot-notation `serverErrors.*`); the client renders its translation as the primary error text.
- `message` — short English fallback for non-i18n clients.
- `reason` — optional, **short** technical detail (trimmed to ~200 chars max), e.g. `ECONNREFUSED 127.0.0.1:5432` or `AccessDenied`. Shown only as a secondary muted detail line; the primary text always comes from the `errorCode` translation.

**Connection-test error taxonomy.** Probe failures are classified into stable codes; anything unclassified falls back to `serverErrors.setup.test.failed` with the raw driver message kept in `reason` only:

| Target     | Condition                                                     | errorCode                                                              |
| ---------- | ------------------------------------------------------------- | ---------------------------------------------------------------------- |
| PostgreSQL | ECONNREFUSED / ENOTFOUND / EAI_AGAIN / ETIMEDOUT / ECONNRESET | `serverErrors.setup.test.pg.unreachable`                               |
| PostgreSQL | pg error codes `28P01` / `28000` (auth failed)                | `serverErrors.setup.test.pg.authFailed`                                |
| PostgreSQL | pg error code `3D000` (database does not exist)               | `serverErrors.setup.test.pg.databaseMissing`                           |
| PostgreSQL | anything else                                                 | `serverErrors.setup.test.failed`                                       |
| S3         | HTTP 403 / `AccessDenied`                                     | `serverErrors.setup.test.s3.accessDenied`                              |
| S3         | `NoSuchBucket` (bucket does not exist)                        | `serverErrors.setup.test.s3.bucketMissing`                             |
| S3         | ECONNREFUSED / ENOTFOUND / ETIMEDOUT                          | `serverErrors.setup.test.s3.unreachable`                               |
| S3         | anything else                                                 | `serverErrors.setup.test.failed`                                       |
| WebDAV     | unchanged                                                     | existing `serverErrors.webdav.*` / `serverErrors.api.webdavTestFailed` |

- S3 probe is **two-step**: (1) `ListObjectsV2` (`MaxKeys: 1`) on the target bucket — 200 → bucket exists + credentials valid (this is what distinguishes a missing bucket, since `HeadObject`'s 404 `NotFound` is ambiguous on MinIO/S3); `NoSuchBucket`/`NotFound` 404 → `bucketMissing`; (2) `HeadObject` on a random `__wea_setup_probe_<uuid>` key — 404 `NotFound`/`NoSuchKey` (key simply absent) is treated as **success**; `403` → `accessDenied`. Success is only reported when both steps pass.
- Missing-required-fields (`Missing required fields: …`) and unsupported-target (`Unsupported target: …`) errors remain `serverErrors.setup.testFailed`.
- WebDAV's generic failure uses `serverErrors.api.webdavTestFailed`, whose template contains `{{reason}}`; the client interpolates it via `t(errorCode, { reason })`.

Probe references:

- WebDAV connection test: `server/infrastructure/webdavTest.js`.
- S3/WebDAV dest-config validation shaped for payloads: `buildDestBlobStore` (`server/infrastructure/adapters/blobstore/config.js:234-241`).
- PostgreSQL config resolution + missing-key errors: `resolvePgConfig` (`server/store/storage.js:32-47`).

#### POST /api/setup/apply

Public; **403 when already complete** (gate uses the same effective view as `/status`). Validates every block (unknown keys rejected, `400` with per-field errors), then **writes the payload's startup-critical T0 keys into the resolved `.env`** (`JWT_SECRET`) and **upserts every non-T0 key into the connected metadata DB `settings` table as plaintext** (row key = raw env var name, D11). The `metadata` block is **optional** (D7); when present, `metadata.backend === 'postgresql'` is rejected `400` `fields.metadata='notAllowed'` — the DB connection is `.env`-owned (D6): the backend is presence-selected at boot (any `WEA_DB_*` credential → PostgreSQL, else sqlite default), and apply upserts into the **booted** store's `settings` table regardless of which backend that is. The metadata-backend T0 keys (the `WEA_DB_*` block and `WEA_SQLITE_PATH`) are **never** written by apply. Implemented by the shared `setupCore.applySetup`, which is also the single apply core of the CLI setup tool (`docs/features/setup-cli.md`).

**Request:**

```jsonc
{
  "file": { "backend": "s3", "bucket": "…", "region": "…", "accessKeyId": "…", "secretAccessKey": "…", "endpoint": "" }
       |  { "backend": "webdav", "url": "…", "username": "…", "password": "…", "authType": "auto" },
  "admin": { "password": "…" },            // username fixed: admin (D6)
  "jwt": { "secret": "…", "expiresIn": "30m" },
  "server": { "port": "5001", "corsOrigins": "" },
  "email": { "host": "", "port": "587", "user": "", "password": "", "secure": false, "fromName": "" } // all optional
}
```

> **D7 note:** the `metadata` block is absent from the wizard client and is **optional** server-side. A `metadata` block with `backend: "postgresql"` is rejected (400) — the DB connection is `.env`-owned (D6). Non-T0 keys are written via the app's own `settingsStore`; the metadata-backend T0 keys are never touched by apply (see the Behavior list below).

`registration_enabled` is **not** part of the wizard payload and is never touched by apply.

**Behavior:**

1. Validate every block (reject unknown keys → `400` with per-field errors).
2. Build the full entries map (`buildEnvEntries`) from the payload (`file`/`jwt`/`server`/`email`).
3. **Masked (unchanged) secrets keep their existing stored value:** the client sends the prefill mask `'****'` for a secret it did not edit; validation accepts it (non-empty) but apply **drops** any `'****'` secret entry before the DB write, so the stored value is never overwritten by the mask.
4. Partition the entries by registry tier (`partitionEntries`):
   - **T0 → `.env`** (via `envFileWriter`, atomic `0600`, backup, merge-preserves unknown
     lines): `JWT_SECRET` (always written — D4 env-only; the boot auth key must exist after
     restart). The metadata-backend T0 keys (the `WEA_DB_*` block and `WEA_SQLITE_PATH`)
     are explicitly **excluded** — they are `.env`-owned (D6), presence-selected at boot, and never written by apply.
   - **Non-T0 → DB `settings`** (row key = raw env var name):
     `WEA_FILE_STORAGE`, `S3_BUCKET` / `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_ENDPOINT` (s3), `WEBDAV_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` / `WEBDAV_AUTH_TYPE` (webdav), `PORT`, `CORS_ORIGINS`, `JWT_EXPIRES_IN`, `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` / `EMAIL_SECURE` / `EMAIL_FROM_NAME`.
5. **Write the `.env` subset FIRST** (atomic temp-file + rename). Ordering guarantee: if the `.env` write fails, the DB has not been touched, so boot still shows setup mode — a failed apply can never leave a committed-but-error "complete" state.
6. **Update the admin password** (`updateAdminPassword`): the `admin` account already exists in the connected metadata store (seeded at boot, including setup-mode boots); apply updates its password via the app's user store after the `.env` write. If the `admin` row is unexpectedly absent it logs a warning and continues (the default credential then applies on the next boot). There is no restart dependency for the credential and no `ADMIN_DEFAULT_PASSWORD` is written.
7. **Write non-T0 to the metadata DB through the app's `Settings` model** (`writeSettings`) on the connected store (sqlite or postgresql, as booted): every value — plaintext config **and** secret — is stored as plaintext via `Settings.set(key, String(value))` (the store JSON-stringifies on PG / stores raw TEXT on sqlite).
8. Clear the shared T2 cache: `getSharedResolver().invalidateCache()` so the DB writes are visible immediately for restart-free (T2) reads.
9. Respond **`200 { "restart_required": true }`**.

**Idempotency/safety:** apply refuses (`403`) once `setup_complete` is true; concurrent applies are last-writer-wins (documented, single-operator assumption). The `.env` write happens before the DB write, so a failed apply leaves **no committed partial state** — the worst case is a written `.env` with an unchanged DB, which still boots into setup mode (never a false "complete").

#### POST /api/setup/prefill

Public; **403 `setup.complete` when already complete** (same `requireSetupIncomplete` guard as `/test`). Connects **directly** to the metadata DB chosen in step 1 (Q1b — setup-phase reads are always direct) and reads its `settings` rows to prefill the form. It deliberately does **not** use the shared resolver or the app's own store: a no-`.env` boot runs on the default sqlite store, and the PG the operator enters in step 1 is only reachable via a direct connection with the entered credentials.

**Request:**

```jsonc
{
  "metadata": {
    "backend": "postgresql",
    "host": "…",
    "port": "5432",
    "database": "…",
    "user": "…",
    "password": "…",
    "ssl": false,
  },
}
```

- `metadata.backend === 'postgresql'` → direct PG read of `SELECT key, value FROM settings`.
- `metadata.backend === 'sqlite'` or missing `metadata` → `200 { "current": {} }` (sqlite is already prefilled from the app's own store via `GET /status` on mount).

**Success:** `200 { "current": { "<KEY>": value } }`

`current` build rules (`buildPrefillCurrent`):

- key with `isSecret(key)` (configRegistry) → `current[key] = "****"` whenever the row exists — never plaintext. (Secret rows are stored plaintext but are masked at this boundary.)
- plaintext row → the value is JSON-parsed when it is a JSON string (node-pg returns JSONB already parsed, so a plaintext row stored as the JSON string `"host"` arrives as `host`); scalars are coerced to `String`; `null`/undefined rows are skipped.

**Missing settings table:** on a fresh PG the `settings` table does not exist yet (`undefined_table` / pg code `42P01` or similar) → treated as empty rows (`current: {}`).

**Errors:** `4xx { "ok": false, "errorCode": "…", "message": "…", "reason": "…" }` — PG unreachable / auth-failed / db-missing / generic map to the **same** classified codes as `POST /test` (connection-test taxonomy in §2.4): `serverErrors.setup.test.pg.unreachable`, `serverErrors.setup.test.pg.authFailed`, `serverErrors.setup.test.pg.databaseMissing`, `serverErrors.setup.test.failed`, and `serverErrors.setup.testFailed` for missing required fields. The client treats prefill as best-effort: a failure surfaces no blocking error and the wizard still advances (the connection-test button is the explicit validator).

### 2.5 Related Documents

- [api.md](../../../api.md)
- [shared-contracts.md](../../../shared-contracts.md)
- [setup-wizard.md (feature SoT)](../../../features/setup-wizard.md)

### 2.6 Error Codes

New codes added to `shared/serverMessageCodes.js`:

- `setup.incomplete` → `serverErrors.setup.incomplete` — returned as `503 { errorCode: 'setup.incomplete' }` by the setup-mode guard on file-domain and admin-write routes while setup is incomplete.
- `setup.complete` → `serverErrors.setup.complete` — returned as `403 { errorCode: 'setup.complete' }` by `POST /api/setup/test` and `POST /api/setup/apply` when setup is already complete.

Connection-test taxonomy codes are module-local i18n keys (same `ns.key` format; documented in §2.4, locale entries added in `client/src/locales/en.json`/`ko.json` — **not** added to `shared/serverMessageCodes.js`):

- `serverErrors.setup.testFailed` — missing-required-fields / unsupported-target / generic probe failure.
- `serverErrors.setup.test.failed` — generic connection-test failure (raw driver code in `reason`).
- `serverErrors.setup.test.pg.unreachable`, `serverErrors.setup.test.pg.authFailed`, `serverErrors.setup.test.pg.databaseMissing`.
- `serverErrors.setup.test.s3.accessDenied`, `serverErrors.setup.test.s3.bucketMissing`, `serverErrors.setup.test.s3.unreachable`.
- `serverErrors.setup.invalidPayload` — invalid payload (reused by `POST /api/setup/apply` validation).

`POST /api/setup/prefill` reuses the connection-test taxonomy codes above (unreachable / auth / db-missing / generic / missing-fields) so the client renders the same translations.

### 2.7 Related Route Changes

`GET /api/settings/public` (`server/domains/admin/routes/settings.js:13-21`) is extended with `setup_complete: boolean` (derived from the same validator). The login page already fetches this endpoint (`client/src/pages/Login/hooks/useLoginForm.js:26-43`) → zero extra round-trip for the redirect-on-incomplete flow.

### 2.8 Integration Test Scenarios

- [ ] GET /status returns derived `{ setup_complete, missing, current }` with secrets masked
- [ ] Fresh (no env) → incomplete with the exact missing list; full s3+sqlite → complete; full pg+webdav → complete; prod + default JWT → incomplete
- [ ] GET /status prefills `current` from DB `settings` rows (effective env-first view)
- [ ] POST /test passes through postgresql/s3/webdav probe results; error shapes are `{ ok: false, errorCode, message, reason? }` with the classified taxonomy codes
- [ ] POST /apply (sqlite+webdav): only `JWT_SECRET` (always) is written to `.env` (mode 0600); the metadata T0 keys (the `WEA_DB_*` block, `WEA_SQLITE_PATH`) are never written by apply; non-T0 keys are upserted into the **booted** metadata DB `settings` table as plaintext strings (secrets included, readable back as-is)
- [ ] POST /apply with `metadata.backend === 'postgresql'` → 400 `fields.metadata='notAllowed'` (the DB connection is `.env`-owned; apply never runs settings DDL or upserts against a target PG); a non-T0 apply upserts into the booted store's `settings` table and updates the `admin` password on that store
- [ ] POST /apply → `restart_required: true` and `getSharedResolver().invalidateCache()` is invoked
- [ ] POST /apply when already complete → 403 `setup.complete`
- [ ] POST /test when already complete → 403 `setup.complete`
- [ ] POST /apply with unknown keys / invalid payload → 400 with per-field errors
- [ ] Setup-mode guard: file-domain and admin-write routes → 503 `setup.incomplete` while incomplete; open again after completion
- [ ] Request logger does not leak apply body (bodies are never logged)
