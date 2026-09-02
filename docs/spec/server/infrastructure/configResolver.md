# configResolver Spec

## 1. Overview

| Item        | Description                                                                                                                                                                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role        | Resolves the effective configuration value for any registered key using the D1 chain `.env → DB settings row → built-in default`, with per-tier source rules, on-the-fly decryption of DB secrets (only when env absent), a small TTL cache for T2 reads, and a masked effective-config report for the admin GET and setup status. |
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
| `getConfigSync`        | `(key) => value \| undefined`                                      | Synchronous read for require-time consumers: env → cached DB row (decrypted) → default. DB values are visible only after `loadAll()` or an async read seeded the cache.                                                                           |
| `getEffectiveConfig`   | `async () => { key: { value, source, tier, secret } }`             | Every registry entry. Secrets are **always** `'****'` (never decrypted). `source` ∈ `'env' \| 'db' \| 'default'`.                                                                                                                                 |
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
       - secret key:
         - row is an encrypted payload (object, or JSON string thereof) → decrypt with
           env.encrypt_secret_key; if the key is missing → undefined (never throw);
           decryption failure → undefined
         - legacy plaintext string → use as-is
       - plaintext key → use row value as-is
       - row missing → fall through
  5. entry.default (when defined) → return it; else undefined
```

- **Env precedence (D1):** an env value always wins and the DB is not touched. For secrets, an env value means "do not even decrypt".
- **Boot-mirrored T1 keys (`markDbSourced`):** `populateT1Env` copies DB-sourced T1 values into `process.env` so require-time consts see them. Those keys are recorded as DB-sourced, so the resolver **skips the env-first step** for them — the DB row is the source (`'db'`), the env copy is just a boot mirror. Without this, every DB-backed T1 key would report `source:'env'` and the admin UI would lock it. A genuinely operator-set env value (present before boot population) is never mirrored and keeps `source:'env'`.
- **Empty-string env values** are treated as unset (matches codebase `process.env.X || default` conventions).
- **DB value shapes (D11):** plaintext config is stored as a JSON string (already JSON-parsed by the store on read → string); a secret is stored as the encrypted payload object. The resolver also tolerates a secret row whose value is a JSON **string** of the payload (the practical artifact of `settingsStore.set` with a serialized payload) by JSON-parsing it before the payload check.
- **`registration_enabled`:** the raw stored value (JSON boolean or string) is passed through; a boolean is returned as-is (boolean passthrough); no coercion, no default.

### 2.4 settingsStore Contract

The resolver reads **only** through the injected store. Public API it relies on:

| Method   | Signature                      | Behavior                                                                                                                                                                      |
| -------- | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `get`    | `async (key) => value \| null` | Returns the `settings` row value or `null`. PG: the parsed JSONB value (a JSON string for plaintext config). SQLite: the raw TEXT. Errors are wrapped via `mapDatabaseError`. |
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
| DB row resolves     | decrypted/parsed value (or `'****'` if secret)                       | `'db'`      |
| otherwise           | `entry.default` (or `'****'` if secret; `undefined` when no default) | `'default'` |

Secrets are never decrypted for this call — `value` is always `'****'`, while `source`/`tier`/`secret` remain truthful.

## 3. Dependencies

- `configRegistry` (entries/tiers), `configEncryption` (`decryptSecret`, `isEncryptedPayload`).
- No DB module imports — the store is injected (testable with a fake store).

## 4. Edge Cases

- Missing `encrypt_secret_key` with an encrypted DB secret → `undefined` (no throw).
- Legacy plaintext secret row (pre-encryption) → returned as-is.
- Secret row JSON-string payload (from `settingsStore.set`) → parsed, then decrypted.
- Decryption auth failure → `undefined` (treated as unavailable; do not crash requests).
- T0 key with no env → `undefined`, no default applied.
- Unknown key → `undefined` from `getConfig`; excluded from `getEffectiveConfig` output.

## 5. Verification Scenarios

- [ ] env wins over DB and over default.
- [ ] DB fallback when env absent.
- [ ] default fallback when neither env nor DB has the key.
- [ ] Secret decrypt-on-read only when env absent.
- [ ] Missing master key → `undefined`.
- [ ] `getEffectiveConfig` masks secrets and reports source/tier.
- [ ] `invalidateCache` + TTL reload re-read the store.
- [ ] `registration_enabled` boolean passthrough.
- [ ] `getConfigSync` serves env/cached-DB/default with no DB reads.
- [ ] `setSharedResolver`/`getSharedResolver` return the installed instance.
