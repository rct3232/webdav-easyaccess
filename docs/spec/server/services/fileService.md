# fileService Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | User-facing file operations service replacing path-based `server/domains/files/services/fileService.js`. Dispatches all work through the Phase 2 service layer (fileNodeService, blobStorageService, uploadService, aclService). No direct WebDAV or S3 calls — all storage operations route through blobStorageService. Dual-backend support for S3 and WebDAV modes determined at factory time by injected dependencies, not hardcoded configuration. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/fileService.js` (refactored to add nodeId methods alongside legacy path-based surface)
- **Test file:** `server/domains/files/services/__tests__/fileService.test.js`

### 2.2 Factory Function Signature

```js
function createFileService({ fileNodeService, blobStorageService, uploadService, aclService, fileStorageMode, permissionStore, ownerNodeResolver }) {
  return {
    listDirectoryWithPermissions(userId, parentNodeId, user),
    uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict),
    downloadFile(fileNodeId, userId, user),
    renameNode(nodeId, newName, userId, user),
    moveNode(nodeId, newParentNodeId, userId, user),
    deleteNode(nodeId, userId, user),
    copyFile(nodeId, destinationParentNodeId, newName, userId, user)
  };
}
```

| Param              | Type   | Required | Description                                                                                                                                                                             |
| ------------------ | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fileNodeService    | object | yes      | Tree operations (createFile, renameNode, moveNode, deleteNode, listDirectory, getDescendantIds, updateSyncStatus, getNodePath) — see `fileNodeService.md`                               |
| blobStorageService | object | yes      | Blob lifecycle (prepareUpload, completeUpload, downloadBlob, overwriteBlob, deleteBlob, getActiveS3Key, duplicateBlob, linkObject, uploadToWebdav) — see `blobStorageService.md`        |
| uploadService      | object | yes      | 4-step upload orchestration (uploadFile, overwriteFile, downloadFile) — see `uploadService.md`                                                                                          |
| aclService         | object | yes      | Permission checks (checkFolderPermission, checkFilePermission, isAdminUser) — see `aclService.js`                                                                                       |
| fileStorageMode    | string | yes      | `'s3'` or `'webdav'`. Determined by injected blobStorageService capability at composition time, not read from environment variables inside this service.                                |
| permissionStore    | object | no       | Store-level permission CRUD (`revokeUserSubtreePermissions`). Defaults to the real store when omitted. Used only by `moveNode` for the ownership-transfer cleanup (D6).                 |
| ownerNodeResolver  | object | no       | Owner detection via closure-table ancestry (`isOwnerNode`). Defaults to the real resolver when omitted. Used only by `moveNode` to decide whether a move is an ownership transfer (D6). |

### 2.3 Methods

#### `listDirectoryWithPermissions(userId, parentNodeId, user)`

Lists children of a directory node with permission flags computed per item via the closure table and aclService.

| Param        | Type             | Required | Description                                                                                                                                                                                                                                                                                                   |
| ------------ | ---------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| userId       | number \| string | yes      | ID of the requesting principal. A numeric userId for authenticated users, or a `'share:<token>'` string for share-token callers (`GET /api/files/list` passes `req.principalId`). Determines admin bypass (`user` object) and whether the unreadable-child exclusion applies (`aclService.isSharePrincipal`). |
| parentNodeId | number           | yes      | Node ID of the directory to list                                                                                                                                                                                                                                                                              |
| user         | object           | yes      | Full user object with `is_admin` flag for admin bypass resolution                                                                                                                                                                                                                                             |

**Returns:** `array` — each element shaped as:

```js
{
  nodeId: number,       // child file_nodes.id
  name: string,         // file_nodes.name
  type: string,         // 'file' | 'directory'
  size: number \| null,  // from filecache LEFT JOIN; null for directories and files without cache entry
  mimeType: string \| null, // from filecache LEFT JOIN
  modifiedAt: Date \| null, // file_nodes.updated_at
  hasReadPermission: boolean,
  hasWritePermission: boolean,
  hasAdminPermission: boolean // admin bypass || owner of node || explicit admin grant
}
```

