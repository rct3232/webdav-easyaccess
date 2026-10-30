# admin routes Spec

## 1. Overview

| Item       | Description                                                                                                                                     |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/admin`                                                                                                                                    |
| Role       | Admin-only: settings, user management (pending, list, approve, reject, delete, create), folder list, user permissions, cleanup, blob migration. |

---

## 2. Implementation Spec

The original monolithic `server/routes/admin.js` has been split into separate route modules under `server/domains/admin/routes/`, each with dedicated service layers.

### 2.1 Route Modules

| Module         | Source                                          | Mount Path                             | Test File                                                 |
| -------------- | ----------------------------------------------- | -------------------------------------- | --------------------------------------------------------- |
| userManagement | `server/domains/admin/routes/userManagement.js` | `/api/admin`                           | `server/domains/admin/routes/__tests__/admin.test.js`     |
| settings       | `server/domains/admin/routes/settings.js`       | `/api/admin`, `/api/settings` (public) | `server/domains/admin/routes/__tests__/settings.test.js`  |
| config         | `server/domains/admin/routes/config.js`         | `/api/admin`                           | `server/domains/admin/routes/__tests__/config.test.js`    |
| ai             | `server/domains/admin/routes/ai.js`             | `/api/admin/ai` (mounted by config)    | `server/domains/admin/routes/__tests__/ai.test.js`        |
| maintenance    | `server/domains/admin/routes/maintenance.js`    | `/api/admin`                           | `server/domains/admin/routes/__tests__/admin.test.js`     |
| migration      | `server/domains/admin/routes/migration.js`      | `/api/admin`                           | `server/domains/admin/routes/__tests__/migration.test.js` |
| reports        | `server/domains/admin/routes/reports.js`        | `/api/admin`                           | `server/domains/admin/routes/__tests__/reports.test.js`   |

Mounting note: `server/index.js` mounts the admin route modules directly. The `reports`
module is additionally mounted by the maintenance module router
(`maintenance.js`: `router.use('/reports', require('./reports'))`) so these endpoints
require no `server/index.js` edit (that file is owned by another workstream);
consolidating it into an `index.js` mount later is an optional cleanup.

### 2.2 Route List

#### 2.2.1 userManagement (`/api/admin`)

Admin-only user lifecycle management. Service: `domains/admin/services/userService.js`.

| Method | Path                 | Auth          | Description                                              |
| ------ | -------------------- | ------------- | -------------------------------------------------------- |
| GET    | `/users/pending`     | Token + Admin | Pending signup approvals.                                |
| GET    | `/users`             | Token + Admin | List all users.                                          |
| POST   | `/users`             | Token + Admin | Add user. Body: username, email, password.               |
| POST   | `/users/:id/approve` | Token + Admin | Approve signup. Creates home folder, grants admin on it. |
| POST   | `/users/:id/reject`  | Token + Admin | Reject signup. Revokes all permissions and requests.     |
| DELETE | `/users/:id`         | Token + Admin | Delete user cascade. Cannot delete self or other admins. |

#### 2.2.2 settings (`/api/admin`)

System configuration. Also exposes a public endpoint at `/api/settings/public`.

| Method | Path        | Auth          | Description                                       |
| ------ | ----------- | ------------- | ------------------------------------------------- |
| GET    | `/settings` | Token + Admin | Get system settings.                              |
| PUT    | `/settings` | Token + Admin | Update settings. Body: registration_enabled, etc. |

#### 2.2.3 maintenance (`/api/admin`)

System maintenance operations. Service: `domains/admin/services/cleanupService.js`.

| Method | Path                                   | Auth          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/permissions/ensure-home-owner-admin` | Token + Admin | Ensure each non-admin user has admin on their home node and remove redundant self-grants on their own subtree.                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| POST   | `/cleanup/orphaned`                    | Token + Admin | Clean orphaned metadata files and permission requests. Also runs one GC cycle and reports `orphaned_node` status (see §2.2.3.1).                                                                                                                                                                                                                                                                                                                                                                                                                             |
| POST   | `/maintenance/repair-sync`             | Token + Admin | Manually resolve a stuck node. `orphaned_node`: `{ nodeId, action: 'retry-delete' \| 'force-active' }` (WebDAV mode: `retry-delete` also deletes the remote blob/file bottom-up over the subtree; `force-active` first verifies the remote file exists and refuses with 409 otherwise). `pending_upload` (**S3 mode only** — refused with 409 in WebDAV mode, where healthy file nodes intentionally stay `pending_upload`): `{ nodeId, action: 'complete' \| 'restore-previous' \| 'delete' \| 'auto' }`. Service: `server/service/failSafeService.js`.     |
| DELETE | `/maintenance/perm-delete`             | Token + Admin | Permanently delete one node (hard delete, bypasses the trash). Body: `{ nodeId }`. WebDAV mode: remote cleanup FIRST (trashed node → delete `/.wea-trash/<nodeId>`; live node → bottom-up display-path delete via `webdavRemoteOps`), then `fileNodeService.deleteNode` (FK cascade removes object_map/filecache/closure/permission/share/recent rows). 404 when the node does not exist (trashed rows included). This admin route is the maintenance/E2E hard-delete entry point; user-facing permanent delete lives on the trash purge/empty-trash routes. |

