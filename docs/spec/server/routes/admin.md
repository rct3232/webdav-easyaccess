# admin routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/admin` |
| Role | Admin-only: settings, user management (pending, list, approve, reject, delete, create), folder list, user permissions, cleanup, blob migration. |

---

## 2. Implementation Spec

The original monolithic `server/routes/admin.js` has been split into separate route modules under `server/domains/admin/routes/`, each with dedicated service layers.

### 2.1 Route Modules

| Module | Source | Mount Path | Test File |
|--------|--------|------------|-----------|
| userManagement | `server/domains/admin/routes/userManagement.js` | `/api/admin` | `server/domains/admin/routes/__tests__/admin.test.js` |
| settings | `server/domains/admin/routes/settings.js` | `/api/admin`, `/api/settings` (public) | `server/domains/admin/routes/__tests__/settings.test.js` |
| maintenance | `server/domains/admin/routes/maintenance.js` | `/api/admin` | `server/domains/admin/routes/__tests__/admin.test.js` |
| migration | `server/domains/admin/routes/migration.js` | `/api/admin` | `server/domains/admin/routes/__tests__/migration.test.js` |

### 2.2 Route List

#### 2.2.1 userManagement (`/api/admin`)

Admin-only user lifecycle management. Service: `domains/admin/services/userService.js`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/users/pending` | Token + Admin | Pending signup approvals. |
| GET | `/users` | Token + Admin | List all users. |
| POST | `/users` | Token + Admin | Add user. Body: username, email, password. |
| POST | `/users/:id/approve` | Token + Admin | Approve signup. Creates home folder, grants admin on it. |
| POST | `/users/:id/reject` | Token + Admin | Reject signup. Revokes all permissions and requests. |
| DELETE | `/users/:id` | Token + Admin | Delete user cascade. Cannot delete self or other admins. |
| PUT | `/users/:id/permissions` | Token + Admin | Bulk update folder permissions. Body: `{ permissions }`. |

#### 2.2.2 settings (`/api/admin`)

System configuration. Also exposes a public endpoint at `/api/settings/public`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/settings` | Token + Admin | Get system settings. |
| PUT | `/settings` | Token + Admin | Update settings. Body: registration_enabled, etc. |

#### 2.2.3 maintenance (`/api/admin`)

System maintenance operations. Service: `domains/admin/services/cleanupService.js`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/folders/list` | Token + Admin | List folders for permission UI (single level). |
| POST | `/permissions/ensure-home-owner-admin` | Token + Admin | Ensure each non-admin user has admin on their home node and remove redundant self-grants on their own subtree. |
| POST | `/cleanup/orphaned` | Token + Admin | Clean orphaned metadata files and permission requests. Also runs one GC cycle and reports `orphaned_node` status (see §2.2.3.1). |
| POST | `/maintenance/gc` | Token + Admin | Run one garbage-collection cycle (Tier 1 DB-driven + Tier 2 S3 scan) for orphaned blobs. Service: `server/service/gcService.js`. |
| POST | `/maintenance/repair-sync` | Token + Admin | Manually resolve an `orphaned_node`. Body: `{ nodeId, action: 'retry-delete' \| 'force-active' }`. Service: `server/service/failSafeService.js`. |

#### 2.2.3.1 `cleanup/orphaned` response shape (additive keys)

The existing result keys (`deletedPermissionFiles`, `deletedUserFiles`, `deletedEmailIndexFiles`, `cleanedPermissionRequests`, `errors`) are unchanged. Two additive keys are present:

- `gc: { tier1: { orphanedRows, deletedBlobs, deletedRows, errors }, tier2: { scannedKeys, untrackedKeys, deletedKeys, skipped, errors } }`
- `orphanedNodes: Array<{ nodeId, path }>`

#### 2.2.4 migration (`/api/admin`)

Bidirectional WebDAV ↔ S3 blob migration (202 + poll contract). Service: `domains/admin/services/migrationService.js`; job tracking: `domains/admin/stores/migrationJobStore.js`. Worker runs via `setImmediate` and honours the `WEA_SKIP_MIGRATION_WORKER` test seam (skips worker scheduling without changing defaults).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/migration/blobs` | Token + Admin | Start a blob migration job. Body: `{ direction: 'webdav-to-s3' \| 's3-to-webdav', mode: 'dry-run' \| 'apply', force?, dest: { type:'s3', ... } \| { type:'webdav', ... } }`. Returns `202 { jobId }`. |
| GET | `/migration/jobs/:jobId` | Token + Admin | Get migration job status/progress. Returns `200 { jobShape }`. |
| POST | `/migration/jobs/:jobId/cancel` | Token + Admin | Cancel a running migration job. Returns `200 { messageCode, jobId }`. |

