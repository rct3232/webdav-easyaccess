# setup routes Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/setup`                                                                                                                                                                                                                                                                       |
| Role       | First-run setup wizard backend: reports derived setup-completeness state from the **effective** (env-first over DB) config, runs connection tests (postgresql/s3/webdav), and persists wizard-chosen boot configuration — **T0 keys to `.env`, everything else to the metadata DB `settings` table**. Public while setup is incomplete; auto-gated with 403 once complete. |

Feature Source-of-Truth: [config-source-resolution.md](../../../features/config-source-resolution.md) (§7 wizard apply, §8 boot order) and [setup-wizard.md](../../../features/setup-wizard.md).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/setup/routes.js` (new), mounted at `/api/setup` in `server/index.js`
- **Validator:** `server/infrastructure/setupStatus.js` — `computeSetupStatus(env, { effectiveConfig })` → `{ setup_complete, missing: string[], current: {…masked} }`
- **Effective config:** `server/infrastructure/configResolver.js` (`getSharedResolver().getEffectiveConfig()`) — env-first over DB `settings` rows; secrets always masked
- **Classification:** `server/infrastructure/configRegistry.js` (`isT0`, `isSecret`) — tiers per PLAN §4
- **Encryption:** `server/utils/configEncryption.js` (`encryptSecret`, `isEncryptedPayload`, `generateKey`) — AES-256-GCM, master key `encrypt_secret_key`
- **DB store:** `server/models/Settings.js` (sqlite path) — plaintext config passed as-is, secrets as `JSON.stringify(encryptSecret(…))`
- **PG direct write:** same idempotent `settings` DDL as `server/store/postgresql/ddl/001_initial_normalized_schema.sql` + upsert against the target PG
- **Env writer:** `server/infrastructure/envFileWriter.js` — merge-write **only the T0 subset** to the resolved env path, atomic, `0600`
- **Test file:** `server/domains/setup/__tests__/setup.test.js`

### 2.2 Route List

| Method | Path      | Auth                                              | Description                                                                                    |
| ------ | --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/status` | None                                              | Derived setup completeness from the effective config + missing keys + safe current values (prefill from DB) + `key_lost_warning`. |
| POST   | `/test`   | None (403 `setup.complete` when already complete) | Connection test for `postgresql`, `s3`, or `webdav` targets.                                   |
| POST   | `/apply`  | None (403 `setup.complete` when already complete) | Validate; write T0 keys to `.env`, non-T0 keys to the metadata DB; apply admin-password effect. Returns `restart_required: true`. |
| POST   | `/prefill`| None (403 `setup.complete` when already complete) | Directly read the target metadata DB `settings` rows (Q1b) with the entered credentials and return masked prefill values + `key_lost_warning`. |

### 2.3 Middleware Used

- `requestLogger` (already mounted globally at `/api` in `server/index.js:61-62`; never logs request bodies — `server/middleware/requestLogger.js:4-5`)
- Setup-mode guard (new middleware in `server/domains/setup/routes.js` or `server/middleware/`): when `!setup_complete`, file-domain and admin-write routes return `503 { errorCode: 'setup.incomplete' }`; setup, auth-login, public settings, and health stay open.

### 2.4 Request/Response Spec

#### GET /api/setup/status

Public, always available. Computes `setup_complete` from the currently **effective** (env-first over DB `settings` rows) configuration via `getSharedResolver().getEffectiveConfig()` merged into `process.env` per the completeness rules (feature doc §"Boot order"):

- `metadata`: `WEA_STORAGE_BACKEND` (default `sqlite`) — sqlite always resolvable; `postgresql` requires the 5 `WEA_PG_*` keys (`server/store/storage.js:32-47`).
- `file`: `WEA_FILE_STORAGE` (default `s3`) — `s3` requires the 4 `S3_*`/`AWS_*` keys (`server/infrastructure/adapters/blobstore/index.js:7-13`); `webdav` requires `WEBDAV_URL`/`WEBDAV_USERNAME`/`WEBDAV_PASSWORD`.
- `jwt`: `JWT_SECRET` non-default required only when `NODE_ENV=production` (`server/utils/auth.js:5-12`; D7).

