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
| maintenance    | `server/domains/admin/routes/maintenance.js`    | `/api/admin`                           | `server/domains/admin/routes/__tests__/admin.test.js`     |
| migration      | `server/domains/admin/routes/migration.js`      | `/api/admin`                           | `server/domains/admin/routes/__tests__/migration.test.js` |

### 2.2 Route List

#### 2.2.1 userManagement (`/api/admin`)

Admin-only user lifecycle management. Service: `domains/admin/services/userService.js`.

| Method | Path                     | Auth          | Description                                              |
| ------ | ------------------------ | ------------- | -------------------------------------------------------- |
| GET    | `/users/pending`         | Token + Admin | Pending signup approvals.                                |
| GET    | `/users`                 | Token + Admin | List all users.                                          |
| POST   | `/users`                 | Token + Admin | Add user. Body: username, email, password.               |
| POST   | `/users/:id/approve`     | Token + Admin | Approve signup. Creates home folder, grants admin on it. |
| POST   | `/users/:id/reject`      | Token + Admin | Reject signup. Revokes all permissions and requests.     |
| DELETE | `/users/:id`             | Token + Admin | Delete user cascade. Cannot delete self or other admins. |

#### 2.2.2 settings (`/api/admin`)

System configuration. Also exposes a public endpoint at `/api/settings/public`.

| Method | Path        | Auth          | Description                                       |
| ------ | ----------- | ------------- | ------------------------------------------------- |
| GET    | `/settings` | Token + Admin | Get system settings.                              |
| PUT    | `/settings` | Token + Admin | Update settings. Body: registration_enabled, etc. |

#### 2.2.3 maintenance (`/api/admin`)

System maintenance operations. Service: `domains/admin/services/cleanupService.js`.

| Method | Path                                   | Auth          | Description                                                                                                                                      |
| ------ | -------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| POST   | `/permissions/ensure-home-owner-admin` | Token + Admin | Ensure each non-admin user has admin on their home node and remove redundant self-grants on their own subtree.                                   |
| POST   | `/cleanup/orphaned`                    | Token + Admin | Clean orphaned metadata files and permission requests. Also runs one GC cycle and reports `orphaned_node` status (see §2.2.3.1).                 |
| POST   | `/maintenance/repair-sync`             | Token + Admin | Manually resolve a stuck node. `orphaned_node`: `{ nodeId, action: 'retry-delete' \| 'force-active' }` (WebDAV mode: `retry-delete` also deletes the remote blob/file bottom-up over the subtree; `force-active` first verifies the remote file exists and refuses with 409 otherwise). `pending_upload` (DEF-12/13, **S3 mode only** — refused with 409 in WebDAV mode, where healthy file nodes intentionally stay `pending_upload`): `{ nodeId, action: 'complete' \| 'restore-previous' \| 'delete' \| 'auto' }`. Service: `server/service/failSafeService.js`. |
| DELETE | `/maintenance/perm-delete`             | Token + Admin | Permanently delete one node (hard delete, bypasses the trash). Body: `{ nodeId }`. WebDAV mode: remote cleanup FIRST (trashed node → delete `/.wea-trash/<nodeId>`; live node → bottom-up display-path delete via `webdavRemoteOps`), then `fileNodeService.deleteNode` (FK cascade removes object_map/filecache/closure/permission/share/recent rows). 404 when the node does not exist (trashed rows included). **Interim channel** — the trash purge/empty-trash routes (DEF-16 P3) will supersede it as the user-facing permanent delete; this admin route remains the maintenance/E2E hard-delete entry point. |

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