`hasAdminPermission` is the "can manage permissions on this node" capability. It is
**ownership-derived** (`ownerNodeResolver.isOwnerNode` — the node lies under the
principal's home root in the closure table), matching the "No self-grants" policy in
`docs/features/permissions.md` §3: the owner is an effective admin on owned nodes with
**no explicit permission record required**. This is what keeps the Share dialog's
user-management UI working for a user's own folders after the own-subtree self-grant
cleanup.

Children the principal cannot read (`hasReadPermission === false`) are **excluded** from the returned array **only for share principals** (a `share:`-prefixed principal ID, detected via `aclService.isSharePrincipal`). This prevents a directory share token from disclosing sibling/parent nodes outside the share scope. For **regular user** listings unreadable children are **retained** with their per-row `hasReadPermission: false` / `hasWritePermission: false` flags — this is what the request-access flow relies on to discover (and request access to) unreadable children in another user's folder. Admin listings are unaffected because the admin bypass sets both flags true.

**Operations:**

1. `fileNodeService.listDirectory(parentNodeId)` — retrieves children rows with filecache metadata (LEFT JOIN). If parentNodeId does not exist or is not a directory, throws 404-style error.
2. For each child item:
   - If `isAdminUser(user)` → set `hasReadPermission = true`, `hasWritePermission = true` immediately (admin bypass, no DB queries).
   - Otherwise:
     - If child type is `'directory'`: call `aclService.checkFolderPermission(userId, childNodeId, PERMISSIONS.READ)` for read flag and `aclService.checkFolderPermission(userId, childNodeId, PERMISSIONS.WRITE)` for write flag.
     - If child type is `'file'`: call `aclService.checkFilePermission(userId, childNodeId, PERMISSIONS.READ)` for read flag and `aclService.checkFilePermission(userId, childNodeId, PERMISSIONS.WRITE)` for write flag.
3. For **share principals only** (`aclService.isSharePrincipal(principalId)` true), skip (exclude from results) any child whose `hasReadPermission` is `false`. This filtering happens before path resolution and response-row construction, so `getNodePath` is never called for out-of-scope nodes. Regular user listings do not skip — every child is mapped with its boolean flags so unreadable children stay visible to the request-access flow.
4. Compute the admin capability once per listing (skip entirely when `isAdminUser(user)` or a share principal):
   - `parentOwned = ownerNodeResolver.isOwnerNode(userId, parentNodeId)` — all children of an owned directory are owned (ownership is inherited down the tree), so one check covers the whole listing.
   - `adminGrantNodeIds` = set of `file_node_id` from `permissionStore.getUserPermissions(userId)` where `permission === 'admin'` (literal grants, e.g. admin received on a shared folder).
   - Per child: `hasAdminPermission = isAdmin || parentOwned || adminGrantNodeIds.has(child.id)`.
5. Map each remaining child into the response shape above.

**DB operations:** Single SELECT via listDirectory (file_nodes + filecache LEFT JOIN). Permission checks are separate async queries per item unless admin bypass applies. The admin-capability step adds `getUserRootNode` + one closure check (owner detection) and one `getUserPermissions` query per listing.

---

#### `uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict)`

Creates a new file node and stores its content. Dispatch strategy differs by storage mode.

| Param        | Type           | Required | Description                                                          |
| ------------ | -------------- | -------- | -------------------------------------------------------------------- |
| userId       | number         | yes      | ID of the requesting user                                            |
| parentNodeId | number \| null | yes      | Parent directory node; null for root-level creation                  |
| name         | string         | yes      | File name (subject to UNIQUE constraint per parent)                  |
| buffer       | Buffer         | yes      | File content bytes                                                   |
| mimeType     | string         | yes      | MIME type of the file                                                |
| user         | object         | yes      | Full user object for permission resolution                           |
| onConflict   | string         | no       | `'skip'`, `'overwrite'`, or `undefined` (default: throw on conflict) |

**Returns:** `{ nodeId, size, mimeType }` — created/updated node ID and metadata. For skip conflicts, returns `{ nodeId, skipped: true }`.

**S3 Mode Flow:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true, call `aclService.checkFolderPermission(userId, parentNodeId, 'write')` (string literal). If check returns false, throw 403 via `forbiddenError`. Admin or null-user bypasses this gate entirely.
2. Conflict check: query file_nodes for `(parent_id, name)` uniqueness. If exists and `onConflict === 'skip'`, return early with `{ nodeId, skipped: true }`. If exists and `onConflict !== 'overwrite'`, throw conflict error.
3. Dispatch to `uploadService.uploadFile(parentNodeId, name, buffer, mimeType)`. This orchestration internally runs TX1 (`fileNodeService.createFile()` + `blobStorageService.prepareUpload()`), the transport PUT (inside blobStorageService, never a direct blobStore call from fileService), and TX2 (`blobStorageService.completeUpload()` + `fileNodeService.updateSyncStatus(nodeId, 'active')`).
4. Returns result from uploadService.

**WebDAV Mode Flow:**

1. Permission gate: same as S3 mode.
2. Conflict check: same as S3 mode.
3. Atomic create + PUT:
   - For new file: `fileNodeService.createFile(parentNodeId, name)` — creates node with sync_status='active'. For overwrite: reuse existing file's nodeId.
   - `blobStorageService.uploadToWebdav(nodeId, buffer)` — synchronous PUT to remote storage (path resolution happens inside blobStorageService).
4. On WebDAV PUT failure — **new file**: roll back the just-created node via `fileNodeService.deleteNode(nodeId)` (best-effort), then re-throw the original error — no phantom 0-byte file remains and a retry is not blocked by a duplicate-name conflict. On WebDAV PUT failure — **overwrite**: mark `sync_status='orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')` as fail-safe (the pre-existing node must not be deleted), then re-throw the error.
5. Returns `{ nodeId, size: buffer.length, mimeType }`.

**Failure recovery:** See Section 5 (Sync Status Fail-Safe Semantics). S3 mode follows uploadService failure table (`uploadService.md` §2.5). WebDAV mode rolls back NEW nodes on PUT failure; an overwrite PUT failure marks orphaned_node.

---

#### `downloadFile(fileNodeId, userId, user)`

Downloads file content through the appropriate storage backend.

| Param      | Type   | Required | Description                                  |
| ---------- | ------ | -------- | -------------------------------------------- |
| fileNodeId | number | yes      | ID of the file node to download              |
| userId     | number | yes      | ID of the requesting user                    |
| user       | object | yes      | Full user object for admin bypass resolution |

**Returns:** `Buffer` — file content. Throws `notFoundError(SERVER_ERROR_CODES.files.notFound)` when `blobStorageService.downloadBlob(fileNodeId)` yields no buffer.

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true, call `aclService.checkFilePermission(userId, fileNodeId, 'read')` (string literal). If check returns false, throw 404 via `notFoundError`. Admin or null-user bypasses this gate entirely.
2. S3 mode: dispatch to `blobStorageService.downloadBlob(fileNodeId)` — resolves object_map → active s3_key → S3 GET. Throws `notFoundError` on empty active object.
3. WebDAV mode: resolve path via `fileNodeService.getNodePath(fileNodeId)`, then call `blobStorageService.downloadFromWebdav(path)`. Throws `notFoundError` on 404.

**DB operations:** Permission check queries object_map via aclService (S3) or no storage query (WebDAV). Blob download is read-only from storage backend.

---

#### `renameNode(nodeId, newName, userId, user)`

Renames a node in the database with optional best-effort storage-side rename for WebDAV mode.

| Param   | Type   | Required | Description                                        |
| ------- | ------ | -------- | -------------------------------------------------- |
| nodeId  | number | yes      | ID of the node to rename                           |
| newName | string | yes      | New name (must not conflict with existing sibling) |
| userId  | number | yes      | ID of the requesting user                          |
| user    | object | yes      | Full user object for permission resolution         |

**Returns:** `{ nodeId, newName }` — confirmation of renamed node.

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true, call `aclService.checkFilePermission(userId, nodeId, 'write')` (string literal). If check returns false, throw 403 via `forbiddenError`. Admin or null-user bypasses this gate entirely.
2. Name validation: reject empty `newName` or names containing `/`, `\` via `conflictError(SERVER_ERROR_CODES.files.invalidName)`.
3. Sibling conflict check: list siblings via `fileNodeService.listDirectory(node.parent_id)` and throw `conflictError` if any sibling matches `newName`.
4. DB rename: `fileNodeService.renameNode(nodeId, newName)` — single UPDATE to file_nodes.name.
5. Storage-side sync (mode-dependent):
   - **S3 mode:** No storage operation needed. Blob key is independent of node name.
   - **WebDAV mode:** Uses "download content → DB rename → re-upload" pattern (not native WebDAV MOVE). Before the DB rename, download file content via `blobStorageService.downloadBlob(nodeId)` — if download fails, proceed with DB-only rename (storage sync is best-effort). After the DB rename, re-upload the buffered content to the new path via `blobStorageService.uploadToWebdav(nodeId, webdavBuffer)`. If re-upload fails, set `sync_status = 'orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')`. Do not abort the DB rename — metadata is authoritative.
6. Return confirmation.

**Validation:** newName must be non-empty and free of path separators (`/`, `\`). Duplicate name under same parent throws UNIQUE constraint error from DB layer.

---

#### `moveNode(nodeId, newParentNodeId, userId, user)`

Moves a node (and its subtree) to a new parent directory with closure table rebuild.

| Param           | Type           | Required | Description                                         |
| --------------- | -------------- | -------- | --------------------------------------------------- |
| nodeId          | number         | yes      | ID of the node to move                              |
| newParentNodeId | number \| null | yes      | New parent directory; null means move to root level |
| userId          | number         | yes      | ID of the requesting user                           |
| user            | object         | yes      | Full user object for permission resolution          |

**Returns:** `{ nodeId, newParentId }` — confirmation of moved node.

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true:
   - Check write on source via `aclService.checkFilePermission(userId, nodeId, 'write')` (string literal). If false, throw 403.
   - Check write on destination parent via `aclService.checkFolderPermission(userId, newParentNodeId, 'write')` (string literal). If false, throw 403.
     Admin or null-user bypasses this gate entirely.
2. **Ownership-transfer detection (D6):** for a non-admin mover, resolve BEFORE the move (the closure-table rebuild afterwards rewrites the subtree ancestry, so post-move ownership would be misreported):
   - `ownedBeforeMove = ownerNodeResolver.isOwnerNode(userId, nodeId)` — the node is currently inside the mover's home subtree.
   - `destInsideMoverHome` — `newParentNodeId != null` AND `ownerNodeResolver.isOwnerNode(userId, newParentNodeId)` — the destination is inside the mover's home subtree (stable: the destination's ancestry is unchanged by the move).
   - If `ownedBeforeMove && !destInsideMoverHome`, the move transfers ownership out of the mover's home. Admin movers are skipped (no home, no self-grant rows to leak).
3. Storage-side sync (mode-dependent):
   - **S3 mode:** No storage operation needed. Blob keys are decoupled from tree position.
   - **WebDAV mode:** Uses "download content → DB move → re-upload" pattern (not native WebDAV MOVE). Before the DB move, download file content via `blobStorageService.downloadBlob(nodeId)` — if download fails, proceed with DB-only move (storage sync is best-effort). After the DB move, re-upload the buffered content to the new path via `blobStorageService.uploadToWebdav(nodeId, webdavBuffer)`. If re-upload fails, set `sync_status = 'orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')`. Do not abort DB move — metadata is authoritative.
4. DB move: `fileNodeService.moveNode(nodeId, newParentNodeId)` — updates parent_id + rebuilds closure table in TX. Cycle detection handled internally by fileNodeService (calls getDescendantIds and rejects if newParentId is a descendant).
5. **Ownership-transfer cleanup (D6):** after the closure rebuild, if step 2 detected an ownership transfer, call `permissionStore.revokeUserSubtreePermissions(userId, nodeId)` to delete the mover's explicit permission rows on the moved subtree (root + descendants, depth ≥ 0) from both `permissions_user_paths` and `permissions_user_files`. Without this, the mover's historical self-grants / admin-assigned rows on the subtree would resurface in `GET /api/permissions/shared` as "shared with me" leaks even though the mover no longer owns the subtree. The mover's home-root ADMIN grant is untouched (it lives on the home root, not inside the moved subtree). This cleanup is best-effort: it runs after the DB move committed and does not abort or roll back the move.
6. Return confirmation.

---

#### `deleteNode(nodeId, userId, user)`

Deletes a node and its entire subtree. For WebDAV mode, attempts best-effort storage deletion bottom-up before DB removal.

| Param  | Type   | Required | Description                                |
| ------ | ------ | -------- | ------------------------------------------ |
| nodeId | number | yes      | ID of the root node to delete              |
| userId | number | yes      | ID of the requesting user                  |
| user   | object | yes      | Full user object for permission resolution |

**Returns:** `{ deletedCount }` — total number of nodes removed (including descendants).

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true, call `aclService.checkFilePermission(userId, nodeId, 'write')` (string literal). If check returns false, throw 403 via `forbiddenError`. Admin or null-user bypasses this gate entirely.
2. Confirm existence via `fileNodeService.getNode(nodeId)` — throws `notFoundError` if node does not exist.
3. Enumerate subtree: `fileNodeService.getDescendantIds(nodeId)` returns all descendant IDs from closure table.
4. Storage deletion (mode-dependent):
   - **S3 mode:** No direct storage call needed at this layer. blobStorageService.deleteBlob is called per-file as part of the fileNodeService.deleteNode cascade, which marks object_map rows orphaned. Actual S3 deletion deferred to Phase 6 GC.
   - **WebDAV mode:** Build cleanup list as `[...descendantIds].reverse().concat([nodeId])` — deepest descendants first, then the target node itself. For each id: call `blobStorageService.deleteBlob(descId)` in a try/catch; on failure set `sync_status = 'orphaned_node'` via `fileNodeService.updateSyncStatus(descId, 'orphaned_node')` and continue (do not abort remaining deletions).
5. DB deletion: `fileNodeService.deleteNode(nodeId)` — wrapped in TX, cleans up node_ancestors + triggers FK CASCADE for object_map, filecache rows.
6. Return `{ deletedCount: descendantIds.length }`.

**DB operations:** getDescendantIds (SELECT), per-node updateSyncStatus (UPDATE) on WebDAV failures, deleteNode (TX: DELETE node_ancestors + DELETE file_nodes → CASCADE to object_map, filecache).

---

#### `copyFile(nodeId, destinationParentNodeId, newName, userId, user)`

Creates a copy of a source file in the destination directory. Copy semantics differ by storage mode.

| Param                   | Type           | Required | Description                                            |
| ----------------------- | -------------- | -------- | ------------------------------------------------------ |
| nodeId                  | number         | yes      | ID of the file node to copy                            |
| destinationParentNodeId | number \| null | yes      | Target parent directory; null for root-level placement |
| newName                 | string         | yes      | Name for the copied file                               |
| userId                  | number         | yes      | ID of the requesting user                              |
| user                    | object         | yes      | Full user object for permission resolution             |

**Returns:** `{ sourceNodeId, copiedNodeId }` — IDs of original and copy.

**S3 Mode (copy-on-write):**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true:
   - Read check on source via `aclService.checkFilePermission(userId, nodeId, 'read')` (string literal). If false, throw 403.
   - Write check on destination parent via `aclService.checkFolderPermission(userId, destinationParentNodeId, 'write')` (string literal). If false, throw 403.
     Admin or null-user bypasses this gate entirely.
2. Resolve source blob key: `blobStorageService.getActiveS3Key(nodeId)`. If null (no active object), throw error — nothing to copy.
3. Check sharing: count how many file_nodes currently reference this s3_key via `blobStorageService.countActiveObjectsByS3Key(s3Key)`.
   - If count === 1 (exclusive ownership): create new file_node + INSERT new object_map row referencing the SAME s3_key with status='active'. Zero-copy, instant.
   - If count > 1 (shared blob): call `blobStorageService.duplicateBlob(s3Key)` to download-and-upload a private copy under a new key, then link it via `blobStorageService.linkObject(newCopiedNodeId, newS3Key)`.
4. New file node uses `newName` param; name conflict → numeric suffix via `createFile` behavior.
5. Return `{ sourceNodeId, copiedNodeId }`.

**WebDAV Mode (actual blob copy):**

1. Permission gate: same null-guard + string-literal checks as S3 mode (`'read'` on source, `'write'` on destination parent).
2. Download source content via `blobStorageService.downloadBlob(nodeId)`.
3. Create new file_node via `fileNodeService.createFile(destinationParentNodeId, newName)`. Handle name conflict with numeric suffix.
4. Upload copy via `blobStorageService.uploadToWebdav(copiedNodeId, downloadedBuffer)`.
5. If upload fails after DB commit: roll back the copied (new) node via `fileNodeService.deleteNode(copiedNodeId)` (best-effort), then re-throw the original error.
6. Return `{ sourceNodeId, copiedNodeId }`.

### 2.4 Dependencies

| Dependency         | Purpose                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fileNodeService    | Tree CRUD (createFile, renameNode, moveNode, deleteNode, listDirectory, getNode), closure table maintenance (getDescendantIds), sync status updates                                               |
| blobStorageService | Blob lifecycle: prepareUpload/completeUpload for S3 mode; downloadBlob for both modes; uploadToWebdav/deleteBlob for WebDAV operations; getActiveS3Key/duplicateBlob/linkObject for copy-on-write |
| uploadService      | Orchestrates 4-step S3 upload flow (TX1 → PUT → TX2) with failure recovery states                                                                                                                 |
| aclService         | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser                                                                                                                   |
| permissionStore    | Ownership-transfer cleanup in moveNode: revokeUserSubtreePermissions (D6)                                                                                                                         |
| ownerNodeResolver  | Ownership detection in moveNode: isOwnerNode (D6)                                                                                                                                                 |

### 2.5 Error Cases

- **Permission denied:** Any method where the user lacks required permission and is not an admin throws a 403 error. The caller (route handler) maps this to HTTP 403.
- **Node not found:** If nodeId or parentNodeId does not correspond to an existing file_nodes row, throw 404 error. Applies to all methods accepting node IDs.
- **Storage failure — S3 mode:** New-file upload failures roll back the created node — nothing persists in DB (see `uploadService.md` §2.5). Overwrite failures leave the node with `sync_status='pending_upload'` and a pending object_map; no automatic recovery exists (see `docs/IMPROVEMENT_PLAN.md`).
- **Storage failure — WebDAV mode:** NEW nodes (new-file upload, copyFile) are rolled back when the backend write fails. Failures after a DB commit on EXISTING nodes (overwrite PUT, rename/move MOVE, deleteNode per-node, directory MKCOL) set `sync_status='orphaned_node'` as a fail-safe. The error is still propagated to the caller so the user sees a failure response; recovery of `orphaned_node` rows is manual via `repair-sync` (see `docs/IMPROVEMENT_PLAN.md`).
- **Name conflict:** renameNode with duplicate sibling name or copyFile where destination already has same name → throw conflict error (or apply numeric suffix for copy).
- **Cycle detection:** moveNode rejects if newParentNodeId is a descendant of nodeId via getDescendantIds check inside fileNodeService.moveNode().

### 2.6 Verification Scenarios

#### listDirectoryWithPermissions

- [ ] Returns children with correct nodeId, name, type from file_nodes for given parentNodeId
- [ ] Includes size and mimeType from filecache LEFT JOIN; null for directories and uncached files
- [ ] Regular (non-share) user listing: unreadable children are RETAINED with `hasReadPermission=false` / `hasWritePermission=false` and `getNodePath` still resolved for them (request-access discovery)
- [ ] Owned listing (only the home-root admin grant present, no per-folder rows): every child reports `hasAdminPermission=true`
- [ ] Non-owned listing: `hasAdminPermission=false` except children with an explicit admin grant
- [ ] Share-principal listing: `hasAdminPermission` is always `false`
- [ ] Share-principal listing (`principalId: 'share:token'`): unreadable children are EXCLUDED — out-of-scope names/paths are never disclosed (share-token scope boundary)
- [ ] Admin bypass: all items return hasRead=true, hasWrite=true without querying aclService per item
- [ ] Returns empty array for leaf directory with no children
- [ ] Throws 404-style error when parentNodeId does not exist or is a file node

#### uploadFile — S3 mode

- [ ] Creates new file_node via uploadService.uploadFile and returns nodeId, size, mimeType
- [ ] Sets sync_status='active' on successful completion of TX1 → PUT → TX2 flow
- [ ] Rolls back the created file_nodes row if TX1 succeeds but S3 PUT fails (no phantom pending row; uploadService failure recovery)
- [ ] Rolls back file_nodes row entirely if createNode throws in TX1
- [ ] Conflict 'skip': returns `{ nodeId, skipped: true }` when name already exists under parent
- [ ] Conflict 'overwrite': calls uploadService.overwriteFile path for existing node

#### uploadFile — WebDAV mode

- [ ] Creates file_node and performs synchronous WebDAV PUT in single flow
- [ ] Rolls back the new node (deleteNode) if WebDAV PUT fails after DB commit; overwrite PUT failure marks orphaned_node; re-throws error
- [ ] Returns nodeId with correct size (buffer.length) and mimeType on success

#### downloadFile

- [ ] S3 mode: returns buffer via blobStorageService.downloadBlob following object_map → s3_key chain
- [ ] WebDAV mode: returns buffer via path resolution + webdav GET
- [ ] Throws notFoundError when no active object_map entry or storage resource exists (route maps to 404)
- [ ] Throws 403 if non-admin user lacks read permission on file node

#### renameNode

- [ ] S3 mode: updates name in file_nodes only; no blobStorageService calls (blob key independent of name)
- [ ] WebDAV mode: attempts best-effort storage MOVE; sets orphaned_node on failure without rolling back DB rename
- [ ] Throws validation error for empty newName or names containing path separators
- [ ] Throws conflict error if new name duplicates existing sibling under same parent

#### moveNode

- [ ] Updates parent_id and rebuilds closure table via fileNodeService.moveNode in TX
- [ ] S3 mode: no storage operation (blob key decoupled from tree position)
- [ ] WebDAV mode: attempts best-effort MOVE; marks orphaned_node on failure without rolling back DB move
- [ ] Rejects cycle: throws when newParentNodeId is a descendant of nodeId
- [ ] Ownership transfer (D6): a non-admin mover that owns the node and moves it OUTSIDE the mover's home subtree has its explicit rows on the moved subtree revoked via revokeUserSubtreePermissions (root + descendants); the mover's home-root ADMIN row is preserved
- [ ] Non-transfer: moving within the mover's own home, or moving a node the mover merely received a grant on (does not own it), does NOT revoke any rows
- [ ] Admin mover: ownership detection and revocation are skipped entirely

#### deleteNode

- [ ] Deletes leaf file node via fileNodeService.deleteNode after write-permission gate
- [ ] Enumerates all descendants for directory nodes via getDescendantIds (closure table)
- [ ] WebDAV mode: performs storage DELETE bottom-up (leaves first), marks orphaned_node on per-node failure, DB deletion proceeds regardless
- [ ] S3 mode: fileNodeService.deleteNode calls blobStorageService.deleteBlob per-file to mark object_map orphaned; actual S3 delete deferred to GC

#### copyFile — S3 mode

- [ ] Zero-copy: new file_node + object_map referencing same s3_key when source blob exclusively owned (count=1)
- [ ] Duplicates blob via duplicateBlob when source s3_key is shared by multiple nodes (count>1)
- [ ] Checks read permission on source and write permission on destination parent before proceeding

#### copyFile — WebDAV mode

- [ ] Downloads source content, creates new file_node, uploads copy to destination path via uploadToWebdav
- [ ] Rolls back the copied node (deleteNode) if upload fails after node creation, re-throws error

---

## 3. Permission Integration

Every public method performs a permission gate before proceeding with its core operation. The gates follow this pattern:

1. **Null guard + Admin bypass:** Every blocking gate uses the outer condition `if (!user || !aclService.isAdminUser(user))`. When `user` is null/undefined or when `isAdminUser()` returns true, the gate is skipped entirely and the method proceeds to its core operation. Only non-admin, non-null users are subject to permission checks.
2. **Blocking permission gates use string literals:** The blocking gates in `uploadFile`, `downloadFile`, `renameNode`, `moveNode`, `deleteNode`, and `copyFile` pass literal strings (`'read'` / `'write'`) as the permission argument, not `PERMISSIONS.READ` / `PERMISSIONS.WRITE` constants.
3. **Per-item permission checks use constants:** The per-item checks inside `listDirectoryWithPermissions` use `PERMISSIONS.READ` and `PERMISSIONS.WRITE` constants. They are **blocking for share principals only** — a share-principal child with `hasReadPermission=false` is excluded from the response (never disclosed), which is the share-token scope boundary. Regular user listings keep every child with its boolean flags so unreadable children remain visible to the request-access flow.

| Method                       | Gate Type                                   | Action                                                                                                                                                                                           | ACL Call (blocking gate)                                                                                                                                                                                   |
| ---------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| listDirectoryWithPermissions | Per-item blocking for share principals only | Read/write enumeration per child; for share principals children with `hasReadPermission=false` are filtered out before response construction, regular user listings retain them with their flags | `checkFolderPermission(userId, childId, PERMISSIONS.READ/WRITE)` for dirs; `checkFilePermission(userId, childId, PERMISSIONS.READ/WRITE)` for files — skipped entirely if admin. Uses **constant** values. |
| uploadFile                   | Blocking before create                      | Write on parent folder                                                                                                                                                                           | `checkFolderPermission(userId, parentNodeId, 'write')` — **string literal**.                                                                                                                               |
| downloadFile                 | Blocking before download                    | Read on file node                                                                                                                                                                                | `checkFilePermission(userId, fileNodeId, 'read')` — **string literal**.                                                                                                                                    |
| renameNode                   | Blocking before rename                      | Write on target node                                                                                                                                                                             | `checkFilePermission(userId, nodeId, 'write')` — **string literal**.                                                                                                                                       |
| moveNode                     | Blocking before move                        | Write on source node AND write on destination parent                                                                                                                                             | `checkFilePermission(userId, nodeId, 'write')` + `checkFolderPermission(userId, newParentNodeId, 'write')` — **string literals**.                                                                          |
| deleteNode                   | Blocking before delete                      | Write on target node                                                                                                                                                                             | `checkFilePermission(userId, nodeId, 'write')` — **string literal**.                                                                                                                                       |
| copyFile                     | Blocking before copy                        | Read on source + write on destination parent                                                                                                                                                     | `checkFilePermission(userId, nodeId, 'read')` + `checkFolderPermission(userId, destParentId, 'write')` — **string literals**.                                                                              |

The aclService functions internally handle: share principal resolution (`share:` prefixed userIds), user caching via getCachedUser, admin bypass within their own bodies, and closure-table inheritance lookups. The fileService does not duplicate this logic — it relies on aclService as the single source of truth for permission decisions.

---

## 4. Sync Status Fail-Safe Semantics

The `sync_status` column on `file_nodes` tracks consistency between database metadata and remote storage state. Three values are used:

| Value            | Meaning                                                                                                                                                                                                                               | Set When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`         | Database metadata and storage content are in sync. Node is fully usable.                                                                                                                                                              | Default for all new nodes (WebDAV mode) or after TX2 completion (S3 uploadService flow). Also set by rename/move when no storage-side operation was needed (S3 mode).                                                                                                                                                                                                                                                                                                                                                                           |
| `pending_upload` | Node exists in DB but blob content has not been written to storage yet. Intermediate state during S3 uploads.                                                                                                                         | Set by `blobStorageService.prepareUpload()` as part of TX1 in the 4-step upload flow. Transitions to `active` after TX2 completes. A failed NEW-file upload rolls the node back (no row remains — `uploadService.md` §2.5); a failed S3 OVERWRITE leaves the existing row `pending_upload` with a pending object_map (no automatic recovery — see `docs/IMPROVEMENT_PLAN.md`). |
| `orphaned_node`  | Database metadata and storage content are inconsistent. The node's DB row exists but the corresponding storage resource may be missing, at a wrong path, or in an unexpected state.                                                    | Set by any method when a best-effort storage operation fails after the DB write committed on an EXISTING node: WebDAV overwrite PUT failure during uploadFile, WebDAV MOVE failure during renameNode/moveNode, WebDAV DELETE failure during deleteNode (per-node), or WebDAV MKCOL failure during `blobStorageService.createDirectoryWebdav` (directory create / home-node ensure). New nodes created for an upload/copy are rolled back instead of being marked. The error is still propagated to the caller — orphaned_node is a fail-safe marker for repair, not silent degradation. |

