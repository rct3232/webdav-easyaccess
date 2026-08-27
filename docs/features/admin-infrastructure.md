# Admin and Infrastructure

This feature document focuses on admin-facing behavior and operational intent. For implementation contracts, use:

- route contracts: `docs/spec/server/routes/*.md`
- middleware/data-flow architecture: `docs/ARCHITECTURE.md`
- setup/migration/env operations: `docs/SETUP.md`
- metadata schema constraints: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

---

## Overview

Administrators are users with `is_admin` set. Admin routes require a valid JWT and admin authorization; non-admin callers receive 403. Admin capabilities include settings management, signup approval/rejection (optionally with email notifications), user lifecycle controls, ACL maintenance, and cleanup operations. Health and WebDAV diagnostic endpoints are unauthenticated and remain available for monitoring/UI checks.

---

## Specification

### Admin role and middleware

- **isAdmin:** Determined by `user.is_admin` (from metadata store). Stored in JWT payload for quick checks; admin routes re-load user and enforce `is_admin`.
- **Admin middleware:** Each admin route module (`server/domains/admin/routes/settings.js`, `userManagement.js`, `maintenance.js`) defines a local `isAdmin` handler that loads the user by `req.user.id` and returns 403 with `errorCode: admin.adminRequired` if not admin. All admin routes use `authenticateToken` then `isAdmin`.
- **Pipeline boundary:** Full middleware ordering and exclusions are documented in `docs/ARCHITECTURE.md` and are not duplicated here.

### Admin APIs

| Area | Endpoints | Description |
|------|-----------|-------------|
| Settings | `GET /api/admin/settings`, `PUT /api/admin/settings` | Get/update system settings (e.g. `registration_enabled`). |
| Users | `GET /api/admin/users/pending`, `GET /api/admin/users`, `POST /api/admin/users` | Pending signups, list all users, add user. |
| Approval | `POST /api/admin/users/:id/approve`, `POST /api/admin/users/:id/reject` | Approve or reject signup; optional email (sendApprovalEmail, sendRejectionEmail). |
| User management | `DELETE /api/admin/users/:id` | Delete user (cannot delete self or other admins). |
| Permissions | `GET /api/admin/folders/list`, `PUT /api/admin/users/:id/permissions` | List folders for permission UI; set user folder permissions. |
| Cleanup | `POST /api/admin/permissions/ensure-home-owner-admin`, `POST /api/admin/cleanup/orphaned` | Ensure home owner has admin on home folder; remove redundant self-grants on users' own subtrees; clean orphaned metadata. |
| Maintenance (GC) | `POST /api/admin/maintenance/gc`, `POST /api/admin/maintenance/repair-sync` | Run one orphaned-blob GC cycle; manually resolve `orphaned_node` rows. |
| Blob migration | `GET /api/admin/migration/info`, `POST /api/admin/migration/blobs`, `GET /api/admin/migration/jobs/:jobId`, `POST /api/admin/migration/jobs/:jobId/cancel` | Fetch derived direction/source, start a bidirectional WebDAV ↔ S3 blob migration, poll its status, cancel it. Spec: `docs/spec/server/tools/blob-migration.md`. |

See [api.md](../api.md) for exact methods, paths, and bodies.

### Health and WebDAV diagnostics

- **GET /api/health** — No auth. Returns e.g. `{ status: "ok", messageCode }`. Used for liveness/monitoring.
- **GET /api/webdav/test** — No auth. Tests WebDAV connectivity.
- **GET /api/webdav/info** — No auth. Returns WebDAV URL info (e.g. for UI display).

These routes bypass the authenticated middleware chain (see `docs/ARCHITECTURE.md`).

### Per-route middleware pipeline

Canonical middleware flow, middleware responsibilities, and route exclusions are documented in `docs/ARCHITECTURE.md`.

### Metadata store and locking

- **Storage backend selection:** `WEA_STORAGE_BACKEND` (`sqlite` default, `postgresql`) with stable store interfaces across backends. `fs` and `webdav` metadata backends are removed (Phase 7).
- **Canonical schema/constraints:** `server/store/postgresql/ddl/001_initial_normalized_schema.sql`.
- **Canonical env/runtime parser:** `server/store/storage.js`.
- **Locking contract:** `server/infrastructure/lockManager.js` (backend-specific lock implementation; feature-level guarantee is race-safe metadata writes). Supports PostgreSQL and SQLite lock strategies with TTL expiry and stale-lock cleanup. Exports `acquireLock()` and `withLock()`.
- **Blob migration workflow:** bidirectional WebDAV ↔ S3 blob migration is available in-app (admin API `POST/GET/cancel /api/admin/migration/*` with a settings-tab "Storage migration" UI) and as a standalone CLI (`server/scripts/migrateBlobs.js`). Full spec: `docs/spec/server/tools/blob-migration.md`; service contract: `docs/spec/server/services/migrationService.md`.