The `current` block therefore prefills operator-entered values from the DB `settings` table (plaintext config as stored; secrets masked, never decrypted here). DB-backed secrets whose master key (`encrypt_secret_key`) is absent cannot be decrypted — the response carries a `key_lost_warning`.

**200:**

```jsonc
{
  "setup_complete": false,
  "missing": ["S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "key_lost_warning": false,
  "current": {
    // safe values for prefill (env → DB → default; secrets masked)
    "WEA_STORAGE_BACKEND": "sqlite",
    "WEA_FILE_STORAGE": "s3",
    "PORT": "5001",
    "JWT_SECRET": "****",
    "WEBDAV_URL": "",
    "EMAIL_HOST": "",
  },
}
```

Masking rule: secrets (`JWT_SECRET`, `AWS_SECRET_ACCESS_KEY`, `WEBDAV_PASSWORD`, `WEA_PG_PASSWORD`, `EMAIL_PASSWORD`, `ADMIN_DEFAULT_PASSWORD`) are rendered as `"****"` when set and absent when unset.

`key_lost_warning` semantics:

- `true` when **any** `settings` row holds an encrypted secret payload (`isEncryptedPayload` on the parsed row) **and** `process.env.encrypt_secret_key` is absent — those rows are unrecoverable and will not be prefilled/decrypted.
- `false` when the key is present, or when no encrypted rows exist.
- The status endpoint never decrypts DB secrets in this path (prefill must not leak plaintext); it only inspects payload shape.

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