#### 2.2.3.1 `cleanup/orphaned` response shape (additive keys)

The existing result keys (`deletedPermissionFiles`, `deletedUserFiles`, `deletedEmailIndexFiles`, `cleanedPermissionRequests`, `errors`) are unchanged. Two additive keys are present:

- `gc: { tier1: { orphanedRows, guardedRows, deletedBlobs, deletedRows, pendingDeletedRows, errors }, tier2: { scannedKeys, untrackedKeys, deletedKeys, skipped, errors } }`
- `orphanedNodes: Array<{ nodeId, path }>`
- `pendingUploadNodes: Array<{ nodeId, name, type, path, createdAt, updatedAt, classification, pendingS3Key, blobPresent }>` — read-only report of file nodes stuck in `sync_status='pending_upload'` (**empty in WebDAV mode** — the stuck state is S3-mode only; see `docs/spec/server/services/uploadService.md` §2.5.1)

#### 2.2.4 migration (`/api/admin`)

Blob migration (bidirectional WebDAV ↔ S3) and metadata DB migration (sqlite ↔ PostgreSQL),
both with a 202 + poll job contract. Services: `domains/admin/services/migrationService.js`
(blobs) and `domains/admin/services/metadataMigrationService.js` (metadata); job tracking:
`domains/admin/stores/migrationJobStore.js`. Workers run via `setImmediate` and honour the
`WEA_SKIP_MIGRATION_WORKER` test seam (skips worker scheduling without changing defaults).