**Recovery of failure states:** `pending_upload` rows left by a failed overwrite and `orphaned_node` rows are currently surfaced for MANUAL repair only — `failSafeService.scanOrphanedNodes()` / `POST /api/admin/maintenance/repair-sync` (`retry-delete` / `force-active`) covers `orphaned_node`; no automated GC path removes `pending_upload` rows or untracked S3 blobs. New-file upload failures need no recovery because the node is rolled back. The automated-recovery gap is tracked in `docs/IMPROVEMENT_PLAN.md`.

---

## 5. Error Cases

| Scenario                                                                     | Storage Mode | Behavior                                                                                                                                                                            | HTTP Status (when mapped by route handler) |
| ---------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| User lacks required permission and is not admin                              | Both         | aclService check returns false → method throws permission denied error                                                                                                              | 403                                        |
| nodeId does not exist in file_nodes                                          | Both         | Method throws not-found error before any operation proceeds                                                                                                                         | 404                                        |
| parentNodeId does not exist or is a file node                                | Both         | uploadFile/listDirectoryWithPermissions throw not-found error                                                                                                                       | 404                                        |
| S3 PUT fails during upload (network, storage full)                           | S3           | New file: TX1 committed then S3 write failed → node rolled back, nothing persisted; error propagated to caller. Overwrite: node remains sync_status='pending_upload' with pending object_map (no automatic recovery).                                                                          | 500                                        |
| WebDAV PUT fails during upload (connection refused, timeout, remote 4xx/5xx) | WebDAV       | New file: node rolled back via deleteNode, original error re-thrown. Overwrite: sync_status='orphaned_node' set on existing node, error re-thrown.                                                                                | 500                                        |
| WebDAV MOVE fails during rename/move (remote unavailable, path conflict)     | WebDAV       | DB operation succeeded, sync_status='orphaned_node' set on affected nodes, error propagated                                                                                         | 500                                        |
| WebDAV DELETE fails for one node in subtree delete                           | WebDAV       | Per-node: that specific descendant marked 'orphaned_node'. Remaining deletions proceed. DB deletion of entire subtree proceeds regardless. Error aggregated and returned to caller. | 207 (multi-status) or 500                  |
| Name conflict on rename/copy                                                 | Both         | Conflict error thrown before any mutation                                                                                                                                           | 409                                        |
| Cycle detected on moveNode                                                   | Both         | fileNodeService.moveNode rejects after getDescendantIds check; no DB mutation occurs                                                                                                | 400                                        |
| Empty newName or name with path separators on rename                         | Both         | Validation error thrown before any operation                                                                                                                                        | 400                                        |

