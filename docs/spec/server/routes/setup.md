# setup routes Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/setup`                                                                                                                                                                                                                                                                       |
| Role       | First-run setup wizard backend: reports derived setup-completeness state, runs connection tests (postgresql/s3/webdav), and persists wizard-chosen boot configuration by merge-writing the app's dotenv file. Public while setup is incomplete; auto-gated with 403 once complete. |

Feature Source-of-Truth: [setup-wizard.md](../../../features/setup-wizard.md).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/setup/routes.js` (new), mounted at `/api/setup` in `server/index.js`
- **Validator:** `server/infrastructure/setupStatus.js` (new) — `computeSetupStatus(env)` → `{ setup_complete, missing: string[], current: {…masked} }`
- **Writer:** `server/infrastructure/envFileWriter.js` (new) — merge-write to the resolved env path (`server/index.js:10-18`), atomic, `0600`
- **Test file:** `server/domains/setup/__tests__/setup.test.js`

### 2.2 Route List

| Method | Path      | Auth                                              | Description                                                                                    |
| ------ | --------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| GET    | `/status` | None                                              | Derived setup completeness + missing keys + safe current values (prefill).                     |
| POST   | `/test`   | None (403 `setup.complete` when already complete) | Connection test for `postgresql`, `s3`, or `webdav` targets.                                   |
| POST   | `/apply`  | None (403 `setup.complete` when already complete) | Validate + merge-write `.env` + apply admin-password effect. Returns `restart_required: true`. |

### 2.3 Middleware Used

- `requestLogger` (already mounted globally at `/api` in `server/index.js:61-62`; never logs request bodies — `server/middleware/requestLogger.js:4-5`)
- Setup-mode guard (new middleware in `server/domains/setup/routes.js` or `server/middleware/`): when `!setup_complete`, file-domain and admin-write routes return `503 { errorCode: 'setup.incomplete' }`; setup, auth-login, public settings, and health stay open.

### 2.4 Request/Response Spec

#### GET /api/setup/status

Public, always available. Computes `setup_complete` from the currently effective (resolved) configuration per the completeness rules (feature doc §"Setup completeness rules"):

- `metadata`: `WEA_STORAGE_BACKEND` (default `sqlite`) — sqlite always resolvable; `postgresql` requires the 5 `WEA_PG_*` keys (`server/store/storage.js:32-47`).
- `file`: `WEA_FILE_STORAGE` (default `s3`) — `s3` requires the 4 `S3_*`/`AWS_*` keys (`server/infrastructure/adapters/blobstore/index.js:7-13`); `webdav` requires `WEBDAV_URL`/`WEBDAV_USERNAME`/`WEBDAV_PASSWORD`.
- `jwt`: `JWT_SECRET` non-default required only when `NODE_ENV=production` (`server/utils/auth.js:5-12`; D7).

**200:**

```jsonc
{
  "setup_complete": false,
  "missing": ["S3_BUCKET", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"],
  "current": {
    // safe values for prefill; secrets masked
    "WEA_STORAGE_BACKEND": "sqlite",
    "WEA_FILE_STORAGE": "s3",
    "PORT": "5001",
    "JWT_SECRET": "****",
    "WEBDAV_URL": "",
    "EMAIL_HOST": "",
  },
}
```

Masking rule: secrets (`JWT_SECRET`, `AWS_SECRET_ACCESS_KEY`, `WEBDAV_PASSWORD`, `WEA_PG_PASSWORD`, `EMAIL_PASSWORD`) are rendered as `"****"` when set and absent when unset.

#### POST /api/setup/test

Public; **403 `setup.complete` when already complete**. Accepts one of three target shapes; performs the corresponding connection probe and returns a pass-through result. Error responses use `{ ok: false, errorCode, message }`.

**Request (one of three shapes):**

```jsonc
{ "target": "postgresql", "host": "…", "port": "5432", "database": "…", "user": "…", "password": "…", "ssl": false }
{ "target": "s3", "bucket": "…", "region": "…", "accessKeyId": "…", "secretAccessKey": "…", "endpoint": "" }
{ "target": "webdav", "url": "…", "username": "…", "password": "…" }
```

**Success:** `200 { "ok": true }`

**Errors:** `4xx { "ok": false, "errorCode": "…", "message": "…" }`

Probe references:

- WebDAV connection test: `server/infrastructure/webdavTest.js`.
- S3/WebDAV dest-config validation shaped for payloads: `buildDestBlobStore` (`server/infrastructure/adapters/blobstore/config.js:234-241`).
- PostgreSQL config resolution + missing-key errors: `resolvePgConfig` (`server/store/storage.js:32-47`).

#### POST /api/setup/apply

Public; **403 when already complete**. Validates every block (reusing `resolvePgConfig`/`buildDestBlobStore`-level checks; unknown keys rejected, `400` with per-field errors), then writes `.env` via the env writer and applies the admin-password effect.

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

**Behavior:**

1. Validate every block (reuse `resolvePgConfig`/`buildDestBlobStore`-level checks; reject unknown keys → `400` with per-field errors).
2. Write `.env` via envFileWriter: `WEA_STORAGE_BACKEND`, `WEA_PG_*` (if pg), `WEA_FILE_STORAGE`, `S3_*`/`AWS_*` or `WEBDAV_*`, `JWT_SECRET`, `JWT_EXPIRES_IN`, `PORT`, `CORS_ORIGINS` (if set), `EMAIL_*` (if set). Existing unknown keys are preserved (merge, not replace); file written atomically with mode `0600`; backup `<envPath>.bak-<ts>` on apply.
3. Admin password effect (D6):
   - `metadata.backend=postgresql` → also write `ADMIN_DEFAULT_PASSWORD=<chosen>`; on restart `ensureDefaultAdmin` creates `admin` in the fresh PG database with that password (existing bootstrap path, `server/store/bootstrap.js:8-29`).
   - `metadata.backend=sqlite` → admin already exists in the sqlite store from first boot; apply updates its password directly via the existing user store (single store call), so no restart dependency for the credential.
4. Respond **`200 { "restart_required": true }`**.

**Idempotency/safety:** apply refuses (`403`) once `setup_complete` is true; concurrent applies are last-writer-wins (documented, single-operator assumption).

### 2.5 Related Documents

- [api.md](../../../api.md)
- [shared-contracts.md](../../../shared-contracts.md)
- [setup-wizard.md (feature SoT)](../../../features/setup-wizard.md)

### 2.6 Error Codes

New codes added to `shared/serverMessageCodes.js`:

- `setup.incomplete` → `serverErrors.setup.incomplete` — returned as `503 { errorCode: 'setup.incomplete' }` by the setup-mode guard on file-domain and admin-write routes while setup is incomplete.
- `setup.complete` → `serverErrors.setup.complete` — returned as `403 { errorCode: 'setup.complete' }` by `POST /api/setup/test` and `POST /api/setup/apply` when setup is already complete.

### 2.7 Related Route Changes

`GET /api/settings/public` (`server/domains/admin/routes/settings.js:13-21`) is extended with `setup_complete: boolean` (derived from the same validator). The login page already fetches this endpoint (`client/src/pages/Login/hooks/useLoginForm.js:26-43`) → zero extra round-trip for the redirect-on-incomplete flow.

### 2.8 Integration Test Scenarios

- [ ] GET /status returns derived `{ setup_complete, missing, current }` with secrets masked
- [ ] Fresh (no env) → incomplete with the exact missing list; full s3+sqlite → complete; full pg+webdav → complete; prod + default JWT → incomplete
- [ ] POST /test passes through postgresql/s3/webdav probe results; error shapes are `{ ok: false, errorCode, message }`
- [ ] POST /apply happy path (sqlite+webdav / pg+s3) writes the expected `.env` lines with mode 0600
- [ ] POST /apply when already complete → 403 `setup.complete`
- [ ] POST /test when already complete → 403 `setup.complete`
- [ ] POST /apply with unknown keys / invalid payload → 400 with per-field errors
- [ ] Setup-mode guard: file-domain and admin-write routes → 503 `setup.incomplete` while incomplete; open again after completion
- [ ] Request logger does not leak apply body (bodies are never logged)