| Method | Path                            | Auth          | Description                                                                                                                                                                                                                                                                           |
| ------ | ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/migration/info`               | Token + Admin | Get the derived migration context. Returns `200 { source: 'webdav' \| 's3', direction: 'webdav-to-s3' \| 's3-to-webdav' }` (direction derived from the app config).                                                                                                                   |
| GET    | `/migration/target-scan`        | Token + Admin | Read-only scan of an explicit (non-active) metadata target backend. Params/body: `{ targetBackend, pg?, sqlitePath? }` (PG also accepted as flat `?host=&port=...` query params). Returns `200 { backend, connected, schemaExists, tables: [{ name, rows }], totalRows, checkedAt }`. |
| POST   | `/migration/blobs`              | Token + Admin | Start a blob migration job. Body: `{ mode: 'dry-run' \| 'apply', force?, dest: { type:'s3',... } \| { type:'webdav',... } }` — no `direction`; the server derives it from the app config and validates `dest.type` matches the expected destination. Returns `202 { jobId }`.         |
| POST   | `/migration/metadata`           | Token + Admin | Start a metadata DB migration job. Body: `{ targetBackend, pg?, sqlitePath?, wipeTarget? }` — target backend must be the non-active one. Returns `202 { jobId }`; cancel = ROLLBACK of the target transaction. Full contract: `docs/spec/server/tools/metadata-migration.md`.         |
| GET    | `/migration/jobs/:jobId`        | Token + Admin | Get migration job status/progress. Returns `200 { jobShape }` — the in-memory store row (`type`, `stage`, `configPersist` etc.; `progress` is type-specific). See `docs/spec/server/store/migrationJobStore.md`.                                                                      |
| POST   | `/migration/jobs/:jobId/cancel` | Token + Admin | Cancel a running migration job. Returns `200 { messageCode, jobId }`.                                                                                                                                                                                                                 |

Destination config fields and the authoritative blob-migration rules are documented in `docs/spec/server/tools/blob-migration.md`.

#### 2.2.6 reports (`/api/admin`)

Admin reports: the persisted `admin_reports` runs (GC, startup fail-safe
scan merged with the boot content-hash completeness section, cleanup) become a read-only list with
action-dispatched row repair. Rows are written best-effort by the shared writer
(`domains/admin/services/adminReportsService.js`): `POST /cleanup/orphaned` persists its
§2.2.3.1 response as `kind='cleanup'` before returning 200, the scheduled GC cycle
persists `kind='gc'` rows, and
`runStartupFailSafeRecovery` (`infrastructure/maintenanceScheduler.js`) persists ONE
`kind='failsafe'` row whose payload merges the scan report with the boot content-hash
completeness section `contentHashCompleteness` (`{ nullCount, checkedAt }`; `status` is
`partial` while NULL rows exist or the count failed, else `ok`). The `admin_reports.kind` CHECK enum is `gc|migration|failsafe|night_eval|cleanup`; `status` is `ok|partial`. The shared writer is **append-only**: a successful report write never deletes another row. Retention is a maintenance job owned by `maintenanceScheduler`: `runAdminReportsRetention()` runs once at boot and `startAdminReportsRetentionScheduler()` repeats it every `ADMIN_REPORTS_RETENTION_INTERVAL_MS` (T2 `dbOnly`, default 24h, `0` = disabled) — both hot-read `ADMIN_REPORTS_RETENTION_DAYS` (default 30, `0` = off) and delete rows older than the cutoff in bounded `ADMIN_REPORTS_RETENTION_BATCH` batches (default 1000) under the `admin-reports-retention` lock (one replica per run). A retention failure is log-only and retried next interval; it never fails a GC/boot/cleanup write. The writer path has no retention side effect and no scheduler call.

| Method | Path                  | Auth          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | --------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/reports`            | Token + Admin | Report list, newest first. Read-only; row-level repair actions are dispatched via `POST /reports/:id/repair` or reuse the existing §2.2.3 endpoints.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| GET    | `/reports/:id`        | Token + Admin | Single report row (same shape as the list entries); 404 when the row does not exist.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| POST   | `/reports/:id/repair` | Token + Admin | Action-dispatched row repair. `content_hash` is the only action that mutates the row: it requires a `failsafe` row carrying a `contentHashCompleteness` payload section, backfills ALL NULL `filecache.content_hash` (idempotent `WHERE content_hash IS NULL`; streams blob hashes per node; progress reflected on the row) and **returns the re-rendered row**. The `repair-sync` delegation (`{ nodeId, repairAction }`, §2.2.3 fail-safe repair core) and the `perm-delete` delegation (`{ nodeId }`, §2.2.3 permanent-delete purge core) **return the row unchanged** plus their `result` payload; the §2.2.3 cores' status codes pass through unchanged. Unknown/undispatchable rows ⇒ 404/400 per §2.4 reports. |

#### 2.2.7 ai (`/api/admin/ai`)

Admin AI governance surface (`AiAdminContent.md`) and the ONE rate-limited
re-embed launcher. Service: `domains/admin/services/aiAdminService.js`; route
module `domains/admin/routes/ai.js` mounted by the config module
(`config.js`: `router.use('/ai', require('./ai'))`, final path `/api/admin/ai/*`).
All rows require a valid JWT and the DB-backed admin role; responses are
snake_case (request bodies camelCase where present). The surface never returns
other users' file names, paths, queries or contents — aggregates and ids only —
and never returns a raw secret.

