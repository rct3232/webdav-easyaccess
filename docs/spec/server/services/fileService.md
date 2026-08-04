# fileService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User-facing file operations service replacing path-based `server/domains/files/services/fileService.js`. Dispatches all work through the Phase 2 service layer (fileNodeService, blobStorageService, uploadService, aclService). No direct WebDAV or S3 calls — all storage operations route through blobStorageService. Dual-backend support for S3 and WebDAV modes determined at factory time by injected dependencies, not hardcoded configuration. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/fileService.js` (refactored to add nodeId methods alongside legacy path-based surface)
- **Test file:** `server/domains/files/services/__tests__/fileService.test.js`

### 2.2 Factory Function Signature

```js
function createFileService({ fileNodeService, blobStorageService, uploadService, aclService, fileStorageMode }) {
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

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeService | object | yes | Tree operations (createFile, renameNode, moveNode, deleteNode, listDirectory, getDescendantIds, updateSyncStatus, getNodePath) — see `fileNodeService.md` |
| blobStorageService | object | yes | Blob lifecycle (prepareUpload, completeUpload, downloadBlob, overwriteBlob, deleteBlob, getActiveS3Key, duplicateBlob, linkObject, uploadToWebdav) — see `blobStorageService.md` |
| uploadService | object | yes | 4-step upload orchestration (uploadFile, overwriteFile, downloadFile) — see `uploadService.md` |
| aclService | object | yes | Permission checks (checkFolderPermission, checkFilePermission, isAdminUser) — see `aclService.js` |
| fileStorageMode | string | yes | `'s3'` or `'webdav'`. Determined by injected blobStorageService capability at composition time, not read from environment variables inside this service. |

### 2.3 Methods

#### `listDirectoryWithPermissions(userId, parentNodeId, user)`

Lists children of a directory node with permission flags computed per item via the closure table and aclService.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| userId | number | yes | ID of the requesting user (principal) |
| parentNodeId | number | yes | Node ID of the directory to list |
| user | object | yes | Full user object with `is_admin` flag for admin bypass resolution |

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
  hasWritePermission: boolean
}
```

**Operations:**

1. `fileNodeService.listDirectory(parentNodeId)` — retrieves children rows with filecache metadata (LEFT JOIN). If parentNodeId does not exist or is not a directory, throws 404-style error.
2. For each child item:
   - If `isAdminUser(user)` → set `hasReadPermission = true`, `hasWritePermission = true` immediately (admin bypass, no DB queries).
   - Otherwise:
      - If child type is `'directory'`: call `aclService.checkFolderPermission(userId, childNodeId, PERMISSIONS.READ)` for read flag and `aclService.checkFolderPermission(userId, childNodeId, PERMISSIONS.WRITE)` for write flag.
      - If child type is `'file'`: call `aclService.checkFilePermission(userId, childNodeId, PERMISSIONS.READ)` for read flag and `aclService.checkFilePermission(userId, childNodeId, PERMISSIONS.WRITE)` for write flag.
3. Map each result into the response shape above.

**DB operations:** Single SELECT via listDirectory (file_nodes + filecache LEFT JOIN). Permission checks are separate async queries per item unless admin bypass applies.

---

#### `uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict)`

Creates a new file node and stores its content. Dispatch strategy differs by storage mode.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| userId | number | yes | ID of the requesting user |
| parentNodeId | number \| null | yes | Parent directory node; null for root-level creation |
| name | string | yes | File name (subject to UNIQUE constraint per parent) |
| buffer | Buffer | yes | File content bytes |
| mimeType | string | yes | MIME type of the file |
| user | object | yes | Full user object for permission resolution |
| onConflict | string | no | `'skip'`, `'overwrite'`, or `undefined` (default: throw on conflict) |

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
4. If WebDAV PUT fails after DB commit: call `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')` as fail-safe, then re-throw the error.
5. Returns `{ nodeId, size: buffer.length, mimeType }`.

**Failure recovery:** See Section 5 (Sync Status Fail-Safe Semantics). S3 mode follows uploadService failure table (`uploadService.md` §2.5). WebDAV mode marks orphaned_node on PUT failure.

---

#### `downloadFile(fileNodeId, userId, user)`

Downloads file content through the appropriate storage backend.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| fileNodeId | number | yes | ID of the file node to download |
| userId | number | yes | ID of the requesting user |
| user | object | yes | Full user object for admin bypass resolution |

