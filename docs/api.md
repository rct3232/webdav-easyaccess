# API Reference

This document lists all REST API endpoints. The server serves under the `/api` prefix. Use it together with [shared-contracts.md](shared-contracts.md) for error formats and shared constants.

---

## Common

- **Base URL:** `/api`
- **Authentication:** Where required, send `Authorization: Bearer <JWT>`. Some endpoints accept an optional share token via header or query (documented below).
- **Error responses:** JSON body with `errorCode` (i18n key) and optional `params`. See [shared-contracts.md#error-response-format](shared-contracts.md#error-response-format). HTTP status is 4xx/5xx.

---

## Auth

| Method | Path                 | Auth  | Description                                                                                    |
| ------ | -------------------- | ----- | ---------------------------------------------------------------------------------------------- |
| POST   | `/api/auth/register` | None  | Sign up. Body: e.g. username, email, password.                                                 |
| POST   | `/api/auth/login`    | None  | Login. Returns `user`, `token` (and optionally refresh token). May return 429 if rate limited. |
| POST   | `/api/auth/refresh`  | None  | Refresh access token using refresh token in body.                                              |
| GET    | `/api/auth/me`       | Token | Current user info.                                                                             |

---

## Users

| Method | Path                         | Auth          | Description                                                                                            |
| ------ | ---------------------------- | ------------- | ------------------------------------------------------------------------------------------------------ |
| GET    | `/api/users`                 | Token         | List users (e.g. for share dialogs).                                                                   |
| GET    | `/api/users/approved`        | Token         | List approved users.                                                                                   |
| GET    | `/api/users/:id`             | Token         | Get user by id.                                                                                        |
| PUT    | `/api/users/:id/password`    | Token         | Change password (body: `password` — new password only).                                                |
| PUT    | `/api/users/:id/email`       | Token         | Update email.                                                                                          |
| PUT    | `/api/users/:id/permissions` | Token + Admin | Set user folder permissions (admin only). Body: `permissions` (array of `{ folderPath, permission }`). |

---

## Files and Folders

| Method | Path                                      | Auth           | Description                                                                                                                                                                                                                         |
| ------ | ----------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/files/list`                         | Token or share | List folder contents. Query: `nodeId` (parent directory node; omit for root).                                                                                                                                                       |
| GET    | `/api/files/ancestors`                    | Token or share | Get the ancestor chain for breadcrumbs. Query: `nodeId`. Returns `{ ancestors: [{ nodeId, name }] }` ordered root→current (current folder last, including itself); 400 if `nodeId` missing/invalid; 404 if the node does not exist. |
| GET    | `/api/files/download`                     | Token or share | Download file. Query: `nodeId`; optional `inline` (true/false).                                                                                                                                                                     |
| POST   | `/api/files/upload`                       | Token          | Upload file. Multipart: `file`; form fields: `parentNodeId`, `onConflict` (error, overwrite, skip), optional `relativePath`.                                                                                                        |
| PUT    | `/api/files/rename`                       | Token          | Rename. Body: `{ nodeId, newName }`.                                                                                                                                                                                                |
| POST   | `/api/files/move`                         | Token          | Move one node. Body: `{ nodeId, destinationParentNodeId }`.                                                                                                                                                                         |
| POST   | `/api/files/copy`                         | Token          | Copy one node. Body: `{ nodeId, destinationParentNodeId }`, optional `newName`.                                                                                                                                                     |
| DELETE | `/api/files/delete`                       | Token          | Delete one node. Body: `{ nodeId }`.                                                                                                                                                                                                |
| POST   | `/api/files/batch-move`                   | Token          | Move items. Body: `{ moves: [{ sourceNodeId, destinationParentNodeId }] }`, optional `onConflict` (error, overwrite, skip). Returns 202 + `jobId`.                                                                                  |
| POST   | `/api/files/batch-copy`                   | Token          | Copy items. Body: `{ copies: [{ sourceNodeId, destinationParentNodeId, newName }] }`, optional `onConflict`. Returns 202 + `jobId`.                                                                                                 |
| POST   | `/api/files/batch-delete`                 | Token          | Delete items. Body: `{ nodeIds }`. Returns 202 + `jobId`.                                                                                                                                                                           |
| POST   | `/api/files/download-multiple`            | Token or share | ZIP multiple files/folders. Body: `{ nodeIds }`; optional `downloadId`.                                                                                                                                                             |
| GET    | `/api/files/download-progress/:id`        | Token or share | Progress of ZIP download.                                                                                                                                                                                                           |
| GET    | `/api/files/bulk-operation/:jobId`        | Token          | Bulk job status.                                                                                                                                                                                                                    |
| POST   | `/api/files/bulk-operation/:jobId/cancel` | Token          | Cancel bulk operation.                                                                                                                                                                                                              |
| POST   | `/api/files/check-conflicts`              | Token          | Check name conflicts before paste. Body: `{ operations, limit }` (`limit` boolean, default true).                                                                                                                                   |
| POST   | `/api/files/metadata`                     | Token or share | Get metadata for nodeIds. Body: `{ nodeIds }`.                                                                                                                                                                                      |
| POST   | `/api/files/resolve-path`                 | Token          | Resolve a legacy path string to a nodeId. Body: `{ path }`. Returns `{ nodeId }`; 404 if the path does not resolve.                                                                                                                 |
| POST   | `/api/folders/create`                     | Token          | Create folder. Body: `{ parentNodeId, name }`.                                                                                                                                                                                      |
| GET    | `/api/folders/stats`                      | Token          | Recursive folder statistics. Query: `nodeId`.                                                                                                                                                                                       |

All file/folder endpoints identify resources by `nodeId`/`parentNodeId`; path strings are not accepted.

## Thumbnails

| Method | Path                         | Auth                   | Description                                                                                    |
| ------ | ---------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| POST   | `/api/thumbnails/batch`      | Token or share         | Batch thumbnails. Body: `{ nodeIds }`. Returns `{ thumbnails: [{ nodeId, thumbnailUrl }] }`.   |
| GET    | `/api/thumbnails/:hash.:ext` | Query `token` required | Thumbnail by hash and extension. Query: `?token=` (signed token from batch API, short expiry). |

---

## Permissions

All permission endpoints are nodeId-based. Directory-level grants inherit to descendants via the `node_ancestors` closure table; file-level grants override inherited directory permissions.

| Method | Path                            | Auth  | Description                                                                                                                             |
| ------ | ------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/permissions/grant`        | Token | Grant directory permission. Body: `{ userId, nodeId, permission }` (`nodeId` must reference a directory node).                          |
| DELETE | `/api/permissions/revoke`       | Token | Revoke directory permission. Query: `userId`, `nodeId`; optional `includeDescendants` (true to also revoke grants on descendant nodes). |
| GET    | `/api/permissions/user/:userId` | Token | List permissions for a user. Returns `[{ nodeId, permission }]`.                                                                        |
| GET    | `/api/permissions/shared`       | Token | List current user's "shared with me" permissions (own subtree excluded). Returns `[{ nodeId, name, permission, type }]`.                |
| GET    | `/api/permissions/folder`       | Token | List permissions for a folder. Query: `nodeId`; optional `includeDescendants`, `fileNodeId`.                                            |
| GET    | `/api/permissions/check`        | Token | Check current user effective permission. Query: `nodeId`. Returns `{ nodeId, hasRead, hasWrite, source }`.                              |
| POST   | `/api/permissions/file/grant`   | Token | Grant file-level permission. Body: `{ userId, fileNodeId, permission }`.                                                                |
| DELETE | `/api/permissions/file/revoke`  | Token | Revoke file-level permission. Query: `userId`, `fileNodeId`.                                                                            |
| PATCH  | `/api/permissions/file`         | Token | Update file-level permission. Body: `{ userId, fileNodeId, permission }`.                                                               |
| GET    | `/api/permissions/file/check`   | Token | Check file permission. Query: `fileNodeId`. Returns `{ nodeId, hasRead, hasWrite, source }`.                                            |
| GET    | `/api/permissions/file/list`    | Token | List file permissions. Query: `parentNodeId` (optional; filters to files under that node).                                              |

---

## Permission Requests

| Method | Path                                   | Auth  | Description                                                                                                |
| ------ | -------------------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| POST   | `/api/permission-requests`             | Token | Create request (requester). Body: `nodeId` (or `fileNodeId`), `permission`; optional `message`.            |
| GET    | `/api/permission-requests/inbox`       | Token | Incoming requests (for owners).                                                                            |
| GET    | `/api/permission-requests/outbox`      | Token | Outgoing requests (for requesters).                                                                        |
| GET    | `/api/permission-requests/check-owner` | Token | Check if a node has an owner. Query: `nodeId`.                                                             |
| POST   | `/api/permission-requests/:id/approve` | Token | Approve (owner); atomically grants `requested_permission` on the target node, then sets status `approved`. |
| POST   | `/api/permission-requests/:id/reject`  | Token | Reject (owner).                                                                                            |
| POST   | `/api/permission-requests/:id/cancel`  | Token | Cancel own request (requester).                                                                            |

---

## Share Links (authenticated)

| Method | Path                      | Auth  | Description                                                                                                                                                                  |
| ------ | ------------------------- | ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/share-links`        | Token | Create share link. Body: `{ fileNodeId, expiresInDays? }`. Response: `{ token, nodeId, fileName, fileType, isDirectory, displayPath, createdAt, expiresAt, downloadCount }`. |
| GET    | `/api/share-links`        | Token | List own share links.                                                                                                                                                        |
| GET    | `/api/share-links/:token` | Token | Get share link details.                                                                                                                                                      |
| PUT    | `/api/share-links/:token` | Token | Update share link (e.g. expiry).                                                                                                                                             |
| DELETE | `/api/share-links/:token` | Token | Delete share link.                                                                                                                                                           |

---

## Share (public)

These routes are for accessing shared files via a public link (token in path). Auth is optional for some (e.g. to add to my permissions when logged in).

| Method | Path                                      | Auth  | Description                                    |
| ------ | ----------------------------------------- | ----- | ---------------------------------------------- |
| GET    | `/api/share/:token/info`                  | None  | Public: share link info (no auth).             |
| GET    | `/api/share/:token`                       | None  | Public: download file.                         |
| GET    | `/api/share/:token/preview`               | None  | Public: preview file.                          |
| GET    | `/api/share/:token/check-my-permission`   | Token | Check if current user already has access.      |
| POST   | `/api/share/:token/add-to-my-permissions` | Token | Add shared item to current user's permissions. |

---

## Recent Files

| Method | Path                            | Auth  | Description                                                                           |
| ------ | ------------------------------- | ----- | ------------------------------------------------------------------------------------- |
| GET    | `/api/recent-files`             | Token | List recent files for current user.                                                   |
| POST   | `/api/recent-files`             | Token | Add file to recent list. Body: `{ fileNodeId }`. Name/type derived from `file_nodes`. |
| DELETE | `/api/recent-files/:fileNodeId` | Token | Remove one recent entry by numeric file node id.                                      |
| DELETE | `/api/recent-files`             | Token | Clear all recent files.                                                               |

> The `apply-moves` and `remove-paths` endpoints are removed. Node ids are stable across rename/move/delete, so recent entries remain valid without post-operation synchronization.

---

## Health and Diagnostics

| Method | Path               | Auth | Description                                                                                                          |
| ------ | ------------------ | ---- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/health`      | None | Health check. Response: `{ status: "ok", messageCode, activeFileStorage, backends: { postgresql, s3, webdav } }` (status strings only; `activeFileStorage` = effective file backend). |
| GET    | `/api/webdav/test` | None | Test WebDAV connection.                                                                                              |
| GET    | `/api/webdav/info` | None | WebDAV URL info (e.g. for UI).                                                                                       |

---

## Admin

All admin routes require a valid JWT and admin role (`isAdmin`).

| Method | Path                     | Auth          | Description                                                                                                                                                                                                     |
| ------ | ------------------------ | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/settings`    | Token + Admin | Get system settings.                                                                                                                                                                                            |
| PUT    | `/api/admin/settings`    | Token + Admin | Update system settings.                                                                                                                                                                                         |
| GET    | `/api/admin/config`      | Token + Admin | Effective config: `value`/`source`/`tier`/`secret` per registry key. Set secrets are masked `"****"`; unset secrets have no `value` (field omitted).                                                  |
| PUT    | `/api/admin/config`      | Token + Admin | Write allowlisted non-T0 config keys to DB as plaintext (masked `'****'`/blank secrets keep the stored value; T2 cache invalidated); rejects `source=env` and T0 keys (400). Body: `{ values: { KEY: value } }`. Returns `{ applied, restartRequired, messageCode }`. |
| POST   | `/api/admin/config/test` | Token + Admin | Connection test with pending values for a file-storage backend. Body: `{ target: "s3"\|"webdav", ...pendingKeys }`. Returns `{ ok: true }` or `{ ok: false, errorCode, message, reason? }`.                     |
| GET    | `/api/admin/health`      | Token + Admin | Backend-health snapshot (per-backend status/code/hint/last-checked).                                                                                                                                            |

Spec: `docs/spec/server/routes/config.md`, `docs/spec/server/routes/health.md`.
| GET | `/api/admin/users/pending` | Token + Admin | Pending signup approvals. |
| GET | `/api/admin/users` | Token + Admin | List users. |
| POST | `/api/admin/users` | Token + Admin | Add user. Body: e.g. username, email, password. |
| POST | `/api/admin/users/:id/approve` | Token + Admin | Approve signup. |
| POST | `/api/admin/users/:id/reject` | Token + Admin | Reject signup. |
| DELETE | `/api/admin/users/:id` | Token + Admin | Delete user. |
| GET | `/api/admin/folders/list` | Token + Admin | List folders for permission management. Query: `path` (optional, default `/`). |
| PUT | `/api/admin/users/:id/permissions` | Token + Admin | Set user folder permissions. |
| POST | `/api/admin/permissions/ensure-home-owner-admin` | Token + Admin | Ensure home folder owner has admin; remove redundant self-grants on users' own subtrees. |
| POST | `/api/admin/cleanup/orphaned` | Token + Admin | Clean orphaned metadata. Also runs one GC cycle and reports `orphaned_node` status. |
| POST | `/api/admin/maintenance/gc` | Token + Admin | Run one garbage-collection cycle (orphaned blob cleanup). |
| POST | `/api/admin/maintenance/repair-sync` | Token + Admin | Resolve an `orphaned_node`. Body: `{ nodeId, action: 'retry-delete' \| 'force-active' }`. |
| GET | `/api/admin/migration/info` | Token + Admin | Get migration info: `{ source: 'webdav' \| 's3', direction: 'webdav-to-s3' \| 's3-to-webdav' }`. Direction derived from `WEA_FILE_STORAGE`. |
| POST | `/api/admin/migration/blobs` | Token + Admin | Start a bidirectional WebDAV ↔ S3 blob migration. Body: `{ mode, force?, dest }` (no `direction`; server derives it and validates `dest.type`). Returns `202 { jobId }`. |
| GET | `/api/admin/migration/jobs/:jobId` | Token + Admin | Get blob-migration job status/progress. |
| POST | `/api/admin/migration/jobs/:jobId/cancel` | Token + Admin | Cancel a running blob-migration job. |

Spec: `docs/spec/server/tools/blob-migration.md`.

---

## Settings (public)

| Method | Path                   | Auth | Description                                              |
| ------ | ---------------------- | ---- | -------------------------------------------------------- |
| GET    | `/api/settings/public` | None | Public settings (e.g. signup enabled, `setup_complete`). |

---

## Setup (first-run wizard)

Public only while setup is incomplete. Once `setup_complete` is `true`, `test`/`apply`
return `403 setup.complete`. Full contract: `docs/spec/server/routes/setup.md`.

| Method | Path                | Auth | Description                                                                                                                |
| ------ | ------------------- | ---- | -------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/setup/status` | None | Setup status: `{ setup_complete, missing: string[], current: {…masked} }`.                                                 |
| POST   | `/api/setup/test`   | None | Test a connection target (`postgresql` / `s3` / `webdav`). 403 `setup.complete` when already complete.                     |
| POST   | `/api/setup/apply`  | None | Persist configured keys: when the optional `jwt` block is supplied, write its `JWT_SECRET` to `.env`; every non-T0 value (secrets as plaintext) is stored in the metadata DB `settings` table. Returns `200 { restart_required: true }`. 403 `setup.complete` when already complete. |

---

## Success responses

Success bodies are endpoint-specific. Typical examples:

- **Auth login:** `{ user, token }` (and optionally refresh token in body or headers).
- **List/GET:** JSON array or object as documented in the route implementation.
- **Create/Update:** Often the created/updated resource or `{ messageCode }` for i18n.

For exact response shapes, see the route handlers under `server/domains/*/routes/`. Error responses always follow [shared-contracts.md](shared-contracts.md).
