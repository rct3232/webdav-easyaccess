> **REMOVED** — `server/utils/ensureHomeOwnerAdmin.js` deleted; the implementation lives in
> `server/domains/admin/services/cleanupService.js` (`ensureHomeOwnerAdminForAllUsers`,
> cleanupService.js:46-115) and `userService.ensureUserHomeNode`
> (server/domains/admin/services/userService.js:38). Both are nodeId-based: admin is granted on
> the home node's `file_node_id`, and the closure table covers all descendants. Consumed at
> startup (server/index.js:376-378) and by the admin maintenance route
> `POST /permissions/ensure-home-owner-admin` (server/domains/admin/routes/maintenance.js:49-50).
> This spec is retained for historical reference only.

# ensureHomeOwnerAdmin Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                            |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Ensure home owner admin: grant admin on each user's home node (nodeId-based), and remove redundant self-grants the user holds on their own subtree (home root + descendants). Co-located with other admin maintenance logic in cleanupService. Used on startup and the admin maintenance button. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/services/cleanupService.js` (module exports at cleanupService.js:117)
- **Test file:** None yet

> **Note — nodeId-based:** The module is fully nodeId-based. Granting admin on the home node's
> `file_node_id` covers all descendants through the closure table, so no path-walk or upgrade
> loop exists. The legacy path-grant/upgrade loop was a silent no-op on the current
> `permissionStore` (which requires nodeIds and rejects path strings); see the function docblock
> (cleanupService.js:38-45).

### 2.2 Functions / Exports

| Function                        | Signature               | Description                                                                          |
| ------------------------------- | ----------------------- | ------------------------------------------------------------------------------------ |
| ensureHomeOwnerAdminForAllUsers | () => Promise\<object\> | Process all non-admin users; ensure an `admin` grant on each user's home node (grant when missing) and remove redundant self-grants |
| cleanupOrphanedData             | () => Promise\<object\> | Run one GC cycle for orphaned blobs and report nodes stuck in `sync_status='orphaned_node'` |

> **WebDAV mode (MKCOL-on-create):** for every resolved/created home `file_nodes` row the
> function also calls `blobStorageService.createDirectoryWebdav(homeNode.id)` so the physical
> home directory exists on the WebDAV server (recursive, idempotent; no-op in S3 mode). MKCOL
> failures are collected in `result.errors[]` (the loop's per-user try/catch) after the node is
> marked `orphaned_node` by the service. Same contract in `userService.ensureUserHomeNode`.

### 2.3 Input / Output — ensureHomeOwnerAdminForAllUsers

- Returns `{ updatedUsers, upgradedPaths, grantedPaths, removedSelfGrants, errors }`
- Action 1: Resolve (or create) each non-admin user's home node via `fileNodeService.resolvePath`/`createDirectory`, then ensure the user holds an `admin` grant on that node (`permissionStore.checkPermission`; grant via `permissionStore.grant` when missing). `grantedPaths` counts each new grant; `updatedUsers` counts the distinct users granted.
- Action 2: Remove redundant self-grants the user holds on proper descendants of their home node (`permissions_user_paths` + `permissions_user_files` where the node is in the user's own subtree at depth > 0) via `permissionStore.removeOwnSubtreePermissions`. The home-root `admin` grant (depth 0) is preserved. `removedSelfGrants` reports `removedPaths + removedFiles`.

### 2.4 Input / Output — cleanupOrphanedData

- Returns `{ errors, gc, orphanedNodes }`
- Runs one GC cycle for orphaned blobs (`gcService.runGcCycle`; S3 mode, no-op in WebDAV mode) and scans nodes stuck in `sync_status='orphaned_node'` for manual review (`failSafeService.scanOrphanedNodes`). Errors are collected in the `errors` array.

### 2.5 Dependencies

- User model (`findAll`; users without `id` or `username` are skipped)
- permissionStore (`checkPermission`, `grant`, `removeOwnSubtreePermissions`) via `server/store/permissionStore`
- fileNodeService (`resolvePath`, `createDirectory`) with `fileNodesStore` (created inline)
- blobStorageService (`createDirectoryWebdav`, WebDAV mode only) via composition
- gcService (`runGcCycle`) and failSafeService (`scanOrphanedNodes`) via composition — used by `cleanupOrphanedData`
- `PERMISSIONS` from `@webdav-easyaccess/shared/constants`

> **Removed:** `isOwnerPath` from `../../permissions/policy/permissionPolicy` — that export no longer exists; this module does not use owner detection. Legacy path-/storage-oriented helpers (`getPermissionDoc`, `listDirectory`, storage `listDir`/`deletePath`/`exists`/`readFile`/`writeFile`/`ensureDir`, `withLock` + `permissionRequestStore`/`PERMISSION_REQUESTS_PATH`, `normalizePath`) are no longer part of the implementation.

### 2.6 Verification Scenarios

- [ ] Ensure home admin is granted when missing
- [ ] Redundant self-grants on the user's own subtree are removed (home-root admin preserved)
- [ ] Errors collected in result.errors array
- [ ] Non-admin users only; admin users skipped
- [ ] Users without id or username skipped gracefully
