# config routes Spec

## 1. Overview

| Item       | Description                                                                                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/admin` (mounted by `server/index.js` behind `setupModeGuard`, alongside the other admin routes)                                                                                                                                                                                        |
| Role       | Operator-facing config management (admin "Advanced settings" accordion): `GET` returns the **effective config** (env → DB → default, per `configResolver`) with secrets masked, `source`/`tier`/`secret` per registry key; `PUT` writes allowlisted non-T0 keys to the DB `settings` table (secrets encrypted), then invalidates the T2 resolver cache. |

Feature Source-of-Truth: [config-source-resolution.md](../../../features/config-source-resolution.md).
Registry / resolver contracts: `docs/spec/server/infrastructure/configRegistry.md`, `docs/spec/server/infrastructure/configResolver.md`.

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/routes/config.js` (new), mounted at `/api/admin` in `server/index.js`
- **Resolver:** `server/infrastructure/configResolver.js` — `getSharedResolver().getEffectiveConfig()` / `.invalidateCache(keys)`
- **Registry:** `server/infrastructure/configRegistry.js` — `getEntry(key)`, `isT0(key)`, `isTier(key, tier)`, `isSecret(key)`, `TIER`
- **Encryption:** `server/utils/configEncryption.js` — `encryptSecret(plaintext, passphrase)`
- **Test file:** `server/domains/admin/routes/__tests__/config.test.js`

### 2.2 Route List

| Method | Path     | Auth              | Description                                                                                 |
| ------ | -------- | ----------------- | ------------------------------------------------------------------------------------------- |
| GET    | `/config` | Token + Admin     | Effective config: masked secrets, `value`/`source`/`tier`/`secret` for every registry key.  |
| PUT    | `/config` | Token + Admin     | Allowlisted non-T0 keys → DB `settings`, secrets encrypted, T2 cache invalidated.            |

### 2.3 Middleware Used

- `authenticateToken` + `isAdmin` (cloned from `server/domains/admin/routes/settings.js:24-30` — `User.findById(req.user.id)`, throws `serverErrors.admin.adminRequired` → 403 when not admin).
- The setup-mode guard (503 `setup.incomplete`) is applied at mount time in `server/index.js`, so the admin config surface is reachable only when setup is complete.

### 2.4 Request/Response Spec

#### GET /api/admin/config

**200:**

```jsonc
{
  "config": {
    "EMAIL_HOST":   { "value": "smtp.gmail.com", "source": "db",   "tier": "T1", "secret": false },
    "EMAIL_PASSWORD": { "value": "****",          "source": "db",   "tier": "T1", "secret": true },
    "PORT":         { "value": "5001",           "source": "default", "tier": "T1", "secret": false },
    "CORS_ORIGINS": { "value": "",               "source": "default", "tier": "T2", "secret": false },
    "WEA_PG_HOST":  { "value": "db.internal",    "source": "env",  "tier": "T0", "secret": false }
  },
  "key_lost_warning": false
}
```

- One entry per registry key (`configRegistry.getEntries()`), iterated in registry order.
- `value` — the **effective** value: env (when set, D1) → DB `settings` row (decrypted for secrets) → built-in default. Secret keys are always the mask `"****"` (never decrypted to the client).
- `source` — `'env'` | `'db'` | `'default'` (the layer that supplied `value`).
- `tier` — `'T0'` | `'T1'` | `'T2'` (registry classification, PLAN §3).
- `secret` — boolean; true ⇒ encrypted at rest, masked on read.
- `key_lost_warning` — boolean; **true** when any `settings` row holds an encrypted payload (shape-only detection via `isEncryptedPayload`) **and** `process.env.encrypt_secret_key` is absent — the encrypted DB secrets are undecryptable. Mirrors the wizard's `key_lost_warning` semantics (`docs/spec/server/routes/setup.md`) so the admin UI can warn the operator.

**Errors:** none (auth/admin guard only).

#### PUT /api/admin/config

**Request:**

```jsonc
{ "values": { "<envKey>": <value> } }
```

Only changed keys are sent by the client; `values` must be a non-null object (not an array). Each key must be a registry key and non-T0.