---

## 6. Verification Scenarios

Complete checklist of testable behaviors per method, organized to drive the test scaffold in `W1.1-2` (see `phase4-sub-plan-wave1.md`).

### listDirectoryWithPermissions

- [ ] Returns children with nodeId, name, type fields for given parentNodeId
- [ ] Includes size and mimeType from filecache LEFT JOIN; null for directories without cache entries
- [ ] Sets hasReadPermission=false when non-admin user lacks read access on child node
- [ ] Sets hasWritePermission=false when non-admin user lacks write access on child parent folder
- [ ] Admin bypass: all items return hasRead=true, hasWrite=true regardless of aclService results (aclService never called for admin)
- [ ] Returns empty array for leaf directory with no children
- [ ] Throws 404-style error when parentNodeId does not exist or is a file node

### uploadFile — S3 mode

- [ ] Creates new file_node via uploadService.uploadFile and returns { nodeId, size, mimeType }
- [ ] Sets sync_status='active' on successful TX1 → PUT → TX2 completion
- [ ] Rolls back the created file_nodes row entirely if TX1 succeeds but S3 PUT fails (uploadService recovery — no phantom row)
- [ ] Rolls back file_nodes row entirely on TX1 failure — no orphaned DB rows
- [ ] Conflict 'skip': returns { nodeId, skipped: true } for existing name under parent
- [ ] Conflict default (undefined): throws conflict error for existing name

