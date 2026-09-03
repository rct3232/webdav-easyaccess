# config routes Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/admin` (mounted by `server/index.js` behind `setupModeGuard`, alongside the other admin routes)                                                                                                                                                                                                                                                   |
| Role       | Operator-facing config management (admin "Advanced settings" accordion): `GET` returns the **effective config** (env → DB → default, per `configResolver`) with secrets masked, `source`/`tier`/`secret` per registry key; `PUT` writes allowlisted non-T0 keys to the DB `settings` table as plaintext strings, then invalidates the T2 resolver cache. |

Feature Source-of-Truth: [config-source-resolution.md](../../../features/config-source-resolution.md).
Registry / resolver contracts: `docs/spec/server/infrastructure/configRegistry.md`, `docs/spec/server/infrastructure/configResolver.md`.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/routes/config.js` (new), mounted at `/api/admin` in `server/index.js`
- **Shared config-sync core:** `server/domains/admin/services/configSyncService.js` — `buildConfigSyncReport({ settings, envValueOf })` and `syncConfigSyncEnv({ settings, envValueOf })`; reused by the CLI `server/scripts/configSync.js`
- **Resolver:** `server/infrastructure/configResolver.js` — `getSharedResolver().getEffectiveConfig()` / `.invalidateCache(keys)`
- **Registry:** `server/infrastructure/configRegistry.js` — `getEntry(key)`, `isT0(key)`, `isTier(key, tier)`, `isSecret(key)`, `TIER`
- **Test file:** `server/domains/admin/routes/__tests__/config.test.js`

### 2.2 Route List

| Method | Path                   | Auth          | Description                                                                                                                                    |
| ------ | ---------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/config`              | Token + Admin | Effective config: masked secrets, `value`/`source`/`tier`/`secret` per registry key.                                                           |
| PUT    | `/config`              | Token + Admin | Allowlisted non-T0 keys → DB `settings` as plaintext strings, T2 cache invalidated.                                                            |
| POST   | `/config/test`         | Token + Admin | Connection test **with pending values** for a file-storage backend (s3/webdav); reuses the wizard probe/classification. Serves D1 save gating. |
| GET    | `/config/sync-report`  | Token + Admin | Read-only env↔DB drift report (config-sync classification) over the **running process environment**.                                            |
| POST   | `/config/sync-from-env`| Token + Admin | Reconcile: mirror env-sourced non-T0 registry values into DB `settings` (plaintext), then invalidate the T2 cache.                             |

### 2.3 Middleware Used

- `authenticateToken` + `isAdmin` (cloned from `server/domains/admin/routes/settings.js:24-30` — `User.findById(req.user.id)`, throws `serverErrors.admin.adminRequired` → 403 when not admin).
- The setup-mode guard (503 `setup.incomplete`) is applied at mount time in `server/index.js`, so the admin config surface is reachable only when setup is complete.

### 2.4 Request/Response Spec

#### GET /api/admin/config

**200:**

```jsonc
{
  "config": {
    "EMAIL_HOST": { "value": "smtp.gmail.com", "source": "db", "tier": "T1", "secret": false },
    "EMAIL_PASSWORD": { "value": "****", "source": "db", "tier": "T1", "secret": true },
    "PORT": { "value": "5001", "source": "default", "tier": "T1", "secret": false },
    "CORS_ORIGINS": { "value": "", "source": "default", "tier": "T2", "secret": false },
    "WEA_PG_HOST": { "value": "db.internal", "source": "env", "tier": "T0", "secret": false },
  }
}
```

- One entry per registry key (`configRegistry.getEntries()`), iterated in registry order.
- `value` — the **effective** value: env (when set, D1) → DB `settings` row (plaintext, as stored) → built-in default. Secret keys are always the mask `"****"` (never surfaced to the client; DB rows are plaintext but masked at this boundary).
- `source` — `'env'` | `'db'` | `'default'` (the layer that supplied `value`).
- `tier` — `'T0'` | `'T1'` | `'T2'` (registry classification, PLAN §3).
- `secret` — boolean; true ⇒ masked on read (presentation only). It does **not** imply encryption at rest.

**Errors:** none (auth/admin guard only).

#### PUT /api/admin/config

**Request:**

```jsonc
{ "values": { "<envKey>": <value> } }
```

Only changed keys are sent by the client; `values` must be a non-null object (not an array). Each key must be a registry key and non-T0.

**Validation (per key, in order):**

| Condition                                                | Result                                                                                                                                                                                                    |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `values` is null / non-object / array                    | `400 { errorCode: 'serverErrors.admin.configInvalidPayload' }`                                                                                                                                            |
| Unknown key (not in registry)                            | `400 { errorCode: 'serverErrors.admin.configUnknownKey', params: { key } }`                                                                                                                               |
| T0 key (`isT0(key)`)                                     | `400 { errorCode: 'serverErrors.admin.configT0Protected', params: { key } }` — `.env`-only per D2/D4/D7. **400, not 403** (client error, not auth).                                                       |
| Current `source === 'env'` (from `getEffectiveConfig()`) | `400 { errorCode: 'serverErrors.admin.configEnvSourcedProtected', params: { key } }` — a DB copy would be silently shadowed by the env value (F4). Mirrors the UI's read-only rule for `source=env` rows. |

