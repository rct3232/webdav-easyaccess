# health routes Spec

## 1. Overview

| Item            | Description                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | Liveness/health surfaces. `GET /api/health` (public) stays a liveness probe and now includes per-backend status strings. `GET /api/admin/health` (admin) returns the full backend-health snapshot. |
| Source of truth | `docs/features/backend-health.md` (decisions B1, D3)                                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/healthRoutes.js` (existing, extended)
- **Admin source:** `server/domains/admin/routes/config.js` (or a new admin route) — `GET /api/admin/health`
- **Test file:** `server/infrastructure/routes/__tests__/healthRoutes.test.js`

### 2.2 GET /api/health (public)

**200:**

```jsonc
{
  "status": "ok",
  "messageCode": "serverMessages.api.healthOk",
  "activeFileStorage": "s3", // "s3" | "webdav" — effective WEA_FILE_STORAGE at boot (default "s3")
  "activeMetadataBackend": "postgresql", // "postgresql" | "sqlite" — effective WEA_STORAGE_BACKEND
  "backends": {
    "postgresql": "ok", // "ok" | "fail" | "unknown"
    "s3": "unknown",
    "webdav": "fail",
  },
}
```

- Backends come from `getHealth()`, reduced to the **status string only** — never codes, hints,
  reasons, or secrets (D3/D8).
- `activeFileStorage` is the effective file-storage backend (`process.env.WEA_FILE_STORAGE`, which
  `configResolver.populateT1Env` refreshes from env → DB at boot; default `'s3'` when unset). It is
  additive and public so any authenticated client can decide whether the ACTIVE file backend is
  failing without needing the admin-only config endpoint.
- `activeMetadataBackend` is the effective metadata backend (`process.env.WEA_STORAGE_BACKEND`,
  normalized to `'postgresql'`/`'sqlite'`, default `'sqlite'`). The file-screen banner uses it to
  also cover a failing metadata DB (postgresql).

### 2.3 GET /api/admin/health (admin)

`authenticateToken` + a **stateless** admin check (the JWT `is_admin` claim — no DB-backed
`User.findById` lookup), so the endpoint stays reachable during a metadata-DB outage and the admin
health card can display the failure. Mounted under `/api/admin` (behind `setupModeGuard`).

**200:**

```jsonc
{
  "backends": {
    "postgresql": {
      "status": "ok",
      "code": undefined,
      "reason": undefined,
      "hint": undefined,
      "lastCheckedAt": 1725000000000,
      "firstFailedAt": undefined,
      "consecutiveFailures": 0,
    },
    "s3": {
      "status": "unknown",
      "code": undefined,
      "reason": undefined,
      "hint": undefined,
      "lastCheckedAt": undefined,
      "firstFailedAt": undefined,
      "consecutiveFailures": 0,
    },
    "webdav": {
      "status": "fail",
      "code": "unreachable",
      "reason": "ECONNREFUSED 127.0.0.1:8090",
      "hint": "Cannot reach the WebDAV server",
      "lastCheckedAt": 1725000000000,
      "firstFailedAt": 1724999900000,
      "consecutiveFailures": 3,
    },
  },
}
```

**Errors:** 401 unauthenticated; 403 non-admin.

---

## 3. Verification Scenarios

- [ ] `GET /api/health` returns `{ status, messageCode, activeFileStorage, activeMetadataBackend, backends }` with only status strings for the three backends and `activeFileStorage` ∈ `{s3, webdav}`, `activeMetadataBackend` ∈ `{postgresql, sqlite}`
- [ ] `GET /api/admin/health` 401 unauthenticated; 403 non-admin (JWT claim, no DB read — works while the DB is down)
- [ ] `GET /api/admin/health` 200 returns the full snapshot for the three backends