**Returns:** `Buffer` — file content. Throws `notFoundError(SERVER_ERROR_CODES.files.notFound)` when `blobStorageService.downloadBlob(fileNodeId)` yields no buffer.

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true, call `aclService.checkFilePermission(userId, fileNodeId, 'read')` (string literal). If check returns false, throw 404 via `notFoundError`. Admin or null-user bypasses this gate entirely.
2. S3 mode: dispatch to `blobStorageService.downloadBlob(fileNodeId)` — resolves object_map → active s3_key → S3 GET. Throws `notFoundError` on empty active object.
3. WebDAV mode: resolve path via `fileNodeService.getNodePath(fileNodeId)`, then call `blobStorageService.downloadFromWebdav(path)`. Throws `notFoundError` on 404.

**DB operations:** Permission check queries object_map via aclService (S3) or no storage query (WebDAV). Blob download is read-only from storage backend.

---

#### `renameNode(nodeId, newName, userId, user)`

Renames a node in the database with optional best-effort storage-side rename for WebDAV mode.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the node to rename |
| newName | string | yes | New name (must not conflict with existing sibling) |
| userId | number | yes | ID of the requesting user |
| user | object | yes | Full user object for permission resolution |

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

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the node to move |
| newParentNodeId | number \| null | yes | New parent directory; null means move to root level |
| userId | number | yes | ID of the requesting user |
| user | object | yes | Full user object for permission resolution |

**Returns:** `{ nodeId, newParentId }` — confirmation of moved node.

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true:
   - Check write on source via `aclService.checkFilePermission(userId, nodeId, 'write')` (string literal). If false, throw 403.
   - Check write on destination parent via `aclService.checkFolderPermission(userId, newParentNodeId, 'write')` (string literal). If false, throw 403.
   Admin or null-user bypasses this gate entirely.
2. Storage-side sync (mode-dependent):
   - **S3 mode:** No storage operation needed. Blob keys are decoupled from tree position.
   - **WebDAV mode:** Uses "download content → DB move → re-upload" pattern (not native WebDAV MOVE). Before the DB move, download file content via `blobStorageService.downloadBlob(nodeId)` — if download fails, proceed with DB-only move (storage sync is best-effort). After the DB move, re-upload the buffered content to the new path via `blobStorageService.uploadToWebdav(nodeId, webdavBuffer)`. If re-upload fails, set `sync_status = 'orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')`. Do not abort DB move — metadata is authoritative.
3. DB move: `fileNodeService.moveNode(nodeId, newParentNodeId)` — updates parent_id + rebuilds closure table in TX. Cycle detection handled internally by fileNodeService (calls getDescendantIds and rejects if newParentId is a descendant).
4. Return confirmation.

---

#### `deleteNode(nodeId, userId, user)`

Deletes a node and its entire subtree. For WebDAV mode, attempts best-effort storage deletion bottom-up before DB removal.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the root node to delete |
| userId | number | yes | ID of the requesting user |
| user | object | yes | Full user object for permission resolution |

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

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the file node to copy |
| destinationParentNodeId | number \| null | yes | Target parent directory; null for root-level placement |
| newName | string | yes | Name for the copied file |
| userId | number | yes | ID of the requesting user |
| user | object | yes | Full user object for permission resolution |

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
5. If upload fails after DB commit: set `sync_status = 'orphaned_node'` on copied node, re-throw error.
6. Return `{ sourceNodeId, copiedNodeId }`.

### 2.4 Dependencies

| Dependency | Purpose |
|------------|---------|
| fileNodeService | Tree CRUD (createFile, renameNode, moveNode, deleteNode, listDirectory, getNode), closure table maintenance (getDescendantIds), sync status updates |
| blobStorageService | Blob lifecycle: prepareUpload/completeUpload for S3 mode; downloadBlob for both modes; uploadToWebdav/deleteBlob for WebDAV operations; getActiveS3Key/duplicateBlob/linkObject for copy-on-write |
| uploadService | Orchestrates 4-step S3 upload flow (TX1 → PUT → TX2) with failure recovery states |
| aclService | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser |

### 2.5 Error Cases