Validation is sequential and all-or-nothing: the first failing key aborts the request before any write. The `getEffectiveConfig()` snapshot is taken once before the loop; a key is rejected only when its **current** effective source is `'env'`. DB-backed T1 keys mirrored into `process.env` at boot (`populateT1Env` → `markDbSourced`) report `source: 'db'`, so they remain writable.

**Write (per valid key):**

- **secret key** (`isSecret(key)`):
  - value `undefined` / `null` / `''` / `'****'` → **skip** (keep existing stored value — masked input never overwrites it). The key is not counted as changed and does not trigger cache invalidation.
  - otherwise persist the new plaintext value: `await Settings.set(key, String(value));`
- **plaintext key:** `await Settings.set(key, String(value));`

Tier classification after a successful write:

- **T2 key** → applied immediately (lazy runtime read).
- **T1 key** → stored, **restart required** (boot-frozen snapshot).

**After all writes:** `getSharedResolver().invalidateCache(changedKeys)` (only when at least one key was actually written).

**200:**

```jsonc
{
  "applied": ["CORS_ORIGINS"],
  "restartRequired": ["EMAIL_HOST"],
  "messageCode": "serverMessages.admin.configSaved",
}
```

- `applied` — T2 keys written (effective immediately).
- `restartRequired` — T1 keys written (require restart).

**source=env semantics:** the server **refuses** (400 `configEnvSourcedProtected`) a write to a key whose current effective source is `'env'` — a DB copy would be silently shadowed while the env var keeps winning (D1/F4). This matches the UI, which renders `source=env` rows read-only. DB-backed T1 keys populated at boot remain writable (`source: 'db'`). `registration_enabled` is a valid non-T0 (T2) registry key and is writable by this generic route, but the admin UI keeps it in the main settings rows and never shows it in the accordion.

#### POST /api/admin/config/test

**Request:**

```jsonc
{
  "target": "s3" | "webdav",
  "S3_BUCKET": "my-bucket",          // pending values (subset — any connection key)
  "AWS_REGION": "us-east-1",
  "WEBDAV_URL": "https://dav.example.com"
}
```

- `target` selects the probe; the remaining keys are the **pending values subset** (D1). The
  server **merges them over the current effective config** (env → DB) before probing, so an
  unchanged masked secret falls back to the stored value.
- Reuses the wizard probe machinery (`server/infrastructure/backendProbe.js`): `runProbe(target, payload)`.

**200:**

```jsonc
{ "ok": true }
```

**Failure (non-2xx, same shape as `POST /api/setup/test`):**

```jsonc
{
  "ok": false,
  "errorCode": "serverErrors.setup.test.s3.accessDenied",
  "message": "Connection test failed",
  "reason": "AccessDenied",
}
```

- `errorCode` — the classified probe i18n key (`serverErrors.setup.test.*`).
- `message` — `"Connection test failed"` or a specific message.
- `reason` — short diagnostic (≤200 chars), only when derivable.

**Errors:** 401 unauthenticated; 403 non-admin; the route sits behind `setupModeGuard` (503 while setup incomplete). Missing required fields / unsupported target → 400 `serverErrors.setup.testFailed`.

#### GET /api/admin/config/sync-report

Admin web preview for the config-sync action (System settings → "Sync environment → DB").
Read-only. Feature SoT: `docs/features/config-sync.md`.

**Env source:** the **running process environment** (`process.env`). A registry key is
env-set when the **effective resolver reports `source: 'env'`** for it (`getEffectiveConfig()`,
taken once per request). This is the authoritative test — it excludes the T1 DB values that
`populateT1Env` copies into `process.env` at boot (`markDbSourced` → `source: 'db'`), so
presence in `process.env` alone never makes a key a sync target. The `.env` file on disk is
never read.

**Algorithm:** shared core `server/domains/admin/services/configSyncService.js`
(`buildConfigSyncReport({ settings, envValueOf })`) — the same classification the
CLI `--check` uses, over the non-T0 registry universe (T0 excluded):

| Status     | Meaning                                                            |
| ---------- | ------------------------------------------------------------------ |
| `differs`  | env-set + DB row + values differ (secrets compared as plaintext)   |
| `shadowed` | env-set + DB row + values equal                                    |
| `env-only` | env-set + no DB row                                                |
| `db-only`  | not env-set + DB row                                               |

**200:**

```jsonc
{
  "findings": [
    { "key": "PORT", "status": "differs", "secret": false, "dbUpdatedAt": "2026-09-03T00:00:00.000Z" },
    { "key": "CORS_ORIGINS", "status": "env-only", "secret": false, "dbUpdatedAt": null }
  ],
  "summary": { "drift": 1, "shadowed": 0, "envOnly": 1, "dbOnly": 0, "total": 2 },
  "exitCode": 1
}
```