| Method | Path                  | Auth          | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------ | --------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/ai/summary`         | Token + Admin | Polled operations snapshot: pipeline queue counts, 24 h failed count/rate, failed jobs (display-only), readiness tokens, today's `ai_usage_daily` per-role ledger + caps, evolution latest `night_eval` totals + pending merge count, model registry active/history rows + profile provenance, text/media coverage, curated config-backed gates with live impact counts, launcher availability/retry/generations, and the explicit `not_instrumented` list. |
| GET    | `/ai/reembed/preview` | Token + Admin | Read-only deterministic text coverage + media coverage (counts and union plan count), coverage/launcher `available` + `reason`, current embed model id, per-kind generations and launcher `retry_after_seconds`. No enqueue and no names/paths; unavailable coverage returns `text: null`/`media: null` and never fabricated zero counts.                                                                                                                   |
| POST   | `/ai/reembed`         | Token + Admin | The ONE re-embed launcher. Under the global `ai-reembed-launcher` lock: 15-minute cooldown derived from the latest `settings:ai-reembed` journal row, global single-active guard, preview recomputed inside the lock, generation bump for `embed                                                                                                                                                                                                            | features | caption | asr`to the same`N`(internal`AI*GEN*<KIND>`settings, default 1),`enqueueMany`embed jobs for the text + media plan, and ONE settings-domain`ai-reembed`journal row whose inverse is`cancel-ai-jobs`carrying the job ids. Returns`{ job_ids, enqueued, generation, generations, model_id, undo: { action_id }, retry_after_seconds }`. 429 `serverErrors.admin.reembedRateLimited`with`params.retry_after_seconds`; 409 `serverErrors.admin.reembedAlreadyActive`/`serverErrors.admin.reembedModelUnavailable`. |

Summary shape (all keys additive; IDs only where noted):

```jsonc
{
  "generated_at": "2026-01-01T00:00:00.000Z",
  "pipeline": {
    "queue": {
      "pending": 0,
      "running": 0,
      "done": 0,
      "failed": 0,
      "skipped": 0,
      "cancelled": 0,
      "total": 0,
    },
    "failed_24h": 0,
    "finished_24h": 0,
    "failure_rate_24h": 0,
    "failed_jobs": [
      {
        "id": 1,
        "node_id": 2,
        "kind": "embed",
        "generation": 1,
        "status": "failed",
        "attempt": 1,
        "last_error": "…",
        "created_at": "…",
        "started_at": "…",
        "finished_at": "…",
      },
    ],
    "failed_jobs_display_only": true,
    "capabilities": [
      {
        "capability": "text_embed",
        "declared": true,
        "probed": true,
        "enabled": true,
        "role": "embed",
        "note": null,
        "reason": null,
      },
    ],
    "breaker_states": { "instrumented": false, "reason": "active_observation_required" },
  },
  "cost": {
    "day": "2026-01-01",
    "roles": [
      {
        "role": "embed",
        "calls": 0,
        "input_chars": 0,
        "cached": 0,
        "degraded": 0,
        "failed_429": 0,
      },
    ],
    "caps": { "call_cap": 0, "token_cap": 0 },
    "per_user_top_n": { "instrumented": false },
  },
  "evolution": {
    "latest_night_eval": {
      "id": 1,
      "status": "ok",
      "created_at": "…",
      "passes": "full",
      "totals": {},
    },
    "pending_merge_suggestions": 0,
    "not_instrumented": ["survival_curves", "merge_accept_series", "per_version_history"],
  },
  "models": { "roles": [{ "role": "embed", "active": {}, "history": [] }], "profiles": [] },
  "coverage": {
    "available": true,
    "model_id": 1,
    "text": { "totals": { "files": 0, "embedded": 0, "missing": 0, "stale": 0 }, "by_source": {} },
    "media": {
      "totals": {},
      "by_source": {},
      "by_media_kind": {},
      "by_capability": {},
      "by_corpus": {},
    },
  },
  "gates": {
    "kill_switches": [
      {
        "key": "AI_EVOLUTION_ENABLED",
        "value": "true",
        "source": "default",
        "impact": { "metric": "night_eval_users", "count": 0 },
      },
    ],
    "gates": [
      {
        "key": "AI_EVOLUTION_INACTIVE_DAYS",
        "value": "30",
        "source": "default",
        "impact": { "metric": "night_eval_users", "count": 0 },
      },
    ],
  },
  "launcher": {
    "available": true,
    "reason": null,
    "retry_after_seconds": 0,
    "cooldown_seconds": 900,
    "active_jobs": 0,
    "active_model_id": 1,
    "generations": { "embed": 1, "features": 1, "caption": 1, "asr": 1 },
  },
  "not_instrumented": [
    "survival_curves",
    "merge_accept_series",
    "per_version_history",
    "per_user_top_n",
  ],
}
```

Rules:

- `failed_jobs` is display-only in v1 (no retry/abandon action) and capped at the
  20 newest rows (`listFailed({ limit: 20 })`). `finished_at` is written by `markFailed`
  so the 24 h window is DB-derived; `failure_rate_24h` is `failed_24h / finished_24h`
  (0 when the denominator is 0).
- `coverage.reason` explains an unavailable coverage projection (`model_unavailable`);
  `text`/`media` are `null` in that case. The preview returns the same
  `available`/`reason` pair and never fabricates zero plan counts when unavailable.
- Breaker states require active observation in the current adapter, so the panel
  exposes readiness tokens (the published capability matrix) plus an explicit
  `not_instrumented` marker instead of triggering provider work on a poll.
- The per-role `ai_usage_daily.degraded` counter is the v1 degraded-input surface.
  A degraded-input histogram and the per-user top-N list are low-value diagnostics
  and remain API-only / `not_instrumented`; no v1 panel block renders them.
- Gates are limited to the curated non-secret AI governance keys
  (`AI_EVOLUTION_*`, `AI_MERGE_*`, activity/retention keys and the AI kill switches).
  Impact counts derive from the latest `night_eval` totals and the live pending
  merge-suggestion count; unavailable metrics are labelled, never fabricated.
- Coverage is derived on read from live node/pooled/enrichment rows; no bookkeeping
  table is written. No names/paths/queries leave the server.

#### 2.2.5 config (`/api/admin`)

Effective-configuration management (env → DB → defaults registry). Service: the config resolver
(`server/infrastructure/configResolver.js`); config-sync endpoints delegate to
`server/service/configSyncService.js` — the same shared core as the `config-sync` CLI. See
`docs/spec/server/tools/config-sync.md`.

| Method | Path                    | Auth          | Description                                                                                                                                                            |
| ------ | ----------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/config`               | Token + Admin | Get effective config: `200 { config }` — every registry key with source/tier + masked secrets.                                                                         |
| PUT    | `/config`               | Token + Admin | Update allowlisted config keys. Body: `{ values }` — plaintext writes to DB; rejects unknown/T0/env-sourced keys. Returns `{ applied, restartRequired, messageCode }`. |
| POST   | `/config/test`          | Token + Admin | Connection test with pending values. Body: `{ target,...pending }`. Records outcome to the backend-health tracker.                                                     |
| GET    | `/config/sync-report`   | Token + Admin | Env↔DB config-sync report (read-only), mirroring the CLI `--check` findings/summary/exitCode JSON.                                                                     |
| POST   | `/config/sync-from-env` | Token + Admin | Env→DB config-sync reconcile (web equivalent of CLI `--apply --yes`): writes env-sourced non-T0 registry values as plaintext, then invalidates the T2 cache.           |
| GET    | `/health`               | Token + Admin | Admin health snapshot: `200 { backends }` — full per-backend tracker state (code/hint/lastChecked); stateless token-claim admin check (no DB read).                    |