| Method | Path                            | Auth          | Description                                                                                                                                                                                                                                                                     |
| ------ | ------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/migration/info`               | Token + Admin | Get the derived migration context. Returns `200 { source: 'webdav' \| 's3', direction: 'webdav-to-s3' \| 's3-to-webdav' }` (direction derived from the app config).                                                                                                             |
| GET    | `/migration/target-scan`        | Token + Admin | Read-only scan of an explicit (non-active) metadata target backend. Params/body: `{ targetBackend, pg?, sqlitePath? }` (PG also accepted as flat `?host=&port=...` query params). Returns `200 { backend, connected, schemaExists, tables: [{ name, rows }], totalRows, checkedAt }`. |
| POST   | `/migration/blobs`              | Token + Admin | Start a blob migration job. Body: `{ mode: 'dry-run' \| 'apply', force?, dest: { type:'s3', ... } \| { type:'webdav', ... } }` — no `direction`; the server derives it from the app config and validates `dest.type` matches the expected destination. Returns `202 { jobId }`. |
| POST   | `/migration/metadata`           | Token + Admin | Start a metadata DB migration job. Body: `{ targetBackend, pg?, sqlitePath?, wipeTarget? }` — target backend must be the non-active one. Returns `202 { jobId }`; cancel = ROLLBACK of the target transaction. Full contract: `docs/spec/server/tools/metadata-migration.md`. |
| GET    | `/migration/jobs/:jobId`        | Token + Admin | Get migration job status/progress. Returns `200 { jobShape }` — the in-memory store row (`type`, `stage`, `configPersist` etc.; `progress` is type-specific). See `docs/spec/server/store/migrationJobStore.md`.                                                                                  |
| POST   | `/migration/jobs/:jobId/cancel` | Token + Admin | Cancel a running migration job. Returns `200 { messageCode, jobId }`.                                                                                                                                                                                                           |

Destination config fields and the authoritative blob-migration rules are documented in `docs/spec/server/tools/blob-migration.md`.

#### 2.2.5 config (`/api/admin`)

Effective-configuration management (env → DB → defaults registry). Service: the config resolver
(`server/infrastructure/configResolver.js`); config-sync endpoints delegate to
`server/service/configSyncService.js` — the same shared core as the `config-sync` CLI. See
`docs/spec/server/tools/config-sync.md`.

| Method | Path                    | Auth          | Description                                                                                                                                               |
| ------ | ----------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/config`               | Token + Admin | Get effective config: `200 { config }` — every registry key with source/tier + masked secrets.                                                            |
| PUT    | `/config`               | Token + Admin | Update allowlisted config keys. Body: `{ values }` — plaintext writes to DB; rejects unknown/T0/env-sourced keys. Returns `{ applied, restartRequired, messageCode }`. |
| POST   | `/config/test`          | Token + Admin | Connection test with pending values. Body: `{ target, ...pending }`. Records outcome to the backend-health tracker.                                        |
| GET    | `/config/sync-report`   | Token + Admin | Env↔DB config-sync report (read-only), mirroring the CLI `--check` findings/summary/exitCode JSON.                                                        |
| POST   | `/config/sync-from-env` | Token + Admin | Env→DB config-sync reconcile (web equivalent of CLI `--apply --yes`): writes env-sourced non-T0 registry values as plaintext, then invalidates the T2 cache. |
| GET    | `/health`               | Token + Admin | Admin health snapshot: `200 { backends }` — full per-backend tracker state (code/hint/lastChecked); stateless token-claim admin check (no DB read).          |

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
- **POST /config/test:** Body: `{ target: 'webdav' | 's3', ...pending }`. 200: probe result; probe failure also reports to the backend-health tracker.
- **GET /config/sync-report:** 200: config-sync findings/summary/exitCode JSON.
- **POST /config/sync-from-env:** 200: sync result (writes env-sourced non-T0 values as plaintext, invalidates T2 cache).
- **GET /health:** 200: `{ backends }` per-backend tracker state.

### 2.5 Service Layers

#### userService (`domains/admin/services/userService.js`)

| Function                                               | Description                                                                                                   |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| `createAdminUser({ username, email, password })`       | Validates fields (min 6-char password), creates user folder, grants admin permission. Rollback on failure.    |
| `approvePendingUser(userId)`                           | Updates status to APPROVED, creates home folder, grants admin permission, sends approval email.               |
| `rejectPendingUser(userId, adminId)`                   | Revokes all permissions and requests, updates status to REJECTED, sends rejection email.                      |
| `deleteUserCascade(userId, adminId)`                   | Full cleanup: permission requests, permissions files, user record. Prevents self-deletion and admin deletion. |

#### cleanupService (`domains/admin/services/cleanupService.js`)

| Function                            | Description                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `cleanupOrphanedData()`             | Removes orphaned metadata (e.g. permission/share rows referencing missing nodes) and stale permission requests from the DB.                    |
| `ensureHomeOwnerAdminForAllUsers()` | Ensures each non-admin user has admin on their home node; removes redundant self-grants on the user's own subtree (home-root admin preserved). |

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