- `findings`/`summary`/`exitCode` match the CLI `--json` document; `exitCode` = 1 iff
  `drift > 0`. `dbUpdatedAt` is the row's `updated_at` as an ISO string (`null` for
  env-only findings). Secret keys are reported with `secret: true` and **no value is ever
  emitted**.
- Findings are ordered in registry order; keys set in neither env nor DB are silent.

**Errors:** none beyond auth/admin (401/403).

#### POST /api/admin/config/sync-from-env

Reconciles the DB shadow rows to mirror the running environment — the web equivalent of the
CLI `--apply --yes` over the resolver-classified env source. Feature SoT:
`docs/features/config-sync.md`.

**Algorithm:** shared core `server/domains/admin/services/configSyncService.js`
(`syncConfigSyncEnv({ settings, envValueOf })`):

1. **Write loop (registry order):** targets = non-T0 registry keys with resolver
   `source: 'env'` and a non-empty `process.env` value. Per target, compare the env value
   to the current DB row (both sides plaintext strings). Equal → report `unchanged`, skip.
   Otherwise upsert through the same path as `PUT /api/admin/config`:
   `Settings.set(key, String(envValue))` (plaintext, secrets included), reporting
   `updated`. T0 keys are never written; rows are never deleted.
2. **Post-apply recheck:** the check runs in-process against the live store and is returned
   as `report`.
3. **Cache:** `getSharedResolver().invalidateCache(updatedKeys)` so the running server
   observes the new rows immediately (the CLI relies on restart/next read because it runs
   out-of-band).

**200:**

```jsonc
{
  "writes": [
    { "key": "PORT", "secret": false, "status": "updated" },
    { "key": "CORS_ORIGINS", "secret": false, "status": "updated" }
  ],
  "report": {
    "findings": [],
    "summary": { "drift": 0, "shadowed": 0, "envOnly": 0, "dbOnly": 0, "total": 0 },
    "exitCode": 0
  },
  "messageCode": "serverMessages.admin.configSyncDone"
}
```

**Errors:**

| Condition                                                                                            | Result                                                                                       |
| ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| write failure (DB)                                                                                    | 500 through the central error handler                                                        |
| unauthenticated / non-admin / setup-mode guard                                                         | 401 / 403 / 503 (as for the other config routes)                                             |

### 2.5 Related Documents

- [api.md](../../../api.md)
- [config-source-resolution.md (SoT)](../../../features/config-source-resolution.md)
- [configRegistry.md](../../infrastructure/configRegistry.md)
- [configResolver.md](../../infrastructure/configResolver.md)

### 2.6 Error Codes

New codes added to `shared/serverMessageCodes.js`:

- `admin.configUnknownKey` → `serverErrors.admin.configUnknownKey` — `400`, PUT value references a non-registry key.
- `admin.configT0Protected` → `serverErrors.admin.configT0Protected` — `400`, PUT value references a T0 (`.env`-only) key.
- `admin.configInvalidPayload` → `serverErrors.admin.configInvalidPayload` — `400`, `values` is not a non-null object.
- `admin.configEnvSourcedProtected` → `serverErrors.admin.configEnvSourcedProtected` — `400`, PUT value's current effective source is `'env'` (F4).

New message code added to `shared/serverMessageCodes.js`:

- `admin.configSaved` → `serverMessages.admin.configSaved` — `200` PUT success message code.
- `admin.configSyncDone` → `serverMessages.admin.configSyncDone` — `200` `POST /config/sync-from-env` success message code.

### 2.7 Integration Test Scenarios

- [ ] GET returns effective config with masked secrets and `value`/`source`/`tier`/`secret` per key
- [ ] GET/PUT unauthenticated → 401
- [ ] PUT unknown key → 400 `configUnknownKey`; PUT T0 key → 400 `configT0Protected` (not 403)
- [ ] PUT `source=env` key → 400 `configEnvSourcedProtected`; DB-sourced key remains writable
- [ ] PUT plaintext T2 key → `Settings.set(key, String(value))`, cache invalidated, `applied` lists the key
- [ ] PUT plaintext T1 key → written, cache invalidated, `restartRequired` lists the key
- [ ] PUT secret `'****'` / blank / null / undefined → skipped (`Settings.set` not called, cache not invalidated)
- [ ] PUT secret new value → `Settings.set` called with the plaintext `String(value)`; cache invalidated
- [ ] GET sync-report returns `findings`/`summary`/`exitCode` with env-set keys driven by the resolver's `source: 'env'` (DB-only T1 keys populated into `process.env` at boot are NOT reported as env-set)
- [ ] POST sync-from-env mirrors env-sourced non-T0 keys into DB as plaintext (secrets included), T0 keys never written, rows not deleted, response `writes` + clean `report` + `messageCode: configSyncDone`
- [ ] POST sync-from-env invalidates the resolver cache for the written keys