### Infrastructure layer

Cross-cutting infrastructure modules reside in `server/infrastructure/`:

- **Health routes** (`healthRoutes.js`): Unauthenticated `GET /api/health` endpoint for liveness probes. Mounted at `/api`.
- **WebDAV diagnostic routes** (`webdavRoutes.js`): No-auth endpoints `GET /api/webdav/test` and `GET /api/webdav/info` for connectivity checks and URL display. Connection test logic is extracted to `webdavTest.js`.
- **Lock manager** (`lockManager.js`): Distributed lock abstraction supporting PostgreSQL and SQLite backends with retry, TTL expiry, and stale-lock cleanup.
- **SQLite schema init** (`sqliteSchemaInit.js`): Converts PostgreSQL DDL to SQLite-compatible SQL for bootstrap when `WEA_STORAGE_BACKEND=sqlite`.

These modules are mounted in `server/index.js` alongside the domain routes.

---

## Flows

### Admin: signup approval and email

```mermaid
sequenceDiagram
    participant A as Admin
    participant S as Server
    participant E as Email (optional)

    A->>S: GET /api/admin/users/pending
    S-->>A: [pending users]
    A->>S: POST /api/admin/users/:id/approve
    S->>S: Update user status, create home folder, set permissions
    S->>E: sendApprovalEmail (if configured)
    S-->>A: 200 messageCode
```

Reject flow: `POST /api/admin/users/:id/reject`; optional `sendRejectionEmail`.

### Admin: user permissions and cleanup

- **Set permissions:** Admin calls `PUT /api/admin/users/:id/permissions` with body containing permission list; server revokes existing grants and applies the new permission set in the DB (`permissions_user_paths` / `permissions_user_files`).
- **Ensure home owner admin:** `POST /api/admin/permissions/ensure-home-owner-admin` ensures each user’s home folder has that user as admin (e.g. after recovery), and removes redundant self-grants the user holds on their own subtree (a one-time reconciliation for data created before self-grants were removed).
- **Orphan cleanup:** `POST /api/admin/cleanup/orphaned` removes orphaned metadata (e.g. permissions/shares pointing to missing paths); response includes result summary.
- **Garbage collection:** `POST /api/admin/maintenance/gc` runs a two-tier GC cycle (DB-driven orphaned `object_map` rows → S3 blob delete; S3 `ListObjectsV2` reconciliation against the active `s3_key` set). Optionally scheduled via `GC_INTERVAL_MS`; orphan age threshold via `GC_ORPHAN_TTL_DAYS`. Service contract: `docs/spec/server/services/gcService.md`.
- **Fail-safe recovery:** `POST /api/admin/maintenance/repair-sync` resolves `file_nodes` stuck in `sync_status='orphaned_node'` (`retry-delete` or `force-active`). A startup hook scans and reports stuck nodes without auto-deleting. Service contract: `docs/spec/server/services/gcService.md`.

### API pipeline

- Authenticated file/folder request: Auth → User Loader → Route handler (nodeId-based; may perform further ACL checks per [permissions.md](permissions.md)).

### Metadata lock usage

- Before updating shared metadata (e.g. user index, permissions, settings), server acquires a lock by name (e.g. `users-index`, `perm:${userId}`). On success, performs read-modify-write then releases lock. On failure (e.g. timeout), returns error. TTL in lock file allows recovery after server crash.

---

## Testing

Feature-level verification scope (behavioral outcomes):

For the complete browser-flow inventory and rollout plan for admin-facing UI coverage, see [../E2E_COVERAGE_PLAN.md](../E2E_COVERAGE_PLAN.md). Keep this feature doc focused on behavior and operational intent rather than a full E2E checklist.

- **Non-admin 403:** Authenticated non-admin calling any admin route (e.g. `GET /api/admin/settings`, `POST /api/admin/users/:id/approve`) receives 403 with `errorCode` for admin required.
- **Approve/reject and email:** Approve sets user to approved and prepares expected initial access; reject sets status to rejected. If email is configured, notification side effects are validated.
- **Cleanup:** Orphan cleanup returns expected shape (e.g. removed count or list); no side effects on valid metadata.
- **Health and WebDAV:** `GET /api/health` returns 200 and `status: "ok"`; `GET /api/webdav/test` and `GET /api/webdav/info` return expected response format without auth.
- **Meta path guard:** Requests touching reserved metadata paths are blocked for non-admin callers.

Detailed store-level and route-level verification matrices belong in `docs/spec/server/store/*.md`
and `docs/spec/server/routes/*.md`. Use [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) for test design.