### 2.3 Middleware Used

- `authenticateToken`, `isAdmin` (inline middleware defined per module)

### 2.4 Request/Response Spec

#### userManagement

- **GET /users/pending:** 200: user array
- **GET /users:** 200: user array
- **POST /users:** Body: `{ username, email, password }`. 201: `{ messageCode, user }`
- **POST /users/:id/approve:** 200: `{ messageCode, user }`
- **POST /users/:id/reject:** 200: `{ messageCode, user }`
- **DELETE /users/:id:** 200: `{ messageCode, user }`

#### settings

- **GET /settings:** 200: settings object
- **PUT /settings:** Body: `{ registration_enabled }`. 200: `{ messageCode, settings }`

#### maintenance

- **POST /permissions/ensure-home-owner-admin:** 200: `{ success: true, updatedUsers, upgradedPaths, grantedPaths, removedSelfGrants, errors }`
- **POST /cleanup/orphaned:** 200: `{ messageCode, results: { deletedPermissionFiles, deletedUserFiles, deletedEmailIndexFiles, cleanedPermissionRequests, errors, gc: { tier1, tier2 }, orphanedNodes, pendingUploadNodes } }`
- **POST /maintenance/repair-sync:** Body: `{ nodeId, action }`. 200: `{ messageCode, result: { nodeId, action, status, path, detail } }`; 404 when node not found; 400 on invalid action; 409 on a state mismatch (`repairUploadNotPending` — node not in `pending_upload`, a required object_map row is missing, or `pending_upload` repair requested in WebDAV mode (S3 mode only); `repairUploadBlobMissing` — `complete` with an absent blob; `repairSyncRemoteMissing` — WebDAV `force-active` with the remote file absent).
- **DELETE /maintenance/perm-delete:** Body: `{ nodeId }`. 200: `{ messageCode, result: { nodeId, deletedCount } }`; 404 when the node does not exist (trashed rows included); 403 for non-admin.

