# configRegistry Spec

## 1. Overview

| Item            | Description                                                                                                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role            | Single authoritative catalog of every `process.env` config key the server reads, classified into tiers (T0/T1/T2), flagged secret or not, with the in-code default (if any). Consumed by `configResolver`, the boot snapshot loader (T3), the admin config API (T4) and setup status (T6). |
| Source of truth | `PLAN.md` §3/§4 and `docs/features/config-source-resolution.md` (variable classification)                                                                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/configRegistry.js`
- **Test file:** `server/infrastructure/__tests__/configRegistry.test.js`

### 2.2 Public API

| Export           | Signature                                       | Description                                                                 |
| ---------------- | ----------------------------------------------- | --------------------------------------------------------------------------- |
| `TIER`           | `Object.freeze({ T0, T1, T2 })`                 | Tier constants (string values `'T0'`/`'T1'`/`'T2'`).                        |
| `CONFIG_ENTRIES` | frozen `Array<{ key, tier, secret, default? }>` | The complete catalog, ordered for UI grouping. Each entry object is frozen. |
| `getEntries`     | `() => Array`                                   | Returns `CONFIG_ENTRIES`.                                                   |
| `getEntry`       | `(key) => entry \| undefined`                   | Lookup by raw env var name; `undefined` when unknown.                       |
| `isT0`           | `(key) => boolean`                              | True when the key is registered as `TIER.T0`.                               |
| `isTier`         | `(key, tier) => boolean`                        | True when the key is registered with the given tier.                        |
| `isSecret`       | `(key) => boolean`                              | True when the entry has `secret: true`. Unknown keys → `false`.             |
| `getDefault`     | `(key) => value \| undefined`                   | The registered in-code default; `undefined` when none / unknown.            |

### 2.3 Entry shape

- `key` — raw env var name (row key in the `settings` table, D11).
- `tier` — one of `TIER.*`.
- `secret` — boolean; drives encryption at rest (DB write path) and `****` masking in `getEffectiveConfig`.
- `default` — optional; the **in-code default** observed at the read site. If the code has no default, the field is omitted.

### 2.4 Tier semantics (resolver contract)

| Tier | Meaning                           | Source chain                                         |
| ---- | --------------------------------- | ---------------------------------------------------- |
| `T0` | Startup-critical, `.env` only     | env only (no DB, no default applied by the resolver) |
| `T1` | Boot-frozen (require-time consts) | env → DB → default; effect requires restart          |
| `T2` | Runtime / hot                     | env → DB → default; effect immediate                 |

Precedence invariant (D1): env wins whenever set; DB is read only when the env var is absent. For secrets, an env value means "do not even decrypt".

---

## 3. Registry Table

### T0 — `.env` only (metadata)

| key                            | tier | secret  | default                                  |
| ------------------------------ | ---- | ------- | ---------------------------------------- |
| `WEA_STORAGE_BACKEND`          | T0   | no      | `'sqlite'`                               |
| `WEA_SQLITE_PATH`              | T0   | no      | —                                        |
| `WEA_PG_HOST`                  | T0   | no      | —                                        |
| `WEA_PG_PORT`                  | T0   | no      | `5432`                                   |
| `WEA_PG_DATABASE`              | T0   | no      | —                                        |
| `WEA_PG_USER`                  | T0   | no      | —                                        |
| `WEA_PG_PASSWORD`              | T0   | **yes** | —                                        |
| `WEA_PG_SSL`                   | T0   | no      | `false`                                  |
| `WEA_PG_MAX`                   | T0   | no      | `10`                                     |
| `WEA_PG_IDLE_TIMEOUT_MS`       | T0   | no      | `30000`                                  |
| `WEA_PG_CONNECTION_TIMEOUT_MS` | T0   | no      | `10000`                                  |
| `NODE_ENV`                     | T0   | no      | —                                        |
| `DOTENV_CONFIG_PATH`           | T0   | no      | —                                        |
| `encrypt_secret_key`           | T0   | **yes** | —                                        |
| `JWT_SECRET`                   | T0   | **yes** | `'your-secret-key-change-in-production'` |

### File storage

| key                           | tier | secret  | default              |
| ----------------------------- | ---- | ------- | -------------------- |
| `WEA_FILE_STORAGE`            | T1   | no      | `'s3'`               |
| `S3_BUCKET`                   | T1   | no      | —                    |
| `AWS_REGION`                  | T1   | no      | —                    |
| `AWS_ACCESS_KEY_ID`           | T1   | no      | —                    |
| `AWS_SECRET_ACCESS_KEY`       | T1   | **yes** | —                    |
| `S3_ENDPOINT`                 | T1   | no      | —                    |
| `WEBDAV_URL`                  | T1   | no      | —                    |
| `WEBDAV_USERNAME`             | T1   | no      | —                    |
| `WEBDAV_PASSWORD`             | T1   | **yes** | —                    |
| `WEBDAV_AUTH_TYPE`            | T1   | no      | `'auto'`             |
| `WEBDAV_UPSTREAM_URL`         | T2   | no      | —                    |
| `MAX_THUMBNAIL_SIZE`          | T2   | no      | `300`                |
| `THUMBNAIL_CONCURRENCY_LIMIT` | T1   | no      | `10`                 |
| `THUMBNAIL_TOKEN_SECRET`      | T2   | no      | `'thumbnail-secret'` |
| `THUMBNAIL_TOKEN_EXPIRY`      | T2   | no      | `'15m'`              |
| `FFMPEG_PATH`                 | T1   | no      | —                    |
| `FFMPEG_INIT_TIMEOUT_MS`      | T2   | no      | `2000`               |
| `WEA_PREVIEW_TICKET_TTL_MS`   | T2   | no      | `120000`             |

### Server & security

| key                          | tier | secret  | default   |
| ---------------------------- | ---- | ------- | --------- |
| `PORT`                       | T1   | no      | `5001`    |
| `CORS_ORIGINS`               | T2   | no      | `''`      |
| `CORS_ORIGIN`                | T2   | no      | `''`      |
| `LOGIN_RATE_LIMIT_MAX`       | T2   | no      | `20`      |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | T2   | no      | `900000`  |
| `JWT_EXPIRES_IN`             | T2   | no      | `'30m'`   |
| `ADMIN_DEFAULT_PASSWORD`     | T1   | **yes** | `'admin'` |
| `WEA_DISABLE_DEFAULT_ADMIN`  | T1   | no      | —         |
| `HOSTNAME`                   | T2   | no      | —         |

### Email

| key               | tier | secret  | default               |
| ----------------- | ---- | ------- | --------------------- |
| `EMAIL_HOST`      | T1   | no      | —                     |
| `EMAIL_PORT`      | T1   | no      | `587`                 |
| `EMAIL_USER`      | T1   | no      | —                     |
| `EMAIL_PASSWORD`  | T1   | **yes** | —                     |
| `EMAIL_SECURE`    | T1   | no      | `false`               |
| `EMAIL_FROM_NAME` | T1   | no      | `'WebDAV EasyAccess'` |

### Runtime

| key                                           | tier | secret | default        |
| --------------------------------------------- | ---- | ------ | -------------- |
| `registration_enabled`                        | T2   | no     | —              |
| `GC_INTERVAL_MS`                              | T1   | no     | `0` (disabled) |
| `GC_ORPHAN_TTL_DAYS`                          | T2   | no     | `1`            |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS`               | T1   | no     | `7`            |
| `USER_CACHE_TTL_MS`                           | T2   | no     | `3000`         |
| `PERMISSION_CACHE_TTL_MS`                     | T2   | no     | `5000`         |
| `PERMISSIONS_EXISTENCE_INDEX_TTL_MS`          | T2   | no     | `30000`        |
| `PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE`  | T2   | no     | `100`          |
| `PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY` | T2   | no     | `4`            |
| `WEA_SKIP_MIGRATION_WORKER`                   | T2   | no     | —              |
| `WEA_SKIP_BULK_WORKER`                        | T2   | no     | —              |
| `WEA_SKIP_GC_SCHEDULER`                       | T1   | no     | —              |

---

## 4. Behavioral Rules

- **Ordering is significant**: entries are ordered so the UI can group them — T0 metadata, file storage, server/security, email, runtime. Within a group the ordering mirrors PLAN §4 where a variable is classified there; variables absent from PLAN §4 are appended at the end of their group.
- **Complete inventory**: every `process.env.<VAR>` read site under `server/` (excluding test-only reads) is registered.
- `registration_enabled` is preserved as registered (T2, not secret, no default) — the resolver must never synthesize a default for it.
- Defaults mirror the **in-code default as typed** (number/string/boolean). A missing default means the code has none.

## 5. Dependencies

- None (static data only).

## 6. Verification Scenarios

- [ ] Every tier/secret spot-checked against PLAN §4.
- [ ] `getEntry` returns `undefined` for unknown keys; `isSecret`/`isT0` are safe for unknown keys.
- [ ] `CONFIG_ENTRIES` and each entry are frozen.
- [ ] `registration_enabled` present, T2, non-secret, no default.