- **Permission denied:** Any method where the user lacks required permission and is not an admin throws a 403 error. The caller (route handler) maps this to HTTP 403.
- **Node not found:** If nodeId or parentNodeId does not correspond to an existing file_nodes row, throw 404 error. Applies to all methods accepting node IDs.
- **Storage failure — S3 mode:** Upload failures leave object_map in 'pending' state and sync_status as 'pending_upload'. Recoverable via retry endpoint or Phase 6 GC cleanup. See `uploadService.md` §2.5 for full failure matrix.
- **Storage failure — WebDAV mode:** Any storage operation that fails after a DB commit sets `sync_status = 'orphaned_node'` on the affected node(s) as a fail-safe. The error is still propagated to the caller so the user sees a failure response, but the database reflects an inconsistent state that Phase 6 GC can repair.
- **Name conflict:** renameNode with duplicate sibling name or copyFile where destination already has same name → throw conflict error (or apply numeric suffix for copy).
- **Cycle detection:** moveNode rejects if newParentNodeId is a descendant of nodeId via getDescendantIds check inside fileNodeService.moveNode().

### 2.6 Verification Scenarios

#### listDirectoryWithPermissions
- [ ] Returns children with correct nodeId, name, type from file_nodes for given parentNodeId
- [ ] Includes size and mimeType from filecache LEFT JOIN; null for directories and uncached files
- [ ] Sets hasReadPermission=false / hasWritePermission=false when user lacks access on child node (non-admin)
- [ ] Admin bypass: all items return hasRead=true, hasWrite=true without querying aclService per item
- [ ] Returns empty array for leaf directory with no children
- [ ] Throws 404-style error when parentNodeId does not exist or is a file node

#### uploadFile — S3 mode
- [ ] Creates new file_node via uploadService.uploadFile and returns nodeId, size, mimeType
- [ ] Sets sync_status='active' on successful completion of TX1 → PUT → TX2 flow
- [ ] Marks sync_status='pending_upload' if TX1 succeeds but S3 PUT fails (uploadService failure recovery)
- [ ] Rolls back file_nodes row entirely if createNode throws in TX1
- [ ] Conflict 'skip': returns `{ nodeId, skipped: true }` when name already exists under parent
- [ ] Conflict 'overwrite': calls uploadService.overwriteFile path for existing node

#### uploadFile — WebDAV mode
- [ ] Creates file_node and performs synchronous WebDAV PUT in single flow
- [ ] Sets sync_status='orphaned_node' if WebDAV PUT fails after DB commit, then re-throws error
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
- [ ] Sets orphaned_node if upload fails after node creation, re-throws error

---

## 3. Permission Integration

Every public method performs a permission gate before proceeding with its core operation. The gates follow this pattern:

1. **Null guard + Admin bypass:** Every blocking gate uses the outer condition `if (!user || !aclService.isAdminUser(user))`. When `user` is null/undefined or when `isAdminUser()` returns true, the gate is skipped entirely and the method proceeds to its core operation. Only non-admin, non-null users are subject to permission checks.
2. **Blocking permission gates use string literals:** The blocking gates in `uploadFile`, `downloadFile`, `renameNode`, `moveNode`, `deleteNode`, and `copyFile` pass literal strings (`'read'` / `'write'`) as the permission argument, not `PERMISSIONS.READ` / `PERMISSIONS.WRITE` constants.
3. **Per-item permission checks use constants:** The per-item checks inside `listDirectoryWithPermissions` (which are non-blocking — they only set boolean flags on each result row) use `PERMISSIONS.READ` and `PERMISSIONS.WRITE` constants.

| Method | Gate Type | Action | ACL Call (blocking gate) |
|--------|-----------|--------|--------------------------|
| listDirectoryWithPermissions | Per-item flags, not blocking | Read/write enumeration per child | `checkFolderPermission(userId, childId, PERMISSIONS.READ/WRITE)` for dirs; `checkFilePermission(userId, childId, PERMISSIONS.READ/WRITE)` for files — skipped entirely if admin. Uses **constant** values. |
| uploadFile | Blocking before create | Write on parent folder | `checkFolderPermission(userId, parentNodeId, 'write')` — **string literal**. |
| downloadFile | Blocking before download | Read on file node | `checkFilePermission(userId, fileNodeId, 'read')` — **string literal**. |
| renameNode | Blocking before rename | Write on target node | `checkFilePermission(userId, nodeId, 'write')` — **string literal**. |
| moveNode | Blocking before move | Write on source node AND write on destination parent | `checkFilePermission(userId, nodeId, 'write')` + `checkFolderPermission(userId, newParentNodeId, 'write')` — **string literals**. |
| deleteNode | Blocking before delete | Write on target node | `checkFilePermission(userId, nodeId, 'write')` — **string literal**. |
| copyFile | Blocking before copy | Read on source + write on destination parent | `checkFilePermission(userId, nodeId, 'read')` + `checkFolderPermission(userId, destParentId, 'write')` — **string literals**. |

