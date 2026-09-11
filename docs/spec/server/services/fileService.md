# fileService Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | User-facing file operations service. Dispatches nodeId-keyed storage work through the service layer (fileNodeService, blobStorageService, uploadService, aclService). Path/key-level WebDAV operations (trash MOVE, rename/move MOVE, copy COPY, overwrite last-good snapshot) legitimately use the raw `blobStore` adapter, because they address explicit display paths that the nodeId-keyed service cannot express. Dual-backend support for S3 and WebDAV modes determined at factory time by injected dependencies, not hardcoded configuration. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/fileService.js` (refactored to add nodeId methods alongside legacy path-based surface)
- **Test file:** `server/domains/files/services/__tests__/fileService.test.js`

### 2.2 Factory Function Signature

```js
function createFileService({ fileNodeService, blobStorageService, uploadService, aclService, fileStorageMode, permissionStore, ownerNodeResolver, blobStore, fileNodesStore }) {
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
| blobStorageService | object | yes      | Blob lifecycle (prepareUpload, completeUpload, downloadBlob, getActiveS3Key, duplicateBlob, linkObject, ensureExclusiveBlob, uploadToWebdav) — see `blobStorageService.md`        |
| uploadService      | object | yes      | 4-step upload orchestration (uploadFile, overwriteFile) — see `uploadService.md`                                                                                          |
| aclService         | object | yes      | Permission checks (checkFolderPermission, checkFilePermission, isAdminUser) — see `aclService.js`                                                                                       |
| fileStorageMode    | string | yes      | `'s3'` or `'webdav'`. Determined by injected blobStorageService capability at composition time, not read from environment variables inside this service.                                |
| permissionStore    | object | no       | Store-level permission CRUD (`revokeUserSubtreePermissions`). Defaults to the real store when omitted. Used only by `moveNode` for the ownership-transfer cleanup (D6).                 |
| ownerNodeResolver  | object | no       | Owner detection via closure-table ancestry (`isOwnerNode`). Defaults to the real resolver when omitted. Used only by `moveNode` to decide whether a move is an ownership transfer (D6). |
| blobStore          | object | no       | Raw blob-store adapter (`headBlob`/`moveBlob`/`copyBlob`/`deleteBlob`/`ensureDirectoryExists`) for WebDAV path-level operations: trash MOVE (`deleteNode`), rename/move remote MOVE, native COPY (`copyFile`, overwrite snapshot), tmp cleanup. Required in WebDAV mode; unused in S3 mode. Injected by the composition root. |
| fileNodesStore     | object | no       | Filecache read/write (`getCache`/`upsertCache`). Used only by `copyFile` (S3 mode) to mirror the source cache row onto the copied node. Injected by the composition root.                |

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
3. New file: `fileNodeService.createFile(parentNodeId, name)` — creates the node with the repository default `sync_status='pending_upload'` (same as S3 mode; WebDAV native nodes keep this value for their whole lifetime under normal operation — see §4). For overwrite: reuse the existing file's nodeId.
4. Overwrite last-good snapshot (WebDAV, overwrite only): `blobStore.ensureDirectoryExists('/.wea-tmp')` (idempotent MKCOL on the reserved namespace) then `blobStore.copyBlob(displayPath, '/.wea-tmp/<nodeId>')` — a server-side native COPY of the previous bytes (no GET/PUT round-trip through the app). If the snapshot COPY reports source-not-found (no remote content existed to protect), skip the snapshot and proceed; any other snapshot COPY failure is re-thrown BEFORE the destructive PUT (the previous content is left untouched).
5. PUT: `blobStorageService.uploadToWebdav(nodeId, buffer)` — synchronous PUT to remote storage (path resolution happens inside blobStorageService). On success (overwrite): remove the tmp snapshot best-effort via `blobStore.deleteBlob(tmpPath)`.
6. On WebDAV PUT failure — **new file**: roll back the just-created node via `fileNodeService.deleteNode(nodeId)` (best-effort), then re-throw the original error — no phantom 0-byte file remains and a retry is not blocked by a duplicate-name conflict. On WebDAV PUT failure — **overwrite**: restore the last-good bytes with `blobStore.moveBlob(tmpPath, displayPath, true)` (native MOVE, Overwrite:T); on restore success re-throw the original error — the node keeps its pre-state (previous content downloadable, `sync_status` untouched). If the restore itself fails (or no snapshot existed because the PUT destroyed content that was never protected), mark `sync_status='orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')` as fail-safe (the pre-existing node must not be deleted) and re-throw.
7. Returns `{ nodeId, size: buffer.length, mimeType }`.

**Failure recovery:** See Section 5 (Sync Status Fail-Safe Semantics). S3 mode follows uploadService failure table (`uploadService.md` §2.5). WebDAV mode rolls back NEW nodes on PUT failure and restores the previous bytes from the last-good snapshot on overwrite PUT failure; `orphaned_node` remains only where restoration is impossible (restore failed / snapshot source was missing and content may be destroyed). A `/.wea-tmp/<nodeId>` entry left by a crash or a failed cleanup is reconciliation residue (DEF-18 class).

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
   - **WebDAV mode:** Native MOVE with DB rollback. Before the DB rename, capture `oldPath = fileNodeService.getNodePath(nodeId)`. After the DB rename, move the remote resource with `blobStore.moveBlob(oldPath, newPath)` (one server-side MOVE — files and directory subtrees alike; the adapter falls back to streamed copy when a server refuses native MOVE). On MOVE failure: **roll the DB rename back** (`fileNodeService.renameNode(nodeId, <old name>)`) and re-throw — the operation leaves no partial state on either side, so a retry is meaningful. Two exceptions keep the DB change instead of rolling back: (a) the failure is source-not-found (404 — there was no remote content to move, so there is nothing to restore), and (b) the rollback itself fails (e.g. the old name was taken in the meantime); in both cases set `sync_status = 'orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')` and re-throw the original error.
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
3. Pre-write capture (WebDAV mode only): resolve `oldPath = fileNodeService.getNodePath(nodeId)` and remember `node.parent_id` as `oldParentNodeId` before any DB write.
4. DB move: `fileNodeService.moveNode(nodeId, newParentNodeId)` — updates parent_id + rebuilds closure table in TX. Cycle detection handled internally by fileNodeService (calls getDescendantIds and rejects if newParentId is a descendant).
5. Storage-side sync (mode-dependent):
   - **S3 mode:** No storage operation needed. Blob keys are decoupled from tree position.
   - **WebDAV mode:** Native MOVE with DB rollback — identical policy to `renameNode` step 5. `blobStore.moveBlob(oldPath, newPath)` (one server-side MOVE of the file or whole directory subtree); on failure roll the DB move back via `fileNodeService.moveNode(nodeId, oldParentNodeId)` and re-throw; the two keep-the-move exceptions (source-not-found; rollback itself failed) set `sync_status='orphaned_node'` and re-throw instead.
6. **Ownership-transfer cleanup (D6):** after the closure rebuild (reached only when the DB move stands — a step 5 rollback re-throws first), if step 2 detected an ownership transfer, call `permissionStore.revokeUserSubtreePermissions(userId, nodeId)` to delete the mover's explicit permission rows on the moved subtree (root + descendants, depth ≥ 0) from both `permissions_user_paths` and `permissions_user_files`. Without this, the mover's historical self-grants / admin-assigned rows on the subtree would resurface in `GET /api/permissions/shared` as "shared with me" leaks even though the mover no longer owns the subtree. The mover's home-root ADMIN grant is untouched (it lives on the home root, not inside the moved subtree). This cleanup is best-effort: it runs after the DB move committed and does not abort or roll back the move.
7. Return confirmation.

---

#### `deleteNode(nodeId, userId, user)`

Soft-deletes (trashes) a node and its entire subtree: every row of the subtree is marked
`file_nodes.deleted_at` (DEF-16 P2). No DB row is removed and — in WebDAV mode — the subtree's
remote content is moved once, as a whole, to the hidden trash path. Restore/purge are NOT part of
this method — they live in the trash channel (`server/service/trashService.js` + the
`/api/files/trash/*` routes, see §4.1).

| Param  | Type   | Required | Description                                |
| ------ | ------ | -------- | ------------------------------------------ |
| nodeId | number | yes      | ID of the root node to trash               |
| userId | number | yes      | ID of the requesting user                  |
| user   | object | yes      | Full user object for permission resolution |

**Returns:** `{ deletedCount }` — total number of trashed nodes (subtree count: descendants + 1).
The count semantics are unchanged from the hard-delete era; it is the size of the marked subtree.

**Operations:**

1. Permission gate: guard is `if (!user || !aclService.isAdminUser(user))` — when true, call `aclService.checkFilePermission(userId, nodeId, 'write')` (string literal). If check returns false, throw 403 via `forbiddenError`. Admin or null-user bypasses this gate entirely (admin delete = trash, same pipeline).
2. Confirm existence via `fileNodeService.getNode(nodeId)` — throws `notFoundError` if node does not exist (live rows only; an already-trashed node is not-found here).
3. Enumerate subtree: `fileNodeService.getDescendantIds(nodeId)` returns all descendant IDs from the closure table (UNFILTERED — the closure table survives trash, so a partially-marked subtree is still fully enumerable; re-running the marking is idempotent).
4. WebDAV remote MOVE (one per subtree root, before any DB marking):
   - Resolve the subtree root's display path via `fileNodeService.getNodePath(nodeId)`.
   - Destination is the reserved hidden namespace `/.wea-trash/<nodeId>` (`nodeId` = the trashed ROOT's id; descendants keep their relative structure under it).
   - **Destination-exists guard:** probe `blobStore.headBlob('/.wea-trash/<nodeId>')` first; when a pre-existing `.wea-*` entry is found (a legacy/out-of-band node — new `.wea-` names are rejected by `validateFileName`), throw a clear conflict error (`files.trashTargetExists`) and abort the trash: `deleted_at` is NOT set, no orphaned marker is written, and the live node stays untouched. Never clobber.
   - `blobStore.moveBlob(displayPath, '/.wea-trash/<nodeId>')` — exactly ONE remote MOVE for the whole subtree (children move with the collection; no per-node remote I/O). New PUTs to the original display path can no longer clobber trashed content, and the path-based storage stays consistent with the DB-side trash.
   - On MOVE failure: mark the subtree ROOT `sync_status = 'orphaned_node'` via `fileNodeService.updateSyncStatus(nodeId, 'orphaned_node')` (existing fail-safe channel), do NOT mark `deleted_at`, and re-throw the original error — the trash is aborted, the node remains live and listed.
   - **S3 mode: zero physical I/O** — keys are stable UUIDs, no MOVE, no delete; the active object_map rows simply stay in place (and stay in the GC keep-set via the active arm).
5. Subtree marking: `fileNodeService.markSubtreeDeleted([nodeId, ...descendantIds])` — a single `UPDATE file_nodes SET deleted_at = NOW() WHERE id IN (...)` executed for every row of the subtree (`changes` = rows marked). `fileNodeService.deleteNode` (hard delete: ancestor-cleanup + row removal + FK cascade) is deliberately NOT called here — it remains the hard-delete primitive for the fail-safe repair channel, the upload/copy rollback paths, and the admin permanent-delete maintenance route.
6. Return `{ deletedCount: descendantIds.length + 1 }`.

**Batch delete inherits trash:** `batchOperationService.batchDelete` dispatches through this
method, so bulk delete trashes too (same marking, same WebDAV MOVE semantics per root).

**Permissions/shares/recent interplay:** permission rows, share links and recent-file rows are NOT
touched by trash — they survive on the (still existing) rows and are hidden by the read gates
instead (`fileNodesStore.md` §2.4: `getNode`/`getChildren`/`resolvePathSegment` are live-row reads;
`listSharedWithUser` excludes trashed rows; recent files are filtered at enrichment).

**DB operations:** getDescendantIds (SELECT), one `markSubtreeDeleted` (UPDATE ... WHERE id IN), and — WebDAV mode only — one path resolution + one `headBlob` probe + one `moveBlob`.

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
4. After linking the blob, set the copied node to `fileNodeService.updateSyncStatus(copiedNodeId, 'active')`. A copy is immediately usable and migratable — it must not stay on the repository `pending_upload` default, because s3→webdav migration snapshots enumerate only `sync_status='active'` file nodes (`migrationService.md`), and a `pending_upload` copy would be dropped from the destination at cutover.
5. Mirror the source cache metadata: read the source `filecache` row via `fileNodesStore.getCache(nodeId)`; when present, write the copied node's cache via `fileNodesStore.upsertCache(copiedNodeId, cache.size, cache.mime_type, null)` — the COW blob is byte-identical to the source, so the copy's listing size/mime match without any remote probe. A source without a cache row is skipped (copy renders null size, same legacy shape).
6. New file node uses `newName` param; name conflict → numeric suffix via `createFile` behavior.
7. Return `{ sourceNodeId, copiedNodeId }`.

**WebDAV Mode (native COPY):**

1. Permission gate: same null-guard + string-literal checks as S3 mode (`'read'` on source, `'write'` on destination parent).
2. Capture the source display path via `fileNodeService.getNodePath(nodeId)` (before the copy node exists — the source stays untouched).
3. Create the copy node via `fileNodeService.createFile(destinationParentNodeId, newName)`. Handle name conflict with numeric suffix.
4. Server-side copy via `blobStore.copyBlob(sourcePath, copyPath)` — native WebDAV COPY with `Depth: infinity` (directory subtrees copy in one operation; the adapter falls back to a streamed recursive copy when the server refuses native COPY). Bytes never round-trip through the app.
5. Mirror the listing metadata: for a FILE source, probe the fresh copy via `blobStore.headBlob(copyPath)` and write `fileNodesStore.upsertCache(copiedNodeId, contentLength, contentType, null)`; directory sources get no cache row (same shape as S3 directories).
6. If the COPY fails: roll back the copied (new) node via `fileNodeService.deleteNode(copiedNodeId)` (best-effort), then re-throw the original error — no phantom copy, no retry-blocking conflict.
7. Return `{ sourceNodeId, copiedNodeId }`.

### 2.4 Dependencies

| Dependency         | Purpose                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fileNodeService    | Tree CRUD (createFile, renameNode, moveNode, deleteNode, listDirectory, getNode), closure table maintenance (getDescendantIds), sync status updates                                               |
| blobStorageService | Blob lifecycle: prepareUpload/completeUpload for S3 mode; downloadBlob for both modes; uploadToWebdav for WebDAV PUTs; getActiveS3Key/duplicateBlob/linkObject/ensureExclusiveBlob for copy-on-write. Path-level WebDAV ops (MOVE/COPY/snapshot) go to the raw `blobStore` adapter (§1) |
| uploadService      | Orchestrates 4-step S3 upload flow (TX1 → PUT → TX2) with failure recovery states                                                                                                                 |
| aclService         | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser                                                                                                                   |
| permissionStore    | Ownership-transfer cleanup in moveNode: revokeUserSubtreePermissions (D6)                                                                                                                         |
| fileNodesStore     | Copy metadata mirror in copyFile (S3 mode): `getCache` on the source + `upsertCache` for the copied node. Injected via factory options (composition)                                |
| ownerNodeResolver  | Ownership detection in moveNode: isOwnerNode (D6)                                                                                                                                                 |

### 2.5 Error Cases

- **Permission denied:** Any method where the user lacks required permission and is not an admin throws a 403 error. The caller (route handler) maps this to HTTP 403.
- **Node not found:** If nodeId or parentNodeId does not correspond to an existing file_nodes row, throw 404 error. Applies to all methods accepting node IDs.
- **Storage failure — S3 mode:** New-file upload failures roll back the created node — nothing persists in DB (see `uploadService.md` §2.5). Overwrite failures roll back to the pre-state — the node returns to `active` with the previous version still downloadable; only if the rollback itself fails does the node stay `pending_upload` with a pending object_map (scan/repair + GC cleanup — see `docs/IMPROVEMENT_PLAN.md`).
- **Storage failure — WebDAV mode:** NEW nodes (new-file upload, copyFile) are rolled back when the backend write fails. rename/move failures roll the DB change back and re-throw (nothing partial on either side — the user can retry). Overwrite PUT failures restore the previous bytes from the `/.wea-tmp/<nodeId>` last-good snapshot and re-throw. `sync_status='orphaned_node'` is set only where restoration is impossible: rename/move where the remote source was absent (nothing to restore), a failed rollback, a failed overwrite restore, trash MOVE failure, directory MKCOL failure. The error is always propagated to the caller so the user sees a failure response; recovery of `orphaned_node` rows is manual via `repair-sync` (see `docs/IMPROVEMENT_PLAN.md`). A trash MOVE whose `/.wea-trash/<nodeId>` destination already exists fails BEFORE any state change with the explicit `trashTargetExists` conflict error (no orphaned marker, no marking).
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
- [ ] Rolls back the new node (deleteNode) if WebDAV PUT fails after DB commit; re-throws error
- [ ] Overwrite: snapshots the previous bytes to `/.wea-tmp/<nodeId>` (native COPY) before the PUT; PUT failure restores them via moveBlob(overwrite) and re-throws without marking; restore failure (or missing source for the snapshot + destructive PUT) marks orphaned_node
- [ ] Returns nodeId with correct size (buffer.length) and mimeType on success

#### downloadFile

- [ ] S3 mode: returns buffer via blobStorageService.downloadBlob following object_map → s3_key chain
- [ ] WebDAV mode: returns buffer via path resolution + webdav GET
- [ ] Throws notFoundError when no active object_map entry or storage resource exists (route maps to 404)
- [ ] Throws 403 if non-admin user lacks read permission on file node

#### renameNode

- [ ] S3 mode: updates name in file_nodes only; no blobStorageService calls (blob key independent of name)
- [ ] WebDAV mode: captures the old path BEFORE the DB rename, then one native `blobStore.moveBlob(oldPath, newPath)` (works for files AND directory subtrees); MOVE failure rolls the DB rename back and re-throws; only source-not-found or a failed rollback keeps the rename and marks orphaned_node
- [ ] Throws validation error for empty newName or names containing path separators
- [ ] Throws conflict error if new name duplicates existing sibling under same parent

#### moveNode

- [ ] Updates parent_id and rebuilds closure table via fileNodeService.moveNode in TX
- [ ] S3 mode: no storage operation (blob key decoupled from tree position)
- [ ] WebDAV mode: captures the old path BEFORE the DB move, then one native `blobStore.moveBlob(oldPath, newPath)`; MOVE failure rolls the DB move back (and skips the D6 cleanup) and re-throws; only source-not-found or a failed rollback keeps the move and marks orphaned_node
- [ ] Rejects cycle: throws when newParentNodeId is a descendant of nodeId
- [ ] Ownership transfer (D6): a non-admin mover that owns the node and moves it OUTSIDE the mover's home subtree has its explicit rows on the moved subtree revoked via revokeUserSubtreePermissions (root + descendants); the mover's home-root ADMIN row is preserved
- [ ] Non-transfer: moving within the mover's own home, or moving a node the mover merely received a grant on (does not own it), does NOT revoke any rows
- [ ] Admin mover: ownership detection and revocation are skipped entirely

#### deleteNode

- [ ] Trashes (soft-deletes) the subtree: every row of node + descendants is marked `deleted_at` via markSubtreeDeleted; no file_nodes/object_map row is removed and `fileNodeService.deleteNode` is never called
- [ ] `deletedCount` keeps the subtree-count semantics (descendants + 1)
- [ ] Enumerates all descendants for directory nodes via getDescendantIds (closure table, unfiltered)
- [ ] WebDAV mode: exactly ONE remote MOVE per subtree root — `moveBlob(displayPath, '/.wea-trash/<nodeId>')`; S3 mode: zero blobStorageService/blobStore calls
- [ ] WebDAV MOVE failure marks the subtree root `orphaned_node`, leaves `deleted_at` unset (trash aborted) and re-throws the original error
- [ ] WebDAV pre-existing `/.wea-trash/<nodeId>` destination (legacy `.wea-*` node) fails with the clear `trashTargetExists` conflict error before any marking; the node stays live
- [ ] Admin bypass: skips the permission check and trashes through the same pipeline
- [ ] Permission rows / share links / recent-file rows survive the trash (hidden at read instead — see `fileNodesStore.md` §2.4)

#### copyFile — S3 mode

- [ ] Zero-copy: new file_node + object_map referencing same s3_key when source blob exclusively owned (count=1)
- [ ] Duplicates blob via duplicateBlob when source s3_key is shared by multiple nodes (count>1)
- [ ] Copied node ends `sync_status='active'` (`updateSyncStatus(copiedNodeId, 'active')` after the blob link) — a copy is never left on the `pending_upload` default, so it stays enumerable by s3→webdav migration snapshots
- [ ] Copied node gets a filecache row mirroring the source (`getCache(source)` → `upsertCache(copied, size, mime, null)`); source without a cache row → no cache write, no crash
- [ ] Checks read permission on source and write permission on destination parent before proceeding

#### copyFile — WebDAV mode

- [ ] Creates the copy node, then one native `blobStore.copyBlob(sourcePath, copyPath)` (server-side COPY, `Depth: infinity` — directory subtrees included); no download/PUT round-trip through the app
- [ ] File sources mirror listing metadata via `headBlob(copyPath)` + `upsertCache(copiedNodeId, ...)`; directory sources write no cache row
- [ ] Rolls back the copied node (deleteNode) if the COPY fails, re-throws error

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

| Value            | Meaning                                                                                                                                                                             | Set When                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `active`         | Database metadata and storage content are in sync. Node is fully usable.                                                                                                            | S3-mode end state: set by `uploadService` TX2 (`completeUpload` + `updateSyncStatus(nodeId, 'active')`) after new-file uploads and overwrites, and by `copyFile` (S3) immediately after the blob is linked. WebDAV mode never sets `active` on a normal path (native nodes stay `pending_upload`); `active` appears there only via webdav→s3 migration and manual `repair-sync force-active`. rename/move never write it — a node keeps its existing value (S3 renames/moves leave an already-`active` node untouched).                                                                                                                                                                                                                                                                                                                                             |
| `pending_upload` | Node exists in DB but blob content has not been written to storage yet (S3). The repository `createNode` default in both modes.                                                     | INSERTed by `createNode` for **every** new row (file or directory, S3 or WebDAV; the DDL `'active'` default is always overridden). In **S3 mode** it is the intermediate state of the upload flow: `prepareUpload` marks the object_map `pending` and TX2 flips both node and object_map to `active`; a failed NEW-file upload rolls the row back (`uploadService.md` §2.5); a failed S3 OVERWRITE rolls back to the pre-state (node `active`, previous version downloadable), leaving `pending_upload` only if the rollback itself fails (scan/repair + GC cleanup — `docs/IMPROVEMENT_PLAN.md`). In **WebDAV mode** nodes keep `pending_upload` for their whole lifetime under normal operation — the backend is path-addressed and only the `orphaned_node` boundary is operational, so the value is never read by listing/download/migration-enumeration there. |
| `orphaned_node`  | Database metadata and storage content are inconsistent. The node's DB row exists but the corresponding storage resource may be missing, at a wrong path, or in an unexpected state. | Set when a WebDAV storage failure leaves DB and remote inconsistent AND no restoration path exists: rename/move MOVE failure where the remote source was absent (nothing to roll back to) or the DB rollback itself failed, overwrite PUT failure whose last-good restore also failed, trash MOVE failure during deleteNode (root only), MKCOL failure during `blobStorageService.createDirectoryWebdav` (directory create / home-node ensure). rename/move/overwrite failures that DO restore (DB rollback / snapshot restore) never mark it. New nodes created for an upload/copy are rolled back instead of being marked. The error is always propagated to the caller — orphaned_node is a fail-safe marker for repair, not silent degradation.                                                                                                                                                                                     |

**Recovery of failure states:** a failed S3 overwrite rolls back automatically to the pre-state — the node returns to `active` and the previous version stays downloadable (`uploadService.md` §2.5). Only when the rollback itself fails (or a crash lands between TX1 and the blob write) does a stuck `pending_upload` residue remain; it is surfaced by the report-only startup scan and resolved by the admin repair actions `complete` / `restore-previous` / `delete` / `auto` (`POST /api/admin/maintenance/repair-sync`, S3 storage mode only — `uploadService.md` §2.5.1). The GC last-good guard protects the stuck node's last-good row from deletion while it is unrepaired — with DEF-11's managed history the last-good row is `history` (inherently safe; the orphaned-branch guard is kept defensively) — and stale pending-live rows + blobs are cleaned after `GC_PENDING_STALE_DAYS` (`gcService.md` §2). `orphaned_node` keeps the existing manual repair path — `failSafeService.scanOrphanedNodes()` / `POST /api/admin/maintenance/repair-sync` with `retry-delete` (best-effort remote subtree delete in WebDAV mode) or `force-active` (refuses with 409 when the remote file is missing). New-file upload failures need no recovery because the node is rolled back.

**Delete/restore interplay (DEF-11):** `versionsService.restoreVersion` never deletes — the
demoted current version always becomes `history` and row removal stays the repair channel's
(`repairPendingUploadNode`) / GC's job. `deleteNode` (DEF-16 P2) now TRASHES the subtree: rows and
their `object_map` versions (`active`/`history`/`orphaned`) all survive under `deleted_at` —
version history outlives the trash period and dies with the node only at permanent delete
(`fileNodeService.deleteNode` FK-cascade, used by the repair channel and the admin
perm-delete maintenance route; the WebDAV trash path is one remote MOVE to `/.wea-trash/<nodeId>`,
S3 mode performs no physical I/O).

**Trash WebDAV semantics (DEF-16 P2/P3):** the remote content of a trashed subtree lives under the
reserved hidden namespace `/.wea-trash/<nodeId>` (subtree ROOT's id). The historical bottom-up
per-node remote delete helper moved out of this service into `server/service/webdavRemoteOps.js`
(`deleteRemoteSubtreeBestEffort`) — it remains in use by the fail-safe `retry-delete` repair and the
admin permanent-delete route (both operate on live display paths); the trash channel's purge and
GC Tier 3 operate on the trash paths via the shared purge core in `server/service/trashService.js`.

---

## 4.1 Trash channel (DEF-16 P3) — `server/service/trashService.js`

The OS-recycle-bin semantics on top of the P2 soft-delete model. The service is a pure
composition-root service (`createTrashService({ fileNodesStore, fileNodeService, blobStore,
fileStorageMode, aclService })`); the routes (`domains/files/routes/trash.js`) call it and stay thin.
Permission rows, share links, closure rows and object_map rows survive the trash; they are removed
only by the purge core's hard delete (FK cascade at purge time).

### Name collision helper — `resolveRestoreName(parentId, name)`

Small in-service helper (NOT an extension of `conflictResolver`): checks **live siblings only**
(`fileNodesStore.getChildren` is a live-row read) and returns the first free name of the form
`name`, `name (2).ext`, `name (3).ext`, … The extension is everything from the LAST dot of `name`
(`path.extname` semantics — a leading-dot name like `.foo` has no extension and suffixes as
`.foo (2)`). Windows recycle-bin behavior: the restored item is RENAMED to the suffixed name; the
colliding live sibling is untouched.

### `restoreNode(userId, nodeId, user)` — restore from trash

OS-recycle-bin restore of one trashed item (target = any trashed row, including a nested one).

Gates (in order):

1. Node exists via `fileNodesStore.getNodeIncludingTrashed` → 404 `files.notFound` otherwise.
2. Node is trashed (`deleted_at` set) → 409 `files.notTrashed` otherwise.
3. Write permission on the target node (`aclService.checkFilePermission(userId, nodeId,
PERMISSIONS.WRITE)`, admin bypasses) → 403 `files.permissionDenied`.
4. Write permission on the first LIVE ancestor folder when it exists
   (`aclService.checkFolderPermission(userId, liveParentId, PERMISSIONS.WRITE)`) — move-dest
   precedent (the target is placed back under it) → 403. When the trashed chain reaches root level
   there is no live parent and this gate is skipped.

Semantics:

1. **Trashed-ancestor chain:** walk up from the target via `getNodeIncludingTrashed` while the
   parent row is trashed; the chain runs target-first up to (and including) the TOPMOST trashed
   ancestor whose parent is live-or-null. Siblings of each restored ancestor stay trashed.
2. **Restore order:** topmost trashed ancestor first (its parent is live), then each next-lower
   chain node, then the target — Windows-style path recreation.
3. **Name resolution at every restore boundary:** each chain node's name is resolved against the
   LIVE siblings of its (live-or-just-restored) parent via `resolveRestoreName`; names already
   restored in the same operation count as live for subsequent resolutions (two trashed siblings
   with the same name restore as `name` and `name (2).ext`).
4. **WebDAV mode — MOVE back:** per restored row, `blobStore.headBlob('/.wea-trash/<rowId>')`
   probes the row's own trash path. The topmost chain node's trash path holds the whole MOVE'd
   subtree (one `moveBlob` restores every covered row); rows individually trashed before their
   ancestor's trash carry their own `/.wea-trash/<id>` entries and are MOVE'd back individually to
   their resolved display paths. Remote I/O happens BEFORE the DB transaction; a MOVE failure
   aborts the restore with the rows still trashed (earlier successful MOVEs leave content at the
   still-trashed rows' display paths — the purge core's trash-path deletes handle that state).
   S3 mode: zero physical I/O (stable UUID keys).
5. **One DB transaction** for the whole restore: apply the collected renames, then
   `fileNodesStore.untrashSubtree(chain ∪ target subtree)` — clears `deleted_at` on the chain nodes
   AND every descendant of the target (restoring a folder brings its whole subtree back). One TX
   keeps the restore rollback-safe (partial remote moves are the only residue and are handled by
   purge; the DB state is all-or-nothing).
6. **Thumbnail cache:** evicted defensively for the target (`thumbnailService.invalidate`,
   best-effort — trash had no cache entry once the read gates hit, the eviction is cheap
   insurance for pre-gating rows).

**Returns:** `{ messageCode: files.trashRestored, nodeId, restoredNodes, finalPath }` —
`restoredNodes` = every row whose `deleted_at` was cleared (chain + target subtree, chain first);
`finalPath` = the target's post-restore display path (re-resolved from the DB, authoritative).

### `purgeTrashedNode(userId, nodeId, user)` — permanent delete of ONE trashed item

Gates: node exists (404 `files.notFound`), node is trashed (409 `files.notTrashed`), write
permission on the node (`checkFilePermission(userId, nodeId, PERMISSIONS.WRITE)` — the same
delete perm a hard-delete requires today, admin bypasses; ACL review 2026-09-10) → 403. Works on
trashed descendants whose ancestors are still trashed.

Physical removal (shared purge core, WebDAV mode):

1. `blobStore.deleteBlob('/.wea-trash/<nodeId>')` — the row's own trash path (best-effort;
   WebDAV collection DELETE is recursive, so the whole moved subtree goes at once).
2. When the row sits INSIDE a still-trashed ancestor R, additionally
   `blobStore.deleteBlob('/.wea-trash/<R>/<relative display path>')` — its content was covered by
   R's trash MOVE and lives under R's trash collection. Best-effort (a 404 on either candidate is
   ignored).
3. Known edge (DEF-18 class): content of a row whose own trash-path MOVE-back partially failed
   during a restore can remain at the display path — not purged here (a display-path delete could
   hit a live sibling occupying that path); such residues await the DEF-18 remote reconciliation.

S3 mode: `blobStore.deleteBlob(s3Key)` for EVERY `object_map` row of the subtree (active + history

- orphaned — version rows die WITH the trash; the FK cascade would remove the rows anyway, the
  blob deletes free the storage immediately), then the DB removal.

DB removal: `fileNodeService.deleteNode(nodeId)` — one TX: ancestor-closure cleanup +
`deleteNodeTree`; the FK cascade removes the subtree's object_map, filecache, permission,
share-link and recent-file rows **at purge time** (documented behavior change vs the trash state,
where those rows survive).

**Returns:** `{ messageCode: files.trashPurged, nodeId, purgedNodes, deletedBlobs }`.

### `emptyTrash()` — admin-only bulk purge

Purges EVERY topmost trashed node (`fileNodesStore.getTopmostTrashedNodes()` — rows whose parent
is live-or-null; children die with each root's subtree) through the same purge core, best-effort
per node (a failing node's error is collected and the loop continues). The route enforces
admin-only (403 for non-admin). FK-cascade revocation applies per node as above.

**Returns:** `{ purgedNodes, purgedBlobs, errors: [] }`.

### Shared purge core

`purgeNode(nodeId)` is the physical core (no permission gates — callers gate): trashed row →
trash-path remote cleanup; live row → display-path bottom-up remote cleanup
(`webdavRemoteOps.deleteRemoteSubtreeBestEffort`); S3 mode → eager per-row blob deletes for the
subtree; then `fileNodeService.deleteNode` + FK cascade. Consumers: the trash purge route, the
empty-trash route, GC Tier 3 and the admin permanent-delete maintenance route
(`POST /api/admin/maintenance/perm-delete` — E2E cleanup channel; in S3 mode its blob deletion is
now eager instead of GC-deferred).

---

## 5. Error Cases

| Scenario                                                                      | Storage Mode | Behavior                                                                                                                                                                                                                                                                 | HTTP Status (when mapped by route handler) |
| ----------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| User lacks required permission and is not admin                               | Both         | aclService check returns false → method throws permission denied error                                                                                                                                                                                                   | 403                                        |
| nodeId does not exist in file_nodes                                           | Both         | Method throws not-found error before any operation proceeds                                                                                                                                                                                                              | 404                                        |
| parentNodeId does not exist or is a file node                                 | Both         | uploadFile/listDirectoryWithPermissions throw not-found error                                                                                                                                                                                                            | 404                                        |
| S3 PUT fails during upload (network, storage full)                            | S3           | New file: TX1 committed then S3 write failed → node rolled back, nothing persisted; error propagated to caller. Overwrite: best-effort rollback to pre-state — node `active`, previous version downloadable; `pending_upload` remains only if the rollback itself fails. | 500                                        |
| WebDAV PUT fails during upload (connection refused, timeout, remote 4xx/5xx)  | WebDAV       | New file: node rolled back via deleteNode, original error re-thrown. Overwrite: previous bytes restored from the `/.wea-tmp/<nodeId>` snapshot and error re-thrown; `orphaned_node` only when the restore itself failed (or no snapshot existed).                                                                                          | 500                                        |
| WebDAV MOVE fails during rename/move (remote unavailable, path conflict)      | WebDAV       | DB rename/move rolled back to the pre-state and the error propagated (retry-safe, no partial state). Exceptions: remote source absent (404) or rollback failed → DB change kept, `orphaned_node` marked, error propagated.                                                                                                              | 500                                        |
| WebDAV trash MOVE fails                                                       | WebDAV       | Subtree root marked 'orphaned_node', `deleted_at` stays unset (trash aborted), original error re-thrown. Destination `/.wea-trash/<nodeId>` already exists → 409 `trashTargetExists` before any state change.                                                                                                                             | 500 / 409                                  |
| Name conflict on rename/copy                                                  | Both         | Conflict error thrown before any mutation                                                                                                                                                                                                                                | 409                                        |
| Cycle detected on moveNode                                                    | Both         | fileNodeService.moveNode rejects after getDescendantIds check; no DB mutation occurs                                                                                                                                                                                     | 400                                        |
| Empty newName or name with path separators on rename                          | Both         | Validation error thrown before any operation                                                                                                                                                                                                                             | 400                                        |

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
- [ ] Rolls back the new node (deleteNode) if WebDAV PUT fails after DB commit; then re-throws original error to caller
- [ ] Overwrite: COPY-snapshots the previous bytes to `/.wea-tmp/<nodeId>` first; PUT failure restores via moveBlob(overwrite:T) + re-throw; restore failure marks orphaned_node; snapshot removed on success

### downloadFile

- [ ] S3 mode: returns buffer via blobStorageService.downloadBlob following object_map → s3_key chain
- [ ] WebDAV mode: resolves path from nodeId via fileNodeService.getNodePath, retrieves buffer through webdav GET
- [ ] Throws notFoundError when no active object_map entry or storage resource exists (route maps to 404)
- [ ] Throws 403 if non-admin user lacks read permission on target file node

### renameNode

- [ ] S3 mode: updates name in file_nodes DB only; zero blobStorageService calls
- [ ] WebDAV mode: old path captured before the DB rename; one native `blobStore.moveBlob(oldPath, newPath)` after it; failure → DB rename rolled back + error propagated (orphaned_node only when the remote source was absent or the rollback failed)
- [ ] Throws validation error for empty newName or names containing `/` or `\`
- [ ] Throws conflict error if new name duplicates existing sibling under same parent (UNIQUE constraint violation from DB)

### moveNode

- [ ] Updates parent_id and rebuilds closure table via fileNodeService.moveNode in TX
- [ ] S3 mode: no storage operation invoked (blob key decoupled from tree position)
- [ ] WebDAV mode: old path/parent captured before the DB move; one native `blobStore.moveBlob(oldPath, newPath)` after it; failure → DB move rolled back + error propagated, D6 cleanup skipped (orphaned_node only when the remote source was absent or the rollback failed)
- [ ] Rejects cycle: throws when newParentNodeId is a descendant of nodeId
- [ ] Ownership transfer (D6): non-admin mover that owned the node moves it into another user's home subtree → mover's rows on the moved subtree are revoked (both tables, root included); shared listing no longer surfaces it
- [ ] Received grant preserved: a mover that does NOT own the node (merely received a grant) moving it within the owning user's home keeps its grant row intact
- [ ] Within-own-home move: no rows revoked
- [ ] Admin mover: no ownership detection, no revocation

### deleteNode

- [ ] Trashes the subtree (soft delete — DEF-16 P2): getDescendantIds enumeration, one `markSubtreeDeleted` over node + descendants; no row removed, `fileNodeService.deleteNode` never called
- [ ] WebDAV mode: exactly ONE remote MOVE per subtree root — `moveBlob(displayPath, '/.wea-trash/<nodeId>')`; MOVE failure marks the root `orphaned_node`, leaves `deleted_at` unset and re-throws
- [ ] S3 mode: zero physical I/O (stable UUID keys; blobs die at Tier 3 GC purge only)

### copyFile — S3 mode

- [ ] Zero-copy when source blob exclusively owned (countActiveObjectsByS3Key === 1): new file_node + object_map row referencing same s3_key with status='active'
- [ ] Duplicates blob via duplicateBlob when source s3_key shared by multiple nodes: downloads, re-uploads under new key, links copy to new key
- [ ] Ends the copied node at `sync_status='active'` via updateSyncStatus after the link (never left `pending_upload`)
- [ ] Mirrors the source filecache row onto the copied node (`getCache` → `upsertCache(copiedNodeId, size, mimeType, null)`) so the copy lists a real size instead of 0
- [ ] Checks read permission on source node and write permission on destination parent before proceeding

### copyFile — WebDAV mode

- [ ] Creates the copy node, then one native `blobStore.copyBlob(sourcePath, copyPath)` (Depth:infinity — subtrees copy server-side); file sources mirror listing metadata via `headBlob` + `upsertCache`; directory sources write no cache row
- [ ] Rolls back the copied node (deleteNode) if copyBlob fails after file_node creation; re-throws error to caller