Destination config fields and the authoritative migration rules are documented in `docs/spec/server/tools/blob-migration.md`.

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
- **PUT /users/:id/permissions:** Body: `{ permissions: [{ folderPath, permission }] }`. 200

#### settings

- **GET /settings:** 200: settings object
- **PUT /settings:** Body: `{ registration_enabled }`. 200: `{ messageCode, settings }`

#### maintenance

- **GET /folders/list:** 200: folder list (sorted by name)
- **POST /permissions/ensure-home-owner-admin:** 200: `{ success: true, updatedUsers, upgradedPaths, grantedPaths, removedSelfGrants, errors }`
- **POST /cleanup/orphaned:** 200: `{ messageCode, results: { deletedPermissionFiles, deletedUserFiles, deletedEmailIndexFiles, cleanedPermissionRequests, errors, gc: { tier1, tier2 }, orphanedNodes } }`
- **POST /maintenance/gc:** 200: `{ messageCode, results: { tier1: { orphanedRows, deletedBlobs, deletedRows, errors }, tier2: { scannedKeys, untrackedKeys, deletedKeys, skipped, errors } } }`
- **POST /maintenance/repair-sync:** Body: `{ nodeId, action }`. 200: `{ messageCode, result: { nodeId, action, status, path, detail } }`; 404 when node not found; 400 on invalid action.

#### migration

- **POST /migration/blobs:** Body: `{ direction, mode, force?, dest }`. 202: `{ jobId }`; 400 on invalid payload (bad direction/mode or dest config); 403 for non-admin; 409 when a migration job is already running.
- **GET /migration/jobs/:jobId:** 200: migration job shape `{ jobId, direction, mode, status, progress, total, current, results { copied, skipped, failed, errors }, errorMessage, createdAt, completedAt }`; 404 for unknown/expired job.
- **POST /migration/jobs/:jobId/cancel:** 200: `{ messageCode, jobId }`; 404 for unknown/expired job.

### 2.5 Service Layers

#### userService (`domains/admin/services/userService.js`)

| Function | Description |
|----------|-------------|
| `createAdminUser({ username, email, password })` | Validates fields (min 6-char password), creates user folder, grants admin permission. Rollback on failure. |
| `approvePendingUser(userId)` | Updates status to APPROVED, creates home folder, grants admin permission, sends approval email. |
| `rejectPendingUser(userId, adminId)` | Revokes all permissions and requests, updates status to REJECTED, sends rejection email. |
| `deleteUserCascade(userId, adminId)` | Full cleanup: permission requests, permissions files, user record. Prevents self-deletion and admin deletion. |
| `bulkUpdateUserPermissions(userId, permissionEntries)` | Revokes all existing permissions, then grants new ones in batch. |

#### cleanupService (`domains/admin/services/cleanupService.js`)

| Function | Description |
|----------|-------------|
| `cleanupOrphanedData()` | Removes orphaned metadata (e.g. permission/share rows referencing missing nodes) and stale permission requests from the DB. |
| `ensureHomeOwnerAdminForAllUsers()` | Ensures each non-admin user has admin on their home node; removes redundant self-grants on the user's own subtree (home-root admin preserved). |

#### migrationService (`domains/admin/services/migrationService.js`)

| Function | Description |
|----------|-------------|
| `run({ direction, destConfig, mode, force, onProgress })` | Snapshot traversal + per-node copy + direction-specific `object_map` rules (incl. the inline flip for s3→webdav) + automatic resume + dry-run/failure isolation. Returns `{ copied, skipped, failed, errors }`. Full contract: `docs/spec/server/services/migrationService.md`. |

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