#### migration

- **GET /migration/info:** 200: `{ source: 'webdav' | 's3', direction: 'webdav-to-s3' | 's3-to-webdav' }` (direction derived from the app config `WEA_FILE_STORAGE`); 403 for non-admin.
- **GET /migration/target-scan:** Params/body `{ targetBackend, pg?, sqlitePath? }`. 200: `{ backend, connected, schemaExists, tables: [{ name, rows }], totalRows, checkedAt }`; 400 on invalid/incomplete target payload; 403 for non-admin. (Full contract: `docs/spec/server/tools/metadata-migration.md`.)
- **POST /migration/blobs:** Body: `{ mode, force?, dest }` — no `direction`. The server derives the direction from the app config and validates `dest.type` equals the expected destination (webdav source → `'s3'`, s3 source → `'webdav'`). 202: `{ jobId }`; 400 on invalid payload (bad mode, dest config, or `dest.type` mismatch); 403 for non-admin; 409 when a migration job is already running.
- **POST /migration/metadata:** Body: `{ targetBackend, pg?, sqlitePath?, wipeTarget? }` — target backend must differ from the active backend. 202: `{ jobId }`; 400 on invalid payload; 403 for non-admin; 409 when the migration gate is active or a job is already running. (Full contract: `docs/spec/server/tools/metadata-migration.md`.)
- **GET /migration/jobs/:jobId:** 200: the in-memory store row — `{ jobId, type, direction, mode, status, stage, progress, total, current, results { copied, skipped, failed, errors }, errorMessage, configPersist, createdAt, completedAt }`. `progress` is type-specific: integer done-node count for blob jobs, `{ percent, currentLabel }` for metadata jobs; `current` is `string | null` (blob worker writes a path string). Job shape: `docs/spec/server/store/migrationJobStore.md`. 404 for unknown/expired job.
- **POST /migration/jobs/:jobId/cancel:** 200: `{ messageCode, jobId }`; 404 for unknown/expired job.

#### config

- **GET /config:** 200: `{ config }` (per-key source/tier, secrets masked).
- **PUT /config:** Body: `{ values: { key: value } }`. 200: `{ applied, restartRequired, messageCode }`; 400 on unknown key (`configUnknownKey`), T0-protected key, env-sourced key, or non-object `values`.
- **POST /config/test:** Body: `{ target: 'webdav' | 's3',...pending }`. 200: probe result; probe failure also reports to the backend-health tracker.
- **GET /config/sync-report:** 200: config-sync findings/summary/exitCode JSON.
- **POST /config/sync-from-env:** 200: sync result (writes env-sourced non-T0 values as plaintext, invalidates T2 cache).
- **GET /health:** 200: `{ backends }` per-backend tracker state.

#### reports

- **GET /reports:** 200: `{ reports: [{ id, kind, status, payload, created_at }] }` — newest first (`created_at DESC, id DESC`); `payload` is the persisted JSON doc (parsed object on both backends). 403 for non-admin.
- **GET /reports/:id:** 200: one row, same shape as the list entries; 404 when the row does not exist; 403 for non-admin.
- **POST /reports/:id/repair:** Body: `{ action: 'content_hash' | 'repair-sync' | 'perm-delete', nodeId?, repairAction? }`. 200: `{ messageCode, report, result? }` — `report` is the re-rendered row for `content_hash` and the UNCHANGED row for the `repair-sync`/`perm-delete` delegations; `result` carries the backfill summary (`content_hash`) or the delegated core's outcome (`repair-sync`/`perm-delete`). 404 for an unknown report id (`admin.reportNotFound`); 400 for an undispatchable row (`admin.repairNotAvailable` — unknown action, or `content_hash` requested on a non-`failsafe` row / a `failsafe` row without a `contentHashCompleteness` payload section); the `repair-sync`/`perm-delete` delegations surface the §2.2.3 status codes (400/404/409) unchanged. 403 for non-admin.

