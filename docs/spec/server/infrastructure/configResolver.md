# configResolver Spec

## 1. Overview

| Item        | Description                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role        | Resolves the effective configuration value for any registered key using the D1 chain `.env → DB settings row → built-in default`, with per-tier source rules, a small TTL cache for T2 reads, and a masked effective-config report for the admin GET and setup status. DB `settings` rows hold plaintext values — there is no field-level encryption at rest and no decryption on read. |
| Consumed by | the boot path (`populateT1Env` env mirror at server/index.js:254), the admin config API (server/domains/admin/routes/config.js), and setup routes / setup status (`computeSetupStatus` consumes the `getEffectiveConfig` map). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/configResolver.js`
- **Test file:** `server/infrastructure/__tests__/configResolver.test.js`

### 2.2 Factory / Public API

| Method                 | Signature                                                          | Description                                                                                                                                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `createConfigResolver` | `({ settingsStore, env = process.env, ttlMs = 5000 }) => resolver` | Factory. `settingsStore` must expose `get(key)` and `getAll()` (see §2.4). Throws `TypeError` when the store contract is not met.                                                                                                                 |
| `getConfig`            | `async (key) => value \| undefined`                                | Resolved value for one key. String for config keys; for `registration_enabled` the raw DB boolean (or string) is passed through; `undefined` when unresolvable. Never returns a default for `registration_enabled`.                               |
| `getConfigSync`        | `(key) => value \| undefined`                                      | Synchronous read for require-time consumers: env → cached DB row → default. DB values are visible only after `loadAll()` or an async read seeded the cache.                                                                           |
| `getEffectiveConfig`   | `async () => { key: { value, source, tier, secret } }`             | Every registry entry. Secrets are **always** `'****'` (never surfaced in plaintext). `source` ∈ `'env' \| 'db' \| 'default'`.                                                                                                                                 |
| `invalidateCache`      | `(keys?) => void`                                                  | Drop the cached rows for the given key(s); all cached rows when called with no arguments.                                                                                                                                                         |
| `loadAll`              | `async () => void`                                                 | Prime the DB row cache from `settingsStore.getAll()` (bulk read) — called at boot before serving.                                                                                                                                                 |
| `getSharedResolver`    | `() => resolver`                                                   | The process-wide resolver instance. Lazily created with `settingsStore = Settings` model on first call (no DB connection at require time). Used by the boot path, the admin config route, and T2 consumers so writes invalidate one shared cache. |
| `setSharedResolver`    | `(resolver) => void`                                               | Install a boot-primed instance (after `loadAll`); also the test hook.                                                                                                                                                                             |
| `markDbSourced`        | `(keys: string[]) => void`                                         | Record keys whose `env` value is a **boot mirror** copied from the DB by `populateT1Env`. For these keys the resolver treats the DB row as the source (env-first is skipped) so the admin config UI reports `source:'db'` and stays editable.     |

### 2.3 Resolution Rule

```
getConfig(key):
  1. entry = registry.getEntry(key); unknown key → undefined
  2. env value present (defined and non-empty) → return it            # env wins, no DB read
  3. entry.tier === T0 → undefined                                     # .env only (no DB, no default)
  4. DB row (cache-aware):
        - secret key or plaintext key → use the stored row value as-is
        - row missing → fall through
  5. entry.default (when defined) → return it; else undefined
```

- **Env precedence (D1):** an env value always wins and the DB is not touched. For secrets, an env value means "do not even read the DB".
- **Boot-mirrored T1 keys (`markDbSourced`):** `populateT1Env` copies DB-sourced T1 values into `process.env` so require-time consts see them. Those keys are recorded as DB-sourced, so the resolver **skips the env-first step** for them — the DB row is the source (`'db'`), the env copy is just a boot mirror. Without this, every DB-backed T1 key would report `source:'env'` and the admin UI would lock it. A genuinely operator-set env value (present before boot population) is never mirrored and keeps `source:'env'`.
- **Empty-string env values** are treated as unset (matches codebase `process.env.X || default` conventions).
- **DB value shapes (D11):** `settings` rows store plaintext values — a JSON string on PG (parsed back to the string by the store on read) and raw TEXT on sqlite. The resolver returns a row's value **as stored**; there is no payload shape to detect and no master key dependency.
- **`registration_enabled`:** the raw stored value (JSON boolean or string) is passed through; a boolean is returned as-is (boolean passthrough); no coercion, no default.

### 2.4 settingsStore Contract

The resolver reads **only** through the injected store. Public API it relies on:

| Method   | Signature                      | Behavior                                                                                                                                                                      |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`    | `async (key) => value \| null` | Returns the `settings` row value or `null`. PG: the parsed JSONB value (a string for plaintext rows). SQLite: the raw TEXT. Errors are wrapped via `mapDatabaseError`. |
| `getAll` | `async () => { key: value }`   | Bulk read of all settings rows; `updated_at` excluded.                                                                                                                        |

(The store also exposes `set` and `isRegistrationEnabled`; the resolver does **not** use them.)

### 2.5 Cache

- In-memory per-key map of **raw DB rows** (`{ value, loadedAt }`).
- `getConfig` checks env first; only when env is absent does it consult the row cache / `settingsStore.get`.
- TTL backstop: a cached row is used only when `now - loadedAt < ttlMs` (default 5000ms). Expired rows are re-read from the store.
- `invalidateCache()` (admin/wizard write path) clears immediately; `invalidateCache(keys)` clears the listed keys.
- `getEffectiveConfig()` and `loadAll()` perform a single bulk `getAll()` and **seed** the per-key cache from that snapshot.
- Single-instance assumption (Q2). No cross-process invalidation.

### 2.6 Behavior of `getEffectiveConfig`

For each registry entry, resolved with the same rule as `getConfig` against a single `getAll()` snapshot:

| condition           | value                                                                | source      |
| ------------------- | -------------------------------------------------------------------- | ----------- |
| env set (non-empty) | env value (or `'****'` if secret)                                    | `'env'`     |
| tier T0, env unset  | `undefined` (or `'****'` if secret)                                  | `'env'`     |
| DB row resolves     | stored row value (or `'****'` if secret)                             | `'db'`      |
| otherwise           | `entry.default` (or `'****'` if secret; `undefined` when no default) | `'default'` |

Secrets are never surfaced to this call — `value` is always `'****'`, while `source`/`tier`/`secret` remain truthful. Masking is driven purely by the registry `secret` flag; rows are plaintext.

## 3. Dependencies

- `configRegistry` (entries/tiers).
- No DB module imports — the store is injected (testable with a fake store).

## 4. Edge Cases

- Secret rows are stored plaintext and returned as stored — no master key is read, nothing to decrypt.
- A `settings` row value that is not a plain string (e.g. a JSON value) is returned as the store parsed it (see the `registration_enabled` passthrough).
- T0 key with no env → `undefined`, no default applied.
- Unknown key → `undefined` from `getConfig`; excluded from `getEffectiveConfig` output.

## 5. Verification Scenarios

- [ ] env wins over DB and over default.
- [ ] DB fallback when env absent.
- [ ] default fallback when neither env nor DB has the key.
- [ ] `getEffectiveConfig` masks secrets and reports source/tier.
- [ ] `invalidateCache` + TTL reload re-read the store.
- [ ] `registration_enabled` boolean passthrough.
- [ ] `getConfigSync` serves env/cached-DB/default with no DB reads.
- [ ] `setSharedResolver`/`getSharedResolver` return the installed instance.