The aclService functions internally handle: share principal resolution (`share:` prefixed userIds), user caching via getCachedUser, admin bypass within their own bodies, and closure-table inheritance lookups. The fileService does not duplicate this logic — it relies on aclService as the single source of truth for permission decisions.

---

## 4. Sync Status Fail-Safe Semantics

The `sync_status` column on `file_nodes` tracks consistency between database metadata and remote storage state. Three values are used:

| Value | Meaning | Set When |
|-------|---------|----------|
| `active` | Database metadata and storage content are in sync. Node is fully usable. | Default for all new nodes (WebDAV mode) or after TX2 completion (S3 uploadService flow). Also set by rename/move when no storage-side operation was needed (S3 mode). |
| `pending_upload` | Node exists in DB but blob content has not been written to storage yet. Intermediate state during S3 uploads. | Set by `blobStorageService.prepareUpload()` as part of TX1 in the 4-step upload flow. Transitions to `active` after TX2 completes. If S3 PUT fails, remains `pending_upload` for retry or GC cleanup. |
| `orphaned_node` | Database metadata and storage content are inconsistent. The node's DB row exists but the corresponding storage resource may be missing, at a wrong path, or in an unexpected state. Best-effort recovery is expected from Phase 6 GC. | Set by any method when a best-effort storage operation fails after the DB write committed: WebDAV PUT failure during uploadFile, WebDAV MOVE failure during renameNode/moveNode, WebDAV DELETE failure during deleteNode (per-node), or WebDAV uploadToWebdav failure during copyFile. The error is still propagated to the caller — orphaned_node is a fail-safe marker for eventual consistency repair, not silent degradation. |

**Recovery expectations:** Phase 6 GC service scans `file_nodes` for `sync_status != 'active'` rows and attempts reconciliation:
- `pending_upload` nodes with no corresponding storage object → clean up DB row (orphaned pending).
- `orphaned_node` files → attempt re-upload from cached content or mark for user review.
- `orphaned_node` directories → attempt to repair children recursively or escalate for manual intervention.

---

## 5. Error Cases

| Scenario | Storage Mode | Behavior | HTTP Status (when mapped by route handler) |
|----------|-------------|----------|---------------------------------------------|
| User lacks required permission and is not admin | Both | aclService check returns false → method throws permission denied error | 403 |
| nodeId does not exist in file_nodes | Both | Method throws not-found error before any operation proceeds | 404 |
| parentNodeId does not exist or is a file node | Both | uploadFile/listDirectoryWithPermissions throw not-found error | 404 |
| S3 PUT fails during upload (network, storage full) | S3 | TX1 committed (pending state), S3 write failed → sync_status='pending_upload' propagated to caller as error response. Recoverable via retry or GC. | 500 |
| WebDAV PUT fails during upload (connection refused, timeout, remote 4xx/5xx) | WebDAV | DB node committed with sync_status='orphaned_node', error re-thrown to caller | 500 |
| WebDAV MOVE fails during rename/move (remote unavailable, path conflict) | WebDAV | DB operation succeeded, sync_status='orphaned_node' set on affected nodes, error propagated | 500 |
| WebDAV DELETE fails for one node in subtree delete | WebDAV | Per-node: that specific descendant marked 'orphaned_node'. Remaining deletions proceed. DB deletion of entire subtree proceeds regardless. Error aggregated and returned to caller. | 207 (multi-status) or 500 |
| Name conflict on rename/copy | Both | Conflict error thrown before any mutation | 409 |
| Cycle detected on moveNode | Both | fileNodeService.moveNode rejects after getDescendantIds check; no DB mutation occurs | 400 |
| Empty newName or name with path separators on rename | Both | Validation error thrown before any operation | 400 |

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
- [ ] Leaves sync_status='pending_upload' if TX1 succeeds but S3 PUT fails (uploadService recovery state)
- [ ] Rolls back file_nodes row entirely on TX1 failure — no orphaned DB rows
- [ ] Conflict 'skip': returns { nodeId, skipped: true } for existing name under parent
- [ ] Conflict default (undefined): throws conflict error for existing name

### uploadFile — WebDAV mode
- [ ] Creates file_node and performs synchronous WebDAV PUT in single flow; returns nodeId with correct size and mimeType
- [ ] Sets sync_status='orphaned_node' if WebDAV PUT fails after DB commit, then re-throws original error to caller

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
- [ ] Sets orphaned_node if uploadToWebdav fails after file_node creation; re-throws error to caller
