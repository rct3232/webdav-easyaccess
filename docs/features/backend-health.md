# Backend Health Alerts & Config Guard

Source-of-Truth for the Phase B feature: operator visibility into DB/S3/WebDAV health,
connection-key save gating, a k3s-safe boot rule, and wizard scope. Decisions D1–D8
(finalized 2026-08-31) live in `PLAN.md` (Phase B).

Detailed contracts:

- `docs/spec/server/infrastructure/backendHealth.md` — in-memory tracker + classification.
- `docs/spec/server/routes/health.md` — `GET /api/health`, `GET /api/admin/health`.
- `docs/spec/server/routes/config.md` — `POST /api/admin/config/test`.
- `docs/spec/server/routes/setup.md` — D7 wizard scope (non-T0 only).
- `docs/spec/server/infrastructure/bootSequence.md` — D6 boot rule.
- `docs/spec/client/components/SystemConfigEditor.md` — D5 (T0 removal) + D1 (connection gating).
- `docs/spec/client/components/SystemSettingsContent.md`, `docs/spec/client/components/file-manager/FileManagerView.md` — D3 surfaces.

---

## Overview

After `setup_complete=true` there was no operator-visible surface for missing/broken critical
backends (only a per-user 500 toast). This feature adds:

1. **Passive, event-based health detection (D2)** — any PG/S3/WebDAV access attempt that fails
   records to an in-memory tracker (classified); any success marks the backend OK
   (self-recovery). No active polling. Admin login + file-manager load naturally exercise all
   three backends.
2. **Surfaces (D3)** — Admin: System Settings top status card + file-screen admin-only banner.
   The card appears **only when an in-use backend is failing** and lists **only the failing
   in-use backends** (name + `admin.health.fail` + classification hint/code + last-checked);
   healthy/unknown backends are never listed, and **backends that are not currently active are
   never listed** (active = metadata backend `WEA_STORAGE_BACKEND` + file backend
   `WEA_FILE_STORAGE`). The boot WebDAV probe runs only when WebDAV is the active file backend,
   so an unused backend cannot produce a false alert. Terminal: transition-only logs
   (`[backend-health] … OK→FAIL / FAIL→OK`). Normal user: friendly message only for
   connection-class failures (`files.storageUnavailable`); existing 404/403/etc. keep current
   messages; DB-down → maintenance notice.
3. **Connection-key save gating (D1)** — editing a connection key in Advanced settings blocks
   Save until a connection test **with the pending values** passes; changing a connection key
   invalidates the result. Non-connection keys don't require a test.
4. **Boot rule (D6)** — `WEA_STORAGE_BACKEND` unset → sqlite (kept); explicit `sqlite` →
   allowed; `postgresql` → `WEA_PG_HOST/PORT/DATABASE/USER/PASSWORD` required; incomplete →
   clear terminal `[config]` error + `process.exit(1)` (the DB connection is `.env`-owned).
5. **Wizard scope (D7)** — wizard serves **non-T0 only**: reachable when the DB is connected but
   non-T0 config is incomplete. The `.env → sqlite wizard` first-boot path is removed (the DB
   connection is `.env`/env-owned).

---

## Detection model (D2)

| Backend      | Failure hook                                                                                        | Success hook                                   |
| ------------ | --------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `postgresql` | `mapDatabaseError` (when `getBackend()==='postgresql'`), pool `error` handler                       | `withTransaction` connect/commit, pool connect |
| `s3`         | `S3BlobStore` operation catch                                                                       | `S3BlobStore` operation resolve                |
| `webdav`     | `webdavTest.testConnection` throw, `WebdavBlobStore` catch, `utils/webdav.js` `listDirectory` catch | corresponding success                          |

Classification is reused from the wizard probe machinery (`classifyPgError` /
`classifyS3Error` / webdav `webdav.*` codes), normalized to a stable `code`
(`unreachable` | `auth` | `missing_resource` | `unknown`) + a human `hint`.

## Connection keys (D1)

- **S3**: `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT`
- **WebDAV**: `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`, `WEBDAV_AUTH_TYPE`

## Save gating (D1)

`POST /api/admin/config/test` takes a **subset** of pending values; the server merges them over
the current effective config (env → DB) before probing, so an unchanged masked secret falls back
to the stored value. Non-connection keys save without a test.

## Security

- Public `GET /api/health` exposes only per-backend status strings (`ok`/`fail`/`unknown`) —
  no codes, hints, or secrets.
- `GET /api/admin/health` (admin-only) exposes the full tracker snapshot (code/hint/last-checked).
- User-facing messages never leak backend internals (D8).

---

## Testing anchors

- Backend failure from any user attempt records to the tracker; admin sees the card/banner;
  terminal logs only transitions; user sees the friendly message for connection-class failures.
- k3s boot with `postgresql` + incomplete `WEA_PG_*` → clear terminal error + `exit(1)`.
- Editing a connection key cannot Save until a pending-values test passes; non-connection keys
  save without a test.
- No schema change; server + client `test:ci` and the E2E suites stay green.