### 2.5 Service Layers

#### userService (`domains/admin/services/userService.js`)

| Function                                         | Description                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `createAdminUser({ username, email, password })` | Validates fields (min 6-char password), creates user folder, grants admin permission. Rollback on failure.    |
| `approvePendingUser(userId)`                     | Updates status to APPROVED, creates home folder, grants admin permission, sends approval email.               |
| `rejectPendingUser(userId, adminId)`             | Revokes all permissions and requests, updates status to REJECTED, sends rejection email.                      |
| `deleteUserCascade(userId, adminId)`             | Full cleanup: permission requests, permissions files, user record. Prevents self-deletion and admin deletion. |

#### cleanupService (`domains/admin/services/cleanupService.js`)

| Function                            | Description                                                                                                                                                                                                                                                             |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cleanupOrphanedData()`             | Removes orphaned metadata (e.g. permission/share rows referencing missing nodes) and stale permission requests from the DB; persists the full result as an `admin_reports` row (`kind='cleanup'`) before returning.                                                     |
| `ensureHomeOwnerAdminForAllUsers()` | Ensures each non-admin user has admin on their home node; removes redundant self-grants on the user's own subtree (home-root admin preserved). The boot completeness probe rides `runStartupFailSafeRecovery` (`maintenanceScheduler.md`) — no kick from this function. |

#### adminReportsService (`domains/admin/services/adminReportsService.js`)

Best-effort `admin_reports` plumbing + the content-hash completeness machinery. The
`admin_reports` store is `store/adminReportsStore.js` (facade over
`AdminReportsRepository`, sqlite/postgres twins). Writes honour `WEA_SKIP_ADMIN_REPORTS`
(all writes no-op) and never fail their caller. Writer plumbing (unchanged):
`ADMIN_REPORT_KINDS` = `gc|migration|failsafe|night_eval|cleanup` constant,
`ADMIN_REPORT_STATUSES` = `ok|partial`, `createAdminReportsWriter({ insertReport })`
factory + shared `getAdminReportsWriter()` singleton (now wired to the store), and
`resolveAdminReportStatus(result)` — a missing/throwing store write is caught,
warn-logged and returns `null`, so reporting never fails GC/cleanup/boot.

| Function                           | Description                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `collectContentHashCompleteness()` | Boot completeness probe section provider: non-blocking `COUNT(*) WHERE content_hash IS NULL` via FileNodeRepository; warn-logs when `nullCount > 0` and on count failure; returns the `contentHashCompleteness` section (`{ nullCount, checkedAt }`; `nullCount: null` + `error` when the count fails). Never throws. Persists nothing itself — `runStartupFailSafeRecovery` merges the section into its single `kind='failsafe'` row.         |
| `backfillContentHashes(...)`       | Streams `filecache` rows with `content_hash IS NULL` in batches; per node downloads the blob (S3 active object key / WebDAV display path; trashed WebDAV rows resolve to their `/.wea-trash/` path) and hashes it (`sha256HexLower`), then updates `WHERE content_hash IS NULL` only — idempotent, only NULL rows are ever touched. Missing blobs are recorded as errors, never fatal. Returns `{ backfilled, nullCount, errors, checkedAt }`. |
| `repairAdminReport(row, params)`   | Dispatch table for `POST /reports/:id/repair`: `content_hash` (failsafe rows with the section only — runs the backfill and re-renders the row), `repair-sync` (§2.2.3 fail-safe repair core), `perm-delete` (§2.2.3 trash purge core). Throws 404 `admin.reportNotFound` / 400 `admin.repairNotAvailable`.                                                                                                                                     |

#### migrationService (`domains/admin/services/migrationService.js`)

| Function                                       | Description                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run({ destConfig, mode, force, onProgress })` | Snapshot traversal + per-node copy + direction-specific `object_map` rules (incl. the inline flip for s3→webdav) + automatic resume + dry-run/failure isolation. Direction is derived internally from the injected `fileStorageMode`; `destConfig.type` must match the expected destination. Returns `{ copied, skipped, failed, errors }`. Full contract: `docs/spec/server/services/migrationService.md`. |