- S3 probe is **two-step**: (1) `ListObjectsV2` (`MaxKeys: 1`) on the target bucket — 200 ⇒ bucket exists + credentials valid (this is what distinguishes a missing bucket, since `HeadObject`'s 404 `NotFound` is ambiguous on MinIO/S3); `NoSuchBucket`/`NotFound` 404 ⇒ `bucketMissing`; (2) `HeadObject` on a random `__wea_setup_probe_<uuid>` key — 404 `NotFound`/`NoSuchKey` (key simply absent) is treated as **success**; `403` ⇒ `accessDenied`. Success is only reported when both steps pass.
- Missing-required-fields (`Missing required fields: …`) and unsupported-target (`Unsupported target: …`) errors remain `serverErrors.setup.testFailed`.
- WebDAV's generic failure uses `serverErrors.api.webdavTestFailed`, whose template contains `{{reason}}`; the client interpolates it via `t(errorCode, { reason })`.

Probe references:

- WebDAV connection test: `server/infrastructure/webdavTest.js`.
- S3/WebDAV dest-config validation shaped for payloads: `buildDestBlobStore` (`server/infrastructure/adapters/blobstore/config.js:234-241`).
- PostgreSQL config resolution + missing-key errors: `resolvePgConfig` (`server/store/storage.js:32-47`).

#### POST /api/setup/apply

Public; **403 when already complete** (gate uses the same effective view as `/status`). Validates every block (unknown keys rejected, `400` with per-field errors), then splits the collected values by tier: **T0 keys are written to `.env`**; **every non-T0 key is upserted into the metadata DB `settings` table** (row key = raw env var name, D11).

**Request:**

```jsonc
{
  "metadata": { "backend": "sqlite" }
           |  { "backend": "postgresql", "host": "…", "port": "…", "database": "…", "user": "…", "password": "…", "ssl": false, "max": "10" },
  "file": { "backend": "s3", "bucket": "…", "region": "…", "accessKeyId": "…", "secretAccessKey": "…", "endpoint": "" }
        |  { "backend": "webdav", "url": "…", "username": "…", "password": "…", "authType": "auto" },
  "admin": { "password": "…" },            // username fixed: admin (D6)
  "jwt": { "secret": "…", "expiresIn": "30m" },
  "server": { "port": "5001", "corsOrigins": "" },
  "email": { "host": "", "port": "587", "user": "", "password": "", "secure": false, "fromName": "" } // all optional
}
```

`registration_enabled` is **not** part of the wizard payload and is never touched by apply.

**Behavior:**

1. Validate every block (reject unknown keys → `400` with per-field errors).
2. Build the full entries map (`buildEnvEntries`) and partition by registry tier:
   - **T0 → `.env`** (via `envFileWriter`, atomic `0600`, merge-preserves unknown lines):
     `WEA_STORAGE_BACKEND`, the `WEA_PG_*` subset (postgresql only), `JWT_SECRET` (always written — D4 env-only; the boot auth key must exist after restart), and `encrypt_secret_key` (only when auto-generated, see step 3).
   - **Non-T0 → DB `settings`** (row key = raw env var name):
     `WEA_FILE_STORAGE`, `S3_BUCKET` / `AWS_REGION` / `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` / `S3_ENDPOINT` (s3), `WEBDAV_URL` / `WEBDAV_USERNAME` / `WEBDAV_PASSWORD` / `WEBDAV_AUTH_TYPE` (webdav), `PORT`, `CORS_ORIGINS`, `JWT_EXPIRES_IN`, `EMAIL_HOST` / `EMAIL_PORT` / `EMAIL_USER` / `EMAIL_PASSWORD` / `EMAIL_SECURE` / `EMAIL_FROM_NAME`, and — postgresql only — `ADMIN_DEFAULT_PASSWORD`.
3. **Masked (unchanged) secrets keep their existing ciphertext (only-re-encrypt-on-new-value, PLAN §7):** the client sends the prefill mask `'****'` for a secret it did not edit; validation accepts it (non-empty) but apply **drops** any `'****'` secret entry before the DB write, so `writeSettings` never re-encrypts it. A genuinely new value is the only trigger to encrypt with the current master key.
4. **`encrypt_secret_key` lifecycle (keep-existing, PLAN §7):**
   - If `process.env.encrypt_secret_key` is already set → **keep it**: it is not regenerated and not written to `.env`; it is used to encrypt the DB secrets of this apply.
   - Otherwise → **auto-generate** one (`generateKey()`), write it to the `.env` T0 subset, and use it to encrypt this apply's DB secrets.
5. Admin password effect (D6):
   - `metadata.backend=postgresql` → `ADMIN_DEFAULT_PASSWORD=<chosen>` is stored in the DB (encrypted as a secret, T1). A parallel boot task populates it into `process.env` before `ensureDefaultAdmin` creates `admin` on restart.
   - `metadata.backend=sqlite` → admin already exists in the sqlite store from first boot; apply updates its password directly via the existing user store (single store call), so no restart dependency for the credential.
6. Write non-T0 to the metadata DB:
   - **sqlite**: `Settings.set(key, value)` — plaintext config value passed as-is (the store JSON-stringifies); a secret is stored as `JSON.stringify(encryptSecret(String(value), masterKey))`.
   - **postgresql**: apply connects **directly** to the target PG with the entered credentials, ensures the `settings` table exists via the idempotent `CREATE TABLE IF NOT EXISTS settings (…)` DDL (mirrored verbatim from `001_initial_normalized_schema.sql`; a code comment marks it "keep in sync with 001"), then upserts each row:
     `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2::jsonb, NOW()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`.
     Plaintext rows store `JSON.stringify(String(value))` (e.g. `"smtp.gmail.com"`); secret rows store the encrypted payload object as JSON. The client is closed in a `finally`. The full app schema (`users`, `_schema_migrations`, …) is still created by normal boot migrations on restart (`IF NOT EXISTS` + file-based tracking → no conflict).
7. Clear the shared T2 cache: `getSharedResolver().invalidateCache()` so the DB writes are visible immediately for restart-free (T2) reads.
8. Respond **`200 { "restart_required": true }`**.

**Idempotency/safety:** apply refuses (`403`) once `setup_complete` is true; concurrent applies are last-writer-wins (documented, single-operator assumption). A failed apply may leave partial DB rows (single-operator; re-apply is idempotent upserts).

#### POST /api/setup/prefill

Public; **403 `setup.complete` when already complete** (same `requireSetupIncomplete` guard as `/test`). Connects **directly** to the metadata DB chosen in step 1 (Q1b — setup-phase reads are always direct) and reads its `settings` rows to prefill the form. It deliberately does **not** use the shared resolver or the app's own store: a no-`.env` boot runs on the default sqlite store, and the PG the operator enters in step 1 is only reachable via a direct connection with the entered credentials.

**Request:**

```jsonc
{
  "metadata": { "backend": "postgresql", "host": "…", "port": "5432", "database": "…", "user": "…", "password": "…", "ssl": false }
}
```

- `metadata.backend === 'postgresql'` → direct PG read of `SELECT key, value FROM settings`.
- `metadata.backend === 'sqlite'` or missing `metadata` → `200 { "current": {}, "key_lost_warning": false }` (sqlite is already prefilled from the app's own store via `GET /status` on mount).

**Success:** `200 { "current": { "<KEY>": value }, "key_lost_warning": boolean }`

`current` build rules (`buildPrefillCurrent`):

- key with `isSecret(key)` (configRegistry) → `current[key] = "****"` whenever the row exists — never plaintext; a legacy plaintext secret row is masked the same way.
- plaintext row → the value is JSON-parsed when it is a JSON string (node-pg returns JSONB already parsed, so a plaintext config row stored as the JSON string `"host"` arrives as `host`); scalars are coerced to `String`; `null`/undefined rows are skipped.

`key_lost_warning` = any `settings` row holds an encrypted payload (`isEncryptedPayload` on the parsed row value) **and** `process.env.encrypt_secret_key` is absent. Purely informational — it never blocks the wizard; masked secrets still prefill as `"****"`.

**Missing settings table:** on a fresh PG the `settings` table does not exist yet (`undefined_table` / pg code `42P01` or similar) → treated as empty rows (`current: {}`, `key_lost_warning: false`).

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

- [ ] GET /status returns derived `{ setup_complete, missing, current, key_lost_warning }` with secrets masked
- [ ] Fresh (no env) → incomplete with the exact missing list; full s3+sqlite → complete; full pg+webdav → complete; prod + default JWT → incomplete
- [ ] GET /status prefills `current` from DB `settings` rows (effective env-first view)
- [ ] GET /status → `key_lost_warning: true` when an encrypted DB row exists and `encrypt_secret_key` is absent; `false` when the key is present
- [ ] POST /test passes through postgresql/s3/webdav probe results; error shapes are `{ ok: false, errorCode, message, reason? }` with the classified taxonomy codes
- [ ] POST /apply (sqlite+webdav / pg+s3): T0 keys (`WEA_STORAGE_BACKEND`, `WEA_PG_*`, `JWT_SECRET`, generated `encrypt_secret_key`) are written to `.env` (mode 0600); non-T0 keys are upserted to the metadata DB with secrets encrypted (`decryptSecret` round-trips)
- [ ] POST /apply keeps an existing `encrypt_secret_key` (not regenerated, not written to `.env`)
- [ ] POST /apply (postgresql) runs the idempotent `settings` DDL and upserts against the target PG; sqlite admin password is untouched
- [ ] POST /apply → `restart_required: true` and `getSharedResolver().invalidateCache()` is invoked
- [ ] POST /apply when already complete → 403 `setup.complete`
- [ ] POST /test when already complete → 403 `setup.complete`
- [ ] POST /apply with unknown keys / invalid payload → 400 with per-field errors
- [ ] Setup-mode guard: file-domain and admin-write routes → 503 `setup.incomplete` while incomplete; open again after completion
- [ ] Request logger does not leak apply body (bodies are never logged)