**Validation (per key, in order):**

| Condition                          | Result                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `values` is null / non-object / array | `400 { errorCode: 'serverErrors.admin.configInvalidPayload' }`        |
| Unknown key (not in registry)      | `400 { errorCode: 'serverErrors.admin.configUnknownKey', params: { key } }` |
| T0 key (`isT0(key)`)               | `400 { errorCode: 'serverErrors.admin.configT0Protected', params: { key } }` — `.env`-only per D2/D4/D7. **400, not 403** (client error, not auth). |
| Current `source === 'env'` (from `getEffectiveConfig()`) | `400 { errorCode: 'serverErrors.admin.configEnvSourcedProtected', params: { key } }` — a DB copy would be silently shadowed by the env value (F4). Mirrors the UI's read-only rule for `source=env` rows. |

Validation is sequential and all-or-nothing: the first failing key aborts the request before any write. The `getEffectiveConfig()` snapshot is taken once before the loop; a key is rejected only when its **current** effective source is `'env'`. DB-backed T1 keys mirrored into `process.env` at boot (`populateT1Env` → `markDbSourced`) report `source: 'db'`, so they remain writable.

**Write (per valid key):**

- **secret key** (`isSecret(key)`):
  - value `undefined` / `null` / `''` / `'****'` → **skip** (keep existing ciphertext — "only re-encrypt on new value", PLAN §7 rule 3). The key is not counted as changed and does not trigger cache invalidation.
  - otherwise require `process.env.encrypt_secret_key`; when absent → `500 { errorCode: 'serverErrors.admin.configEncryptKeyMissing' }` (secrets cannot be encrypted without the master key; the wizard generates it, PLAN Q4).
  - `const payload = encryptSecret(String(value), process.env.encrypt_secret_key); await Settings.set(key, JSON.stringify(payload));`
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
  "messageCode": "serverMessages.admin.configSaved"
}
```

- `applied` — T2 keys written (effective immediately).
- `restartRequired` — T1 keys written (require restart).

**source=env semantics:** the server **refuses** (400 `configEnvSourcedProtected`) a write to a key whose current effective source is `'env'` — a DB copy would be silently shadowed while the env var keeps winning (D1/F4). This matches the UI, which renders `source=env` rows read-only. DB-backed T1 keys populated at boot remain writable (`source: 'db'`). `registration_enabled` is a valid non-T0 (T2) registry key and is writable by this generic route, but the admin UI keeps it in the main settings rows and never shows it in the accordion.

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
- `admin.configEncryptKeyMissing` → `serverErrors.admin.configEncryptKeyMissing` — `500`, `encrypt_secret_key` absent while writing a new secret value.
- `admin.configEnvSourcedProtected` → `serverErrors.admin.configEnvSourcedProtected` — `400`, PUT value's current effective source is `'env'` (F4).

New message code added to `shared/serverMessageCodes.js`:

- `admin.configSaved` → `serverMessages.admin.configSaved` — `200` PUT success message code.

### 2.7 Integration Test Scenarios

- [ ] GET returns effective config with masked secrets and `value`/`source`/`tier`/`secret` per key
- [ ] GET returns `key_lost_warning` (`true` when encrypted rows exist without `encrypt_secret_key`, else `false`)
- [ ] GET/PUT unauthenticated → 401
- [ ] PUT unknown key → 400 `configUnknownKey`; PUT T0 key → 400 `configT0Protected` (not 403)
- [ ] PUT `source=env` key → 400 `configEnvSourcedProtected`; DB-sourced key remains writable
- [ ] PUT plaintext T2 key → `Settings.set(key, String(value))`, cache invalidated, `applied` lists the key
- [ ] PUT plaintext T1 key → written, cache invalidated, `restartRequired` lists the key
- [ ] PUT secret `'****'` / blank / null / undefined → skipped (`Settings.set` not called, cache not invalidated)
- [ ] PUT secret new value → `Settings.set` called with a JSON-stringified AES-256-GCM payload that decrypts back to the value; cache invalidated
- [ ] PUT secret new value without `encrypt_secret_key` → 500 `configEncryptKeyMissing`; nothing written