### uploadFile — WebDAV mode

- [ ] Creates file_node and performs synchronous WebDAV PUT in single flow; returns nodeId with correct size and mimeType
- [ ] Rolls back the new node (deleteNode) if WebDAV PUT fails after DB commit; overwrite PUT failure marks orphaned_node; then re-throws original error to caller

### downloadFile

- [ ] S3 mode: returns buffer via blobStorageService.downloadBlob following object_map → s3_key chain
- [ ] WebDAV mode: resolves path from nodeId via fileNodeService.getNodePath, retrieves buffer through webdav GET
- [ ] Throws notFoundError when no active object_map entry or storage resource exists (route maps to 404)
- [ ] Throws 403 if non-admin user lacks read permission on target file node

### renameNode

- [ ] S3 mode: updates name in file_nodes DB only; zero blobStorageService calls
- [ ] WebDAV mode: attempts best-effort storage MOVE via blobStorageService; sets orphaned_node on failure without rolling back DB rename
- [ ] Throws validation error for empty newName or names containing `/` or `\`
- [ ] Throws conflict error if new name duplicates existing sibling under same parent (UNIQUE constraint violation from DB)

### moveNode

- [ ] Updates parent_id and rebuilds closure table via fileNodeService.moveNode in TX
- [ ] S3 mode: no storage operation invoked (blob key decoupled from tree position)
- [ ] WebDAV mode: attempts best-effort MOVE on remote; sets orphaned_node on failure without rolling back DB move
- [ ] Rejects cycle: throws when newParentNodeId is a descendant of nodeId
- [ ] Ownership transfer (D6): non-admin mover that owned the node moves it into another user's home subtree → mover's rows on the moved subtree are revoked (both tables, root included); shared listing no longer surfaces it
- [ ] Received grant preserved: a mover that does NOT own the node (merely received a grant) moving it within the owning user's home keeps its grant row intact
- [ ] Within-own-home move: no rows revoked
- [ ] Admin mover: no ownership detection, no revocation

### deleteNode

- [ ] Deletes leaf file node via fileNodeService.deleteNode after write-permission gate passes
- [ ] Enumerates all descendants for directory nodes via getDescendantIds (closure table) before deletion
- [ ] WebDAV mode: performs storage DELETE bottom-up (leaves first, directories last); marks orphaned_node on per-node failure; DB deletion of entire subtree proceeds regardless of individual failures
- [ ] S3 mode: fileNodeService.deleteNode cascade triggers blobStorageService.deleteBlob per-file to mark object_map rows orphaned; actual S3 delete deferred to Phase 6 GC

### copyFile — S3 mode

- [ ] Zero-copy when source blob exclusively owned (countActiveObjectsByS3Key === 1): new file_node + object_map row referencing same s3_key with status='active'
- [ ] Duplicates blob via duplicateBlob when source s3_key shared by multiple nodes: downloads, re-uploads under new key, links copy to new key
- [ ] Checks read permission on source node and write permission on destination parent before proceeding

### copyFile — WebDAV mode

- [ ] Downloads source content via downloadBlob, creates new file_node in destination, uploads copy via uploadToWebdav at resolved path
- [ ] Rolls back the copied node (deleteNode) if uploadToWebdav fails after file_node creation; re-throws error to caller
