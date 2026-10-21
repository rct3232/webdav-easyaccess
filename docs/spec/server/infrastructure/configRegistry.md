# configRegistry Spec

## 1. Overview

| Item            | Description                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role            | Single authoritative catalog of every `process.env` config key the server reads, classified into tiers (T0/T1/T2), flagged secret or not, with the in-code default (if any). Consumed by `configResolver` for runtime resolution, `configResolver.populateT1Env` for the boot env mirror (server/index.js:243), the admin config API (server/domains/admin/routes/config.js), and the setup routes (server/domains/setup/). |
| Source of truth | `docs/features/config-source-resolution.md` (variable classification)                                                                                                                                                                                                                                                                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/configRegistry.js`
- **Test file:** `server/infrastructure/__tests__/configRegistry.test.js`

### 2.2 Public API

| Export           | Signature                                                | Description                                                                 |
| ---------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `TIER`           | `Object.freeze({ T0, T1, T2 })`                          | Tier constants (string values `'T0'`/`'T1'`/`'T2'`).                        |
| `CONFIG_ENTRIES` | frozen `Array<{ key, tier, secret, dbOnly?, default? }>` | The complete catalog, ordered for UI grouping. Each entry object is frozen. |
| `getEntries`     | `() => Array`                                            | Returns `CONFIG_ENTRIES`.                                                   |
| `getEntry`       | `(key) => entry \| undefined`                            | Lookup by raw env var name; `undefined` when unknown.                       |
| `isT0`           | `(key) => boolean`                                       | True when the key is registered as `TIER.T0`.                               |
| `isTier`         | `(key, tier) => boolean`                                 | True when the key is registered with the given tier.                        |
| `isSecret`       | `(key) => boolean`                                       | True when the entry has `secret: true`. Unknown keys → `false`.             |
| `getDefault`     | `(key) => value \| undefined`                            | The registered in-code default; `undefined` when none / unknown.            |

### 2.3 Entry shape

- `key` — raw env var name (row key in the `settings` table).
- `tier` — one of `TIER.*`.
- `secret` — boolean; drives **presentation-level** `'****'` masking in `getEffectiveConfig` and the admin/setup surfaces. It no longer implies any encryption at rest — secret DB rows are stored plaintext like any other value.
- `dbOnly` — optional boolean. When `true` the key is **never env-driven**: `configResolver` resolves it from the DB settings row or the built-in default only, `populateT1Env` does not mirror it into `process.env`, and `configSync`/setup-wizard never treat env as authoritative (value is written to the DB `settings` table). Internal tuning knobs (e.g. `JWT_EXPIRES_IN`, `GC_ORPHAN_TTL_DAYS`, rate-limit/cache/thumbnail settings) are `dbOnly`.
- `default` — optional; the **in-code default** observed at the read site. If the code has no default, the field is omitted.

### 2.4 Tier semantics (resolver contract)

| Tier | Meaning                                                                           | Source chain                                         |
| ---- | --------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `T0` | `.env` only — boot-required metadata keys; `JWT_SECRET` is the optional exception | env only (no DB, no default applied by the resolver) |
| `T1` | Boot-frozen (require-time consts)                                                 | env → DB → default; effect requires restart          |
| `T2` | Runtime / hot                                                                     | env → DB → default; effect immediate                 |

A `dbOnly` entry at any tier resolves as **DB → default** (env ignored); T1/T2 then only
affect restart-vs-immediate effect of DB edits.

`JWT_SECRET` is the **optional T0 exception**: env-owned and boot-frozen, but **not
required**. When the env var is unset/empty the read site generates an ephemeral random
secret at boot for that process (restart → new secret → sessions invalidated); only a set
value is used verbatim.

Precedence invariant: env wins whenever set; DB is read only when the env var is absent.

---

## 3. Registry Table

### T0 — `.env` only (metadata)

| key                            | tier | secret  | default                                                                                                                      |
| ------------------------------ | ---- | ------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `WEA_SQLITE_PATH`              | T0   | no      | —                                                                                                                            |
| `WEA_DB_HOST`                  | T0   | no      | —                                                                                                                            |
| `WEA_DB_PORT`                  | T0   | no      | `5432`                                                                                                                       |
| `WEA_DB_DATABASE`              | T0   | no      | —                                                                                                                            |
| `WEA_DB_USER`                  | T0   | no      | —                                                                                                                            |
| `WEA_DB_PASSWORD`              | T0   | **yes** | —                                                                                                                            |
| `WEA_DB_SSL`                   | T0   | no      | `false`                                                                                                                      |
| `WEA_DB_MAX`                   | T0   | no      | `10`                                                                                                                         |
| `WEA_DB_IDLE_TIMEOUT_MS`       | T0   | no      | `30000`                                                                                                                      |
| `WEA_DB_CONNECTION_TIMEOUT_MS` | T0   | no      | `10000`                                                                                                                      |
| `WEA_DB_QUERY_TIMEOUT_MS`      | T0   | no      | `60000`                                                                                                                      |
| `NODE_ENV`                     | T0   | no      | —                                                                                                                            |
| `DOTENV_CONFIG_PATH`           | T0   | no      | —                                                                                                                            |
| `JWT_SECRET`                   | T0   | **yes** | — (none — unset → ephemeral per-boot random)                                                                                 |
| `WEA_MODEL_DIR`                | T0   | no      | — (unset → default data dir; built-in embed weights location, `llmPresets.md` §2.3 — optional operator pre-seed, not a mode) |

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
| `THUMBNAIL_TOKEN_SECRET`      | T2   | **yes** | `'thumbnail-secret'` |
| `THUMBNAIL_TOKEN_EXPIRY`      | T2   | no      | `'15m'`              |
| `FFMPEG_PATH`                 | T1   | no      | —                    |
| `FFMPEG_INIT_TIMEOUT_MS`      | T2   | no      | `2000`               |
| `WEA_PREVIEW_TICKET_TTL_MS`   | T2   | no      | `120000`             |

### Server & security

| key                          | tier | secret  | default   |
| ---------------------------- | ---- | ------- | --------- |
| `PORT`                       | T1   | no      | `5001`    |
| `CORS_ORIGINS`               | T2   | no      | `''`      |
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

| key                                           | tier | secret | default                                                                    |
| --------------------------------------------- | ---- | ------ | -------------------------------------------------------------------------- |
| `registration_enabled`                        | T2   | no     | —                                                                          |
| `GC_INTERVAL_MS`                              | T1   | no     | `0` (disabled)                                                             |
| `GC_ORPHAN_TTL_DAYS`                          | T2   | no     | `1`                                                                        |
| `GC_VERSION_TTL_DAYS`                         | T2   | no     | `1`                                                                        |
| `GC_PENDING_STALE_DAYS`                       | T2   | no     | `3` (`0` = disabled)                                                       |
| `GC_VERSION_MAX_PER_NODE`                     | T2   | no     | `10` (`0` = unbounded; note the inverted 0-semantics vs the `*_DAYS` keys) |
| `TRASH_RETENTION_DAYS`                        | T2   | no     | `30` (`0` = retention off — GC Tier 3 skips trash purging)                 |
| `REFRESH_TOKEN_EXPIRES_IN_DAYS`               | T1   | no     | `7`                                                                        |
| `USER_CACHE_TTL_MS`                           | T2   | no     | `3000`                                                                     |
| `PERMISSION_CACHE_TTL_MS`                     | T2   | no     | `5000`                                                                     |
| `PERMISSIONS_EXISTENCE_INDEX_TTL_MS`          | T2   | no     | `30000`                                                                    |
| `PERMISSIONS_EXISTENCE_RECONCILE_BATCH_SIZE`  | T2   | no     | `100`                                                                      |
| `PERMISSIONS_EXISTENCE_RECONCILE_CONCURRENCY` | T2   | no     | `4`                                                                        |
| `WEA_SKIP_MIGRATION_WORKER`                   | T2   | no     | —                                                                          |
| `WEA_SKIP_BULK_WORKER`                        | T2   | no     | —                                                                          |
| `WEA_SKIP_GC_SCHEDULER`                       | T1   | no     | —                                                                          |
| `WEA_SKIP_AI_WORKER`                          | T2   | no     | — (test seam for the AI jobs worker; `aiJobService.md` §2)                 |

### AI / LLM (T2 `dbOnly` — fully hot)

All `LLM_*` keys are T2 `dbOnly`: DB row → default, env ignored, per-call
resolution (hot — no restart; `llmAdapter.md` §1). Presence decides candidacy, probes
decide truth; there is no `LLM_ENABLED` flag. API keys are `secret: true`
(presentation masking only, plaintext at rest). No read site exists yet — the
keys are registered now so the admin config surface (editor + `GET/PUT /api/admin/config`)
can manage them from day one.

| key                          | tier | secret  | default         | notes                                                                           |
| ---------------------------- | ---- | ------- | --------------- | ------------------------------------------------------------------------------- |
| `LLM_EMBED_BASE_URL`         | T2   | no      | —               | embed role connection triplet (`dbOnly`)                                        |
| `LLM_EMBED_API_KEY`          | T2   | **yes** | —               |                                                                                 |
| `LLM_EMBED_MODEL`            | T2   | no      | —               |                                                                                 |
| `LLM_CHAT_BASE_URL`          | T2   | no      | —               | chat role triplet                                                               |
| `LLM_CHAT_API_KEY`           | T2   | **yes** | —               |                                                                                 |
| `LLM_CHAT_MODEL`             | T2   | no      | —               |                                                                                 |
| `LLM_VISION_BASE_URL`        | T2   | no      | —               | vision role triplet                                                             |
| `LLM_VISION_API_KEY`         | T2   | **yes** | —               |                                                                                 |
| `LLM_VISION_MODEL`           | T2   | no      | —               |                                                                                 |
| `LLM_ASR_BASE_URL`           | T2   | no      | —               | ASR role triplet                                                                |
| `LLM_ASR_API_KEY`            | T2   | **yes** | —               |                                                                                 |
| `LLM_ASR_MODEL`              | T2   | no      | —               |                                                                                 |
| `LLM_MAX_INPUT_CHARS`        | T2   | no      | —               | budget chain step 1 (admin cap beats published metadata)                        |
| `LLM_CHUNK_BUDGET`           | T2   | no      | `4`             | uniform-stride sample cap (overlength ladder)                                   |
| `LLM_OVERLENGTH_POLICY`      | T2   | no      | `'chunk-pool'`  | ladder entry point selector (`llmAdapter.md` §2.6)                              |
| `LLM_DAILY_CALL_CAP`         | T2   | no      | `0` (unlimited) | per-role daily call cap (§2.5)                                                  |
| `LLM_DAILY_TOKEN_CAP`        | T2   | no      | `0` (unlimited) | per-role daily token cap                                                        |
| `LLM_REPROBE_DEBOUNCE_S`     | T2   | no      | `60`            | hot re-probe debounce on config signature change (§2.2)                         |
| `LLM_BREAKER_THRESHOLD`      | T2   | no      | `5`             | consecutive-failure count that OPENs the circuit breaker (`llmAdapter.md` §2.5) |
| `LLM_BREAKER_COOLDOWN_S`     | T2   | no      | `300`           | breaker OPEN cooldown before the half-open probe (`llmAdapter.md` §2.5)         |
| `AI_SEMANTIC_SEARCH_ENABLED` | T2   | no      | `true`          | query-embed kill switch (`searchService` consumer)                              |

### Activity constants (T2 `dbOnly` — §3.4 product constants)

Numeric-constants discipline: the §3.4 activity constants are product T2-hot
constants (dbOnly, defaults shipped, admin-displayed via the registry-driven config
surface) — NOT AI-profile numbers. The same defaults live in
`server/infrastructure/usage/activityScore.js` (single semantic source; registry
defaults are kept in parity by test).

| key                             | tier | secret | default | notes                                                                    |
| ------------------------------- | ---- | ------ | ------- | ------------------------------------------------------------------------ |
| `AI_USAGE_W_OPEN`               | T2   | no     | `1`     | `usage_events` weight w_open (§3.4)                                      |
| `AI_USAGE_W_PREVIEW`            | T2   | no     | `2`     | weight w_preview                                                         |
| `AI_USAGE_W_DOWNLOAD`           | T2   | no     | `3`     | weight w_download                                                        |
| `AI_USAGE_W_SEARCH_HIT`         | T2   | no     | `1`     | weight w_search_hit                                                      |
| `AI_USAGE_W_LIKE`               | T2   | no     | `5`     | weight w_like                                                            |
| `AI_ACTIVITY_HALF_LIFE_DAYS`    | T2   | no     | `30`    | item accumulator half-life H (§3.4)                                      |
| `AI_USAGE_EVENT_RETENTION_DAYS` | T2   | no     | `90`    | raw `usage_events` roll-off horizon (`0` = retention off)                |
| `AI_NIGHTLY_ANCHOR_HOUR_UTC`    | T2   | no     | `3`     | nightly scheduler anchor hour (maintenanceScheduler §3.3)                |
| `ARCHIVE_RETENTION_DAYS`        | T2   | no     | `30`    | purge horizon / tombstone lifetime (collectionsService §3, Q1)           |
| `ADMIN_REPORTS_RETENTION_DAYS`  | T2   | no     | `30`    | `admin_reports` housekeeping horizon (writer-side prune; `0` = off)      |
| `WEA_SKIP_ROLLUP_SCHEDULER`     | T2   | no     | —       | test seam, env-allowed (NOT dbOnly — same idiom as `WEA_SKIP_AI_WORKER`) |

---

## 4. Behavioral Rules

- **Ordering is significant**: entries are ordered so the UI can group them — T0 metadata, file storage, server/security, email, runtime, AI/LLM. Within a group the ordering follows the classification in the registry table above where a variable is classified there; variables not classified there are appended at the end of their group.
- **Complete inventory**: every `process.env.<VAR>` read site under `server/` (excluding test-only reads) is registered.
- `registration_enabled` is preserved as registered (T2, not secret, no default) — the resolver must never synthesize a default for it.
- Defaults mirror the **in-code default as typed** (number/string/boolean). A missing default means the code has none.

## 5. Dependencies

- None (static data only).

## 6. Verification Scenarios

- [ ] Every tier/secret spot-checked against the registry table.
- [ ] `getEntry` returns `undefined` for unknown keys; `isSecret`/`isT0` are safe for unknown keys.
- [ ] `CONFIG_ENTRIES` and each entry are frozen.
- [ ] `registration_enabled` present, T2, non-secret, no default.
- [ ] Every `LLM_*` key is T2 `dbOnly`; the four role API keys are `secret: true`; `WEA_SKIP_AI_WORKER` is T2 non-dbOnly (env-allowed test seam).
- [ ] The §3.4 activity-constant keys (`AI_USAGE_W_*`, `AI_ACTIVITY_HALF_LIFE_DAYS`, `AI_USAGE_EVENT_RETENTION_DAYS`, `AI_NIGHTLY_ANCHOR_HOUR_UTC`, `ARCHIVE_RETENTION_DAYS`) are T2 `dbOnly` with the shipped defaults; `WEA_SKIP_ROLLUP_SCHEDULER` is T2 env-allowed (not dbOnly).
- [ ] `ADMIN_REPORTS_RETENTION_DAYS` is registered T2 `dbOnly`, non-secret, default `30` (admin.md §2.2.6 writer-side housekeeping).