### 2.6 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.7 Integration Test Scenarios

- [ ] Non-admin returns 403
- [ ] Get/update settings
- [ ] Approve, reject, delete users
- [ ] Create user with validation
- [ ] Cleanup endpoints return results
- [ ] Migration: start returns 202 `{ jobId }`; poll job status; cancel a running job
- [ ] Migration: non-admin gets 403; invalid payload gets 400; running job conflict gets 409; unknown job gets 404
- [ ] Admin reports: non-admin gets 403 on `GET /reports` and `POST /reports/:id/repair`; the list is newest-first and `payload` is the persisted JSON doc
- [ ] A `cleanup/orphaned` run produces exactly one new `admin_reports` row with the same result body the response returned
- [ ] `POST /reports/:id/repair` on a `failsafe` content-hash row backfills all NULL `filecache.content_hash`, re-renders the row with `nullCount: 0`, is idempotent (re-running changes nothing) and only ever touches `content_hash IS NULL` rows
- [ ] The startup fail-safe recovery persists a SINGLE `kind='failsafe'` row whose payload carries both the scan report and the `contentHashCompleteness` section (`{ nullCount, checkedAt }`), warn-logs when NULL rows exist, and marks `status` `partial` while they exist; `content_hash` repair re-renders preserve the scan payload keys

---

## 3. AI-platform target contracts (AI platform — target, lands with P0/P1/P4 as noted)

**Rows below are TARGET contracts, not current behavior** — when a task lands, its rows merge into §2.2/§2.4 and the marker is removed. Wire casing per CODING_STYLE.md Express Patterns (snake_case responses, camelCase request bodies).

### 3.1 Routes (target)

All P0 route rows have landed and moved to §2.2.6.

### 3.2 Field/behavior additions (target)

- **(P0)** **`probeLlm` slot registration (plumbing only; the `target: 'llm'` route acceptance itself is the P1 row below):** `server/infrastructure/backendProbe.js` exposes `registerProbeTarget(target, handler)` + the reserved `PROBE_TARGET_LLM = 'llm'` slot. Registered handlers win over the built-in targets; an unregistered reserved slot keeps the existing 400 `serverErrors.setup.testFailed` "Unsupported target" behavior. The LLM probe suite (`llmAdapter.md` §2.3 `probeLlm()`) registers without editing `backendProbe.js`; probe outcomes land in the `ai.<role>` tracker rows (`backendHealth.md`).
- **(P1)** `POST /config/test` accepts `target: 'llm'` with per-role pending values; outcome recorded to the backend-health tracker via the `probeLlm` slot (registered P0) and rendered as **per-role probe chips** by the admin config UI. Probe failure ≠ save failure (test-only endpoint semantics unchanged).
- **(P1)** `GET /health` (`backends` snapshot) gains tracker rows: **`vectorOps: 'native' | 'fallback_js'`** — a **performance warning only, never an AI-feature gate** (fallback keeps every feature on) — and **`ai.<role>` probe states** (`embed`/`chat`: `not_configured | preparing(phase, progress) | probe_failed(reason) | partial | ok`; hot re-probe on config change). Consumed by the health card and the AI governance panel (P4); never exposed on the public health/`settings/public` surface beyond the existing `ai:{embed,chat}` booleans.
- **(landed)** Unified re-embed/backfill admin action: ONE admin-launched, rate-limited
  launcher (`POST /api/admin/ai/reembed`, §2.2.7) covers both the initial coverage pass
  over an existing corpus and a post-model-change full re-embed — a single UI/UX surface;
  no automatic bulk enqueue exists in either case. The launcher seeds the text + media
  plan, bumps the four generation counters, and writes the settings-journal undo row.

### 3.3 Verification (appends §2.7)

- [ ] (target) `config/test` with `target:'llm'` updates the matching `ai.<role>` tracker row only (per-role isolation).
- [ ] (target) `vectorOps=fallback_js` appears in `/health` yet no AI feature endpoint refuses service because of it.
