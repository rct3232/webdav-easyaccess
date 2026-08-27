# ensureHomeOwnerAdmin Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Ensure home owner admin: grant admin on each user's home node, and remove redundant self-grants the user holds on their own subtree (home root + descendants). Co-located with other admin maintenance logic in cleanupService. Used on startup and admin "권한정리" button. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/services/cleanupService.js`
- **Test file:** None yet

> **Status — not a nodeId end-state:** This server-side util remains **partially path-based**. Its return fields `upgradedPaths`/`grantedPaths` count upgraded/granted permission **paths**, and it depends on path- and storage-oriented helpers: `listDirectory` from `utils/webdav`, and storage helpers (`listDir`, `deletePath`, `exists`, `readFile`, `writeFile`, `ensureDir`). Do not treat this spec as nodeId-migrated; it is explicitly out of scope for the Phase 4 nodeId closure and is pending Phase 7 cleanup (legacy path permission checkers / residual path state).

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| ensureHomeOwnerAdminForAllUsers | () => Promise\<object\> | Process all non-admin users; upgrade/grant admin under home |
| cleanupOrphanedData | () => Promise\<object\> | Clean orphaned permission files, user metadata, email index, and permission requests |

> **WebDAV mode (MKCOL-on-create):** for every resolved/created home `file_nodes` row the
> function also calls `blobStorageService.createDirectoryWebdav(homeNode.id)` so the physical
> home directory exists on the WebDAV server (recursive, idempotent; no-op in S3 mode). MKCOL
> failures are collected in `result.errors[]` (the loop's per-user try/catch) after the node is
> marked `orphaned_node` by the service. Same contract in `userService.ensureUserHomeNode`.

### 2.3 Input / Output — ensureHomeOwnerAdminForAllUsers

- Returns `{ updatedUsers, upgradedPaths, grantedPaths, removedSelfGrants, errors }`
- Action 1: Ensure each non-admin user has an `admin` grant on their home node (grant when missing).
- Action 2: Remove redundant self-grants the user holds on proper descendants of their home node (`permissions_user_paths` + `permissions_user_files` where the node is in the user's own subtree at depth > 0) via `permissionStore.removeOwnSubtreePermissions`. The home-root `admin` grant (depth 0) is preserved. `removedSelfGrants` reports the total rows deleted.

### 2.4 Input / Output — cleanupOrphanedData

- Returns `{ deletedPermissionFiles, deletedUserFiles, deletedEmailIndexFiles, cleanedPermissionRequests, errors }`
- Cleans orphaned permission files, user metadata files, email index files, and invalid permission requests

### 2.5 Dependencies

- User model (findAll)
- permissionStore (getPermissionDoc, grant, checkPermission)
- `listDirectory` from `../../../utils/webdav`
- storage (listDir, deletePath, exists, readFile, writeFile, ensureDir)
- withLock + permissionRequestStore (PERMISSION_REQUESTS_PATH) for permission request cleanup
- `normalizePath` and `PERMISSIONS` from `@webdav-easyaccess/shared`

> **Removed:** `isOwnerPath` from `../../permissions/policy/permissionPolicy` — that export no longer exists. `ownerNodeResolver` now exposes the nodeId-based `isOwnerNode`, and this module does not use owner detection.

### 2.6 Verification Scenarios

- [ ] Ensure home admin is granted when missing
- [ ] Redundant self-grants on the user's own subtree are removed (home-root admin preserved)
- [ ] Errors collected in result.errors array
- [ ] Non-admin users only; admin users skipped
- [ ] Users without id or username skipped gracefully
