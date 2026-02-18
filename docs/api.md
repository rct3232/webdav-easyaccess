# API Reference

This document lists all REST API endpoints. The server serves under the `/api` prefix. Use it together with [shared-contracts.md](shared-contracts.md) for error formats and shared constants.

---

## Common

- **Base URL:** `/api`
- **Authentication:** Where required, send `Authorization: Bearer <JWT>`. Some endpoints accept an optional share token via header or query (documented below).
- **Error responses:** JSON body with `errorCode` (i18n key) and optional `params`. See [shared-contracts.md#error-response-format](shared-contracts.md#error-response-format). HTTP status is 4xx/5xx.

---

## Auth

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/auth/register` | None | Sign up. Body: e.g. username, email, password. |
| POST | `/api/auth/login` | None | Login. Returns `user`, `token` (and optionally refresh token). |
| POST | `/api/auth/refresh` | None | Refresh access token using refresh token in body. |
| GET | `/api/auth/me` | Token | Current user info. |

---

## Users

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/users` | Token | List users (e.g. for share dialogs). |
| GET | `/api/users/approved` | Token | List approved users. |
| GET | `/api/users/:id` | Token | Get user by id. |
| PUT | `/api/users/:id/password` | Token | Change password (body: currentPassword, newPassword). |
| PUT | `/api/users/:id/email` | Token | Update email. |
| PUT | `/api/users/:id/permissions` | Token | Update current user's own permissions (e.g. home folder). |

---

## Files and Folders

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/files/list` | Token or share | List folder contents. Query: `path`. |
| GET | `/api/files/download` | Token or share | Download file. Query: `path`. |
| POST | `/api/files/upload` | Token | Upload file. Multipart: `file`, body/query `path`. |
| PUT | `/api/files/rename` | Token | Rename. Body: e.g. `oldPath`, `newName`. |
| POST | `/api/files/batch-move` | Token | Move items. Body: e.g. `sourcePaths`, `destinationPath`. |
| POST | `/api/files/batch-copy` | Token | Copy items. Body: e.g. `sourcePaths`, `destinationPath`. |
| POST | `/api/files/batch-delete` | Token | Delete items. Body: e.g. `paths`. |
| POST | `/api/files/download-multiple` | Token or share | ZIP multiple files/folders. Body: e.g. `paths`. |
| GET | `/api/files/download-progress/:id` | Token or share | Progress of ZIP download. |
| GET | `/api/files/operation-progress/:id` | Token | Progress of bulk operation (move/copy/delete). |
| GET | `/api/files/bulk-operation/:jobId` | Token | Bulk job status. |
| POST | `/api/files/bulk-operation/:jobId/cancel` | Token | Cancel bulk operation. |
| GET | `/api/files/thumbnail/:hash` | Token | Single thumbnail image. |
| POST | `/api/files/thumbnails/batch` | Token or share | Batch thumbnails. Body: e.g. `paths` or items with path/hash. |
| GET | `/api/thumbnails/:hash.:ext` | None (or token) | Thumbnail by hash and extension (separate route). |
| POST | `/api/files/check-conflicts` | Token | Check name conflicts before paste. Body: e.g. `paths`, `destinationPath`. |
| POST | `/api/files/metadata` | Token or share | Get file metadata. Body: e.g. `paths`. |
| POST | `/api/folders/create` | Token | Create folder. Body: `path`. |

Path parameters are normalized by middleware. All paths that accept `path`, `sourcePath`, `destinationPath`, or similar are checked for the reserved `/.wea` path (non-admin access blocked).

---

## Permissions

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/permissions/grant` | Token | Grant folder or file permission. Body: `folderPath`, `userId`, `permission`; optional `target` ('file' for file-level). |
| DELETE | `/api/permissions/revoke` | Token | Revoke permission. Query: `userId`, `folderPath`; optional `includeSubfolders`, `scope` ('pathOnly' for file-level). |
| GET | `/api/permissions/user/:userId` | Token | List permissions for a user. |
| GET | `/api/permissions/folder` | Token | List permissions for a folder. Query: `path`. |
| GET | `/api/permissions/check` | Token | Check current user permission for a path. Query: `path`. |
| POST | `/api/permissions/file/grant` | Token | Grant file-level permission. |
| DELETE | `/api/permissions/file/revoke` | Token | Revoke file-level permission. |
| PATCH | `/api/permissions/file` | Token | Update file-level permission. |
| GET | `/api/permissions/file/check` | Token | Check file permission. |
| GET | `/api/permissions/file/list` | Token | List file permissions. |

Path params are normalized; `/.wea` is blocked for non-admin.

---

## Permission Requests

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/permission-requests` | Token | Create request (requester). Body: `folderPath` or `filePath`, `permission`; optional `message`. |
| GET | `/api/permission-requests/inbox` | Token | Incoming requests (for owners). |
| GET | `/api/permission-requests/outbox` | Token | Outgoing requests (for requesters). |
| GET | `/api/permission-requests/check-owner` | Token | Check if path has an owner. Query: `folderPath` or `filePath`. |
| POST | `/api/permission-requests/:id/approve` | Token | Approve (owner). |
| POST | `/api/permission-requests/:id/reject` | Token | Reject (owner). |
| POST | `/api/permission-requests/:id/cancel` | Token | Cancel own request (requester). |

---

## Share Links (authenticated)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/share-links` | Token | Create share link. Body: e.g. `filePath`, `expiresInDays`. |
| GET | `/api/share-links` | Token | List own share links. |
| GET | `/api/share-links/:token` | Token | Get share link details. |
| PUT | `/api/share-links/:token` | Token | Update share link (e.g. expiry). |
| DELETE | `/api/share-links/:token` | Token | Delete share link. |

---

## Share (public)

These routes are for accessing shared files via a public link (token in path). Auth is optional for some (e.g. to add to my permissions when logged in).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/share/:token/info` | None | Public: share link info (no auth). |
| GET | `/api/share/:token` | None | Public: download file. |
| GET | `/api/share/:token/preview` | None | Public: preview file. |
| GET | `/api/share/:token/check-my-permission` | Token | Check if current user already has access. |
| POST | `/api/share/:token/add-to-my-permissions` | Token | Add shared item to current user's permissions. |

---

## Recent Files

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/recent-files` | Token | List recent files for current user. |
| POST | `/api/recent-files` | Token | Add file to recent list. Body: `path`; optional `name`, `type`, `basename`. |
| DELETE | `/api/recent-files/:filePath(*)` | Token | Remove one path from recent list (path may contain slashes). |
| DELETE | `/api/recent-files` | Token | Clear all recent files. |
| POST | `/api/recent-files/apply-moves` | Token | Update paths after bulk move. Body: e.g. array of moves. |
| POST | `/api/recent-files/remove-paths` | Token | Remove paths after delete. Body: `filePaths`, `folderPaths` (arrays). |

---

## Health and Diagnostics

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/health` | None | Health check. Response: `{ status: "ok", messageCode }`. |
| GET | `/api/webdav/test` | None | Test WebDAV connection. |
| GET | `/api/webdav/info` | None | WebDAV URL info (e.g. for UI). |

---

## Admin

All admin routes require a valid JWT and admin role (`isAdmin`).

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/admin/settings` | Token + Admin | Get system settings. |
| PUT | `/api/admin/settings` | Token + Admin | Update system settings. |
| GET | `/api/admin/users/pending` | Token + Admin | Pending signup approvals. |
| GET | `/api/admin/users` | Token + Admin | List users. |
| POST | `/api/admin/users` | Token + Admin | Add user. Body: e.g. username, email, password. |
| POST | `/api/admin/users/:id/approve` | Token + Admin | Approve signup. |
| POST | `/api/admin/users/:id/reject` | Token + Admin | Reject signup. |
| DELETE | `/api/admin/users/:id` | Token + Admin | Delete user. |
| GET | `/api/admin/folders/list` | Token + Admin | List folders for permission management. |
| PUT | `/api/admin/users/:id/permissions` | Token + Admin | Set user folder permissions. |
| POST | `/api/admin/permissions/ensure-home-owner-admin` | Token + Admin | Ensure home folder owner has admin. |
| POST | `/api/admin/cleanup/orphaned` | Token + Admin | Clean orphaned metadata. |

---

## Settings (public)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/api/settings/public` | None | Public settings (e.g. signup enabled). |

---

## Success responses

Success bodies are endpoint-specific. Typical examples:

- **Auth login:** `{ user, token }` (and optionally refresh token in body or headers).
- **List/GET:** JSON array or object as documented in the route implementation.
- **Create/Update:** Often the created/updated resource or `{ messageCode }` for i18n.

For exact response shapes, see the route handlers in `server/routes/`. Error responses always follow [shared-contracts.md](shared-contracts.md).
