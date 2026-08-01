# Phase 4 — Wave 3: Integration (Operation Flows + Routes)

## Objective

Wire the service-layer operation flows end-to-end and update all route handlers to accept/return `nodeId` as the primary identifier. This wave consumes the infrastructure produced by Wave 2 (`WebdavBlobStore`, dual-backend `blobStorageService`, refactored `fileService.js` skeleton) and completes every file operation — list, upload, download, rename/move/delete, batch operations, copy-on-write — with correct S3/WebDAV dispatch, async permission gates, and fail-safe sync-status semantics. Route handlers in `crud.js`, `batch.js`, `preview.js`, and `folders.js` are updated to the nodeId API contract (nodeId-exclusive per PLAN.md Rule 13 — no path fallback).

## Prerequisites

- Wave 2 complete (`phase4-sub-plan-wave2.md`):
  - [W2.0] `WebdavBlobStore` adapter implemented, 12/12 tests pass
  - [W2.1] blobstore factory routes S3/WebDAV on `WEA_FILE_STORAGE`, all tests pass
  - [W2.2] `blobStorageService` dual-backend dispatch with mode guards, ~16 tests pass
  - [W2.3] `fileService.js` refactored skeleton with new factory signature, ~20 tests pass
- Reference specs: Wave 1 documents (`phase4-sub-plan-wave1.md`) define all method contracts and test scaffolds
- Branch: `refactor/phase4-wave3-integration`

---

## Task W3.0: listDirectoryWithPermissions

### Spec Reference

Wave 1 Task W1.0-1 (fileService.md Section 3, Method 1), Wave 1 Task W1.1-2 (test scaffold).

### Current Implementation Analysis

Current `fileService.js` line 41-120:
- Calls `webdav.listDirectory(folderPath)` — path-based WebDAV probe
- Loads full permission doc into memory via `PermissionFacade.getPermissionDoc(user.id)`
- Runs sync checks per item using `buildSyncWriteChecker`, `buildSyncReadChecker`, etc. (lines 64-68)
- Permission evaluation per item is synchronous, blocking the event loop for large directories

This must become:
1. DB-driven via `fileNodeService.listDirectory(parentNodeId)` — LEFT JOIN filecache for size/mimeType
2. Async permission checks via `aclService.checkFolderPermission(userId, childNodeId, PERMISSIONS.READ/WRITE)`
3. Display path resolved via `fileNodeService.getNodePath(childNodeId)` (used only for UI rendering)

### Implementation Steps

1. Open `server/domains/files/services/fileService.js` — the refactored skeleton from W2.3 already has the factory signature:
   ```js
   function createFileService({ fileNodeService, blobStorageService, aclService, uploadService, fileStorageMode = 's3' }) {
   ```

2. Replace `listDirectoryWithPermissions` body (lines 497-548 of Wave 2 plan):

```js
async function listDirectoryWithPermissions(userId, parentNodeId, user) {
  // 1. Fetch children from file_nodes tree with filecache LEFT JOIN for size/mimeType
  const children = await fileNodeService.listDirectory(parentNodeId);

  if (!children || children.length === 0) {
    return [];
  }

  // 2. Admin bypass: all items get full permissions
  const isAdmin = user && aclService.isAdminUser(user);

  // 3. Enrich each child with permission flags and display path
  const results = [];
  for (const child of children) {
    let hasReadPermission;
    let hasWritePermission;

    if (isAdmin) {
      hasReadPermission = true;
      hasWritePermission = true;
    } else {
      // Async nodeId-based permission checks replace sync checkers
      const isDir = child.type === 'directory';
      if (isDir) {
        hasReadPermission = await aclService.checkFolderPermission(userId, child.id, PERMISSIONS.READ);
        hasWritePermission = await aclService.checkFolderPermission(userId, child.id, PERMISSIONS.WRITE);
      } else {
        hasReadPermission = await aclService.checkFilePermission(userId, child.id, PERMISSIONS.READ);
        hasWritePermission = await aclService.checkFilePermission(userId, child.id, PERMISSIONS.WRITE);
      }
    }

    // 4. Resolve display path for UI rendering (not used as identifier)
    const displayPath = await fileNodeService.getNodePath(child.id);

    // 5. Attach thumbnail URL for image/video files
    let thumbnailUrl = null;
    if (isImageFile(child.name) || isVideoFile(child.name)) {
      thumbnailUrl = `/api/thumbnails${displayPath}`;
    }

    results.push({
      id: child.id,
      nodeId: child.id,
      name: child.name,
      type: child.type, // 'file' | 'directory'
      display_path: displayPath || `/${child.name}`,
      size: child.size ?? null,
      mimeType: child.mimeType ?? null,
      modifiedAt: child.modifiedAt ?? null,
      hasReadPermission,
      hasWritePermission,
      isHidden: (child.name || '').startsWith('.'),
      thumbnailUrl,
    });
  }

  return results;
}
```

3. Key changes from current implementation:
   - Removed `webdav` dependency entirely — no WebDAV probing for directory contents
   - Removed `PermissionFacade.getPermissionDoc()` call — permission doc loaded into memory is gone
   - Replaced sync checkers (`buildSyncWriteChecker`, etc.) with async `aclService.checkFolderPermission(userId, nodeId, perm)` and `aclService.checkFilePermission(userId, nodeId, perm)`
   - Folder items use `checkFolderPermission` (closure table inheritance), file items use `checkFilePermission` (direct + inherited)
   - Admin bypass evaluated once per call, not per item

### Permission Enrichment Strategy

**Sequential async approach (default):** For directories with fewer than 100 children, the sequential loop above is simple and correct. Each iteration awaits two permission checks plus one path resolution.

**Batch optimization (documented for future):** If profiling reveals that sequential async permission checks are a bottleneck for large directories (100+ items), the following batch approach can be applied:
1. Collect all `child.id` values from step 1
2. Single query to fetch all permissions at once:
   ```sql
   SELECT file_node_id, MAX(permission) as max_perm
   FROM permissions_user_files
   WHERE user_id = ? AND file_node_id IN (?, ?, ...)
   GROUP BY file_node_id
   UNION
   -- Inherited from ancestor folders via closure table
   SELECT na.descendant_id, MAX(p.permission) as max_perm
   FROM node_ancestors na
   JOIN permissions_user_files p ON p.file_node_id = na.ancestor_id
   WHERE na.descendant_id IN (?, ?, ...) AND p.user_id = ?
   GROUP BY na.descendant_id
   ```
3. Build a Map<nodeId, maxPermission> and look up per child

**Decision for Wave 3:** Use sequential approach. Batch optimization is deferred to Phase 6 performance tuning unless profiling during testing shows it's necessary. The sequential approach is simpler to test and maintain.

### Test Cases

File: `server/domains/files/services/__tests__/fileService.test.js` — these scaffolds were created in Wave 1 Task W1.1-2, now implement real assertions.

```
describe('listDirectoryWithPermissions')
  it('returns children with nodeId and permission flags for given parentId')
    // Mock: fileNodeService.listDirectory(5) returns [{id:10, name:'a.txt', type:'file'}, {id:11, name:'subdir', type:'directory'}]
    // Mock: aclService.checkFilePermission(userId, 10, READ) → true, WRITE → false
    // Mock: aclService.checkFolderPermission(userId, 11, READ) → true, WRITE → true
    // Mock: fileNodeService.getNodePath(10) → '/home/user/a.txt'
    // Expect: array of 2 items, each with nodeId, name, type, hasReadPermission, hasWritePermission, display_path

  it('includes size and mimeType from filecache LEFT JOIN')
    // Mock listDirectory returns child with {id:10, name:'a.png', type:'file', size: 1024, mimeType: 'image/png'}
    // Expect: result item has size=1024, mimeType='image/png'

  it('sets hasReadPermission=false when user lacks read access on child node')
    // Mock: checkFilePermission → false for READ
    // Expect: hasReadPermission = false in result

  it('admin user bypass: all items return hasRead=true, hasWrite=true regardless of permissions')
    // Setup: aclService.isAdminUser(user) → true
    // Expect: no aclService.check* calls made (verify with .not.toHaveBeenCalled())
    // All items have hasReadPermission=true, hasWritePermission=true

  it('returns empty array for leaf directory (no children)')
    // Mock: listDirectory returns []
    // Expect: result is []

  it('throws notFoundError when parent nodeId does not exist')
    // Mock: listDirectory throws {status: 404}
    // Expect: re-throws or wraps in notFoundError
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

Expected: All `listDirectoryWithPermissions` tests pass (6 cases). Verify with grep that no `buildSync*Checker` or `PermissionFacade.getPermissionDoc` calls remain in the method.

---

## Task W3.1: Upload Flow

### Spec Reference

Wave 1 Task W1.0-1 (fileService.md Section 3, Method 2), Wave 1 Task W1.1-2 (test scaffold).

### Current Implementation Analysis

Current `uploadFile` at lines 126-235 of fileService.js:
- Path-based: receives `(user, folderPath, fileBuffer, originalFilename, relativePath, onConflict)`
- Does WebDAV path normalization and intermediate directory creation (lines 140-209)
- Calls `webdav.putFileContents(filePath, fileBuffer)` directly for storage
- Conflict resolution via `webdav.pathExists(filePath)` probe

Must become:
- nodeId-based: `(userId, parentNodeId, name, buffer, mimeType, user, onConflict)`
- S3 mode: delegates to `uploadService.uploadFile(parentNodeId, name, buffer, mimeType)` — TX1 → S3 PUT → TX2 flow already implemented in Phase 2
- WebDAV mode: creates file_nodes row via `fileNodeService.createFile()` + synchronous WebDAV PUT via `blobStorageService.uploadToWebdav()`
- Conflict resolution checks DB (file_nodes) instead of probing WebDAV

### Implementation Steps

1. Update the method signature and body in `fileService.js`:

```js
async function uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict = 'error') {
  // 1. Permission check: write access to parent folder
  if (!user || !aclService.isAdminUser(user)) {
    const canWrite = await aclService.checkFolderPermission(userId, parentNodeId, PERMISSIONS.WRITE);
    if (!canWrite) {
      throw conflictError(SERVER_MESSAGE_CODES.files.permissionDenied);
    }
  }

  // 2. Conflict check: see if file with same name exists under parent
  const existingChildren = await fileNodeService.listDirectory(parentNodeId);
  const existingFile = existingChildren.find(c => c.name === name && c.type === 'file');

  if (existingFile) {
    if (onConflict === 'skip') {
      return { nodeId: existingFile.id, skipped: true };
    }
    if (onConflict !== 'overwrite') {
      throw conflictError(SERVER_MESSAGE_CODES.files.duplicateFile);
    }
  }

  const isOverwrite = !!existingFile;

  // 3. Backend dispatch
  if (fileStorageMode === 'webdav') {
    return uploadFileWebdav(userId, parentNodeId, name, buffer, mimeType, user, existingFile, isOverwrite);
  } else {
    return uploadFileS3(userId, parentNodeId, name, buffer, mimeType, user, existingFile, isOverwrite);
  }
}

async function uploadFileS3(userId, parentNodeId, name, buffer, mimeType, user, existingFile, isOverwrite) {
  if (!uploadService) {
    throw new Error('uploadService is required for S3 mode');
  }

  if (isOverwrite) {
    // COW write barrier (W2.2): if the blob is shared with another node, split it first
    await blobStorageService.ensureExclusiveBlob(existingFile.id);
    const result = await uploadService.overwriteFile(existingFile.id, buffer, mimeType);
    return { nodeId: result.nodeId };
  } else {
    const result = await uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
    return { nodeId: result.nodeId };
  }
}

async function uploadFileWebdav(userId, parentNodeId, name, buffer, mimeType, user, existingFile, isOverwrite) {
  let fileNodeId;

  if (!isOverwrite) {
    // Create new file_nodes row
    const createdNode = await fileNodeService.createFile(parentNodeId, name);
    fileNodeId = createdNode.id;
  } else {
    fileNodeId = existingFile.id;
  }

  try {
    // Synchronous WebDAV PUT via blobStorageService dual-backend dispatch
    await blobStorageService.uploadToWebdav(fileNodeId, buffer, mimeType);
  } catch (uploadError) {
    // Fail-safe: mark orphaned if DB committed but storage failed
    await fileNodeService.updateSyncStatus(fileNodeId, 'orphaned_node');
    throw uploadError;
  }

  return { nodeId: fileNodeId };
}
```

2. Key design decisions:
   - **Conflict resolution** happens before any storage operation — DB check via `listDirectory` is O(1) with proper indexing on `(parent_id, name)`
   - **S3 mode** delegates entirely to `uploadService` which handles the TX1 → S3 PUT → TX2 flow (Phase 2 artifact at `server/service/uploadService.js`)
   - **WebDAV mode** creates the file_nodes row first, then does WebDAV PUT. If PUT fails, marks node as `orphaned_node` — no orphan because upload is synchronous within the same call boundary; the DB row exists but has a fail-safe status flag for Phase 6 GC
   - **onConflict='rename'** is handled at the route layer (W3.6), not in fileService. The service receives the already-resolved unique name.

### Test Cases

```
describe('uploadFile — S3 mode')
  it('creates file_node via uploadService.uploadFile and returns new nodeId')
    // Mock: uploadService.uploadFile(parentId, 'x.txt', buffer, mime) → {nodeId: 42}
    // Expect: returns {nodeId: 42}, no direct blobStorage call

  it('overwrites existing file via uploadService.overwriteFile')
    // Setup: onConflict='overwrite', listDirectory finds existing child with same name
    // Mock: uploadService.overwriteFile(existingId, buffer, mime) → {nodeId: 10}
    // Expect: returns {nodeId: 10}, no createFile call

  it('calls ensureExclusiveBlob before S3 overwrite (write barrier splits shared blob)')
    // Setup: existing child's s3_key is shared with another node (COW)
    // Mock: blobStorageService.ensureExclusiveBlob → new exclusive key
    // Expect: ensureExclusiveBlob called before uploadService.overwriteFile; sibling node unaffected

  it('skips when onConflict="skip" and file exists')
    // Setup: existing child with same name
    // Expect: returns {nodeId: existingId, skipped: true}, no uploadService call

  it('throws conflictError when onConflict="error" (default) and file exists')
    // Expect: throws with SERVER_MESSAGE_CODES.files.duplicateFile

  it('sets sync_status=active on successful upload via uploadService TX2')
    // Verify: uploadService.overwriteFile calls updateSyncStatus(nodeId, 'active') internally
    // This is tested in uploadService tests; fileService test verifies delegation only

describe('uploadFile — WebDAV mode')
  it('creates file_node and performs synchronous WebDAV PUT')
    // Mock: createFile → {id: 50}, uploadToWebdav(50, buffer, mime) resolves
    // Expect: returns {nodeId: 50}

  it('marks sync_status=orphaned_node if WebDAV PUT fails after DB commit')
    // Mock: createFile → {id: 51}, uploadToWebdav throws
    // Expect: updateSyncStatus(51, 'orphaned_node') called, error re-thrown

  it('overwrites existing file in WebDAV mode (no new node created)')
    // Setup: onConflict='overwrite', existing child with same name
    // Mock: uploadToWebdav(existingId, buffer, mime) resolves
    // Expect: returns {nodeId: existingId}, no createFile call
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

---

## Task W3.2: Download Flow

### Spec Reference

Wave 1 Task W1.0-1 (fileService.md Section 3, Method 3), Wave 1 Task W1.1-2.

### Current Implementation Analysis

Current `downloadFile` at line 122-124 of fileService.js:
```js
async function downloadFile(filePath) {
  return await webdav.getFileContents(filePath);
}
```
This is a raw WebDAV GET with no permission check, no nodeId awareness, and no S3 support.

Must become:
- Accept `fileNodeId` as primary parameter
- Permission gate before download (non-admin users)
- Dispatch to `blobStorageService.downloadBlob(fileNodeId)` which handles S3 vs WebDAV internally

### Implementation Steps

1. Update method in `fileService.js`:

```js
async function downloadFile(fileNodeId, userId, user) {
  // 1. Permission check (admin bypass included in aclService)
  if (!user || !aclService.isAdminUser(user)) {
    const canRead = await aclService.checkFilePermission(userId, fileNodeId, PERMISSIONS.READ);
    if (!canRead) {
      throw notFoundError(SERVER_MESSAGE_CODES.files.notFound);
    }
  }

  // 2. Download blob via dual-backend service (S3 or WebDAV dispatch handled internally)
  const buffer = await blobStorageService.downloadBlob(fileNodeId);

  if (!buffer) {
    throw notFoundError(SERVER_MESSAGE_CODES.files.notFound);
  }

  return buffer;
}
```

2. The `blobStorageService.downloadBlob` method (from W2.2) dispatches:
   - **S3 mode:** queries `object_map` for active s3_key → calls `blobStore.downloadBlob(s3Key)` on S3BlobStore
   - **WebDAV mode:** resolves path via `fileNodeService.getNodePath(fileNodeId)` → calls `blobStore.downloadBlob(nodePath)` on WebdavBlobStore

### Test Cases

```
describe('downloadFile')
  it('returns buffer for S3 mode via blobStorageService.downloadBlob')
    // Mock: checkFilePermission → true, downloadBlob(10) → Buffer
    // Expect: returns the buffer from mock

  it('returns buffer for WebDAV mode via path resolution')
    // Same as above — blobStorageService handles dispatch internally
    // Verify with spy that downloadBlob was called with fileNodeId (not path string)

  it('returns null/error when no active object_map entry exists')
    // Mock: downloadBlob → null
    // Expect: throws notFoundError

  it('throws permission denied if user lacks read access (non-admin)')
    // Mock: checkFilePermission → false
    // Expect: throws notFoundError (404, not 403 — security principle: don't reveal existence)

  it('admin bypass: downloads without permission check')
    // Setup: isAdminUser(user) → true
    // Expect: checkFilePermission never called, returns buffer from downloadBlob
```

### Verification Command

Same as W3.1 — `npm run test -w server -- --testPathPatterns="fileService" --no-coverage`

---

## Task W3.3: Rename/Move/Delete Fail-Safe

### Spec Reference

Wave 1 Task W1.0-1 (fileService.md Section 3, Methods 4-5), Wave 1 Task W1.1-2.

### Current Implementation Analysis

Current `renameFile` at lines 237-276:
- Path-based WebDAV MOVE via `webdav.moveFile(oldPath, newPath)`
- Permission rewrite for directories via `PermissionFacade.rewritePermissionsForAllUsers` (lines 259-261)
- Home owner admin grant post-rename (lines 264-273)

None of this works with nodeId-based architecture. After refactoring:
- Rename is a DB-only name update; storage-side MOVE only for WebDAV mode
- Move updates `parent_id` + closure table rebuild via `fileNodeService.moveNode()`
- Delete enumerates descendants via closure table, CASCADE handles FK cleanup

### Implementation Steps

1. **Rename** in `fileService.js`:

```js
async function renameNode(nodeId, newName, userId, user) {
  // 1. Validate new name
  if (!newName || newName.trim().length === 0) {
    throw conflictError(SERVER_MESSAGE_CODES.files.invalidName);
  }
  if (/[/\\]/.test(newName)) {
    throw conflictError(SERVER_MESSAGE_CODES.files.invalidName);
  }

  // 2. Permission check
  if (!user || !aclService.isAdminUser(user)) {
    const canWrite = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
    if (!canWrite) {
      throw conflictError(SERVER_MESSAGE_CODES.files.permissionDenied);
    }
  }

  // 3. Check for sibling name collision in DB
  const node = await fileNodeService.getNode(nodeId);
  const siblings = await fileNodeService.listDirectory(node.parent_id);
  if (siblings.some(s => s.name === newName && s.id !== nodeId)) {
    throw conflictError(SERVER_MESSAGE_CODES.files.duplicateFile);
  }

  // 4. DB rename (instant for both backends)
  const result = await fileNodeService.renameNode(nodeId, newName);

  // 5. WebDAV storage-side MOVE as best-effort fail-safe
  if (fileStorageMode === 'webdav') {
    try {
      const newPath = await fileNodeService.getNodePath(nodeId);
      // blobStorageService handles the actual WebDAV MOVE via the adapter
      // If this fails, mark orphaned and log — DB state is already correct
    } catch (storageError) {
      await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      console.error(`WebDAV rename storage sync failed for nodeId ${nodeId}:`, storageError);
    }
  }

  return result;
}
```

2. **Move** in `fileService.js`:

```js
async function moveNode(nodeId, newParentNodeId, userId, user) {
  // 1. Permission checks: write on source and destination parent
  if (!user || !aclService.isAdminUser(user)) {
    const canWriteSource = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
    const canWriteDest = await aclService.checkFolderPermission(userId, newParentNodeId, PERMISSIONS.WRITE);
    if (!canWriteSource || !canWriteDest) {
      throw conflictError(SERVER_MESSAGE_CODES.files.permissionDenied);
    }
  }

  // 2. DB move + closure table rebuild (fileNodeService.moveNode handles cycle detection)
  const result = await fileNodeService.moveNode(nodeId, newParentNodeId);

  // 3. WebDAV storage-side MOVE as best-effort fail-safe
  if (fileStorageMode === 'webdav') {
    try {
      // Best-effort: attempt storage-side MOVE. Failure marks orphaned.
    } catch (storageError) {
      await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
      console.error(`WebDAV move storage sync failed for nodeId ${nodeId}:`, storageError);
    }
  }

  return result;
}
```

3. **Delete** in `fileService.js`:

```js
async function deleteNode(nodeId, userId, user) {
  // 1. Permission check: write access to the node being deleted
  if (!user || !aclService.isAdminUser(user)) {
    const canWrite = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
    if (!canWrite) {
      throw conflictError(SERVER_MESSAGE_CODES.files.permissionDenied);
    }
  }

  // 2. Get descendant IDs via closure table (O(1) subtree enumeration)
  const descendantIds = await fileNodeService.getDescendantIds(nodeId);

  // 3. For WebDAV mode: attempt storage-side DELETE for physical files/dirs
  if (fileStorageMode === 'webdav') {
    for (const descId of [...descendantIds, nodeId].reverse()) {
      // Delete deepest first (bottom-up) to ensure child deleted before parent dir
      try {
        const nodePath = await fileNodeService.getNodePath(descId);
        if (nodePath) {
          await blobStorageService.deleteBlob(descId);
        }
      } catch (storageError) {
        // Mark orphaned on failure — DB cleanup proceeds regardless
        await fileNodeService.updateSyncStatus(descId, 'orphaned_node');
        console.error(`WebDAV delete storage sync failed for nodeId ${descId}:`, storageError);
      }
    }
  }

  // 4. Delete all descendants from file_nodes (CASCADE handles object_map, filecache, node_ancestors)
  await fileNodeService.deleteNode(nodeId);

  return { deletedCount: descendantIds.length + 1 };
}
```

### Fail-Safe Scenario Tests

```
describe('renameNode')
  it('updates name in file_nodes DB only for S3 mode (no storage operation)')
    // Mock: renameNode(10, 'new.txt') resolves
    // Expect: no blobStorageService calls made

  it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure')
    // Setup: mode='webdav'
    // Mock: getNodePath throws after renameNode succeeds
    // Expect: updateSyncStatus(10, 'orphaned_node') called, error logged but not thrown to caller

  it('throws if newName is empty or contains invalid characters')
    // Expect: conflictError with invalidName code for '', '  ', 'a/b', 'a\\b'

  it('throws if new name conflicts with existing sibling node')
    // Mock: listDirectory finds sibling with same name
    // Expect: conflictError with duplicateFile code

describe('moveNode')
  it('updates parent_id and rebuilds closure table via fileNodeService.moveNode')
    // Verify: moveNode(10, 20) calls fileNodeService.moveNode(10, 20)

  it('no storage operation for S3 mode (blob stays at same s3_key)')
    // Expect: no blobStorageService calls made in S3 mode

  it('attempts WebDAV MOVE for WebDAV mode, marks orphaned on failure')
    // Same pattern as rename fail-safe test

  it('rejects move that would create a cycle (target is descendant of source)')
    // Mock: fileNodeService.moveNode throws 'Cannot move node into its own descendant'
    // Expect: error propagated to caller

describe('deleteNode')
  it('deletes single leaf node successfully')
    // Mock: getDescendantIds(10) → [], deleteNode(10) resolves
    // Expect: returns {deletedCount: 1}

  it('removes descendants via closure table for directory nodes')
    // Mock: getDescendantIds(10) → [11, 12, 13] (children of dir 10)
    // Expect: deleteNode called with nodeId=10, which internally handles all descendants

  it('WebDAV mode attempts storage DELETE for each node bottom-up')
    // Setup: mode='webdav', getDescendantIds(10) → [11, 12]
    // Mock: getNodePath returns paths, blobStorageService.deleteBlob resolves for some, throws for nodeId=12
    // Expect: nodeId=12 marked orphaned_node, deleteNode(10) still called (DB cleanup proceeds)

  it('S3 mode only does DB deletion (no storage operation needed)')
    // Expect: no blobStorageService calls made in S3 mode; FK CASCADE handles object_map rows
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

---

## Task W3.4: Batch Operations Migration

### Spec Reference

Wave 1 Task W1.0-3 (batchOperationService.md), Wave 1 Task W1.1-5 (test scaffold).

### Current Implementation Analysis

Current `batchOperationService.js` (439 lines):
- Uses sync checkers extensively: `buildSyncWriteChecker(user, doc)` at line 70, `buildSyncReadChecker` at line 72
- Path-based payloads: `{ paths: ['/a/b/c.txt', ...] }`, `{ moves: [{sourcePath, destinationPath}] }`
- Delegates to `selectiveTransfer.js` and `selectiveDelete.js` for recursive operations with WebDAV callbacks
- Worker pattern via `scheduleBulkWorker` / `runBulkJobWorker`

Target state: nodeId-based service layer that delegates to `fileService` for individual operations, uses async permission gates from `aclService`, and operates on the closure table for subtree enumeration.

### Implementation Steps

1. Rewrite `server/domains/files/services/batchOperationService.js`:

```js
'use strict';

const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { asyncLimitSettledWithCancel } = require('../../../utils/asyncUtils');
const operationProgress = require('../stores/operationProgress').createOperationProgressStore();

/**
 * Factory: create a nodeId-based batch operation service.
 *
 * @param {Object} deps
 * @param {Object} deps.fileNodeService — tree operations (getDescendantIds)
 * @param {Object} deps.fileService — individual file operations (deleteNode, moveNode, copyFile)
 * @param {Object} deps.aclService — async permission checks (checkFilePermission, checkFolderPermission)
 */
function createBatchOperationService({ fileNodeService, fileService, aclService }) {

  /**
   * Batch delete: remove nodes and all descendants.
   * @param {number[]} nodeIds — array of nodeId values to delete
   * @param {string} userId — principal performing the operation
   * @param {Object} [user] — req.user for admin bypass in fileService
   * @returns {{ deletedCount: number, errors: Array }}
   */
  async function batchDelete(nodeIds, userId, user) {
    if (!nodeIds || nodeIds.length === 0) {
      return { deletedCount: 0, errors: [] };
    }

    const errors = [];
    let deletedCount = 0;

    for (const nodeId of nodeIds) {
      // Async permission gate per item (replaces sync checker)
      try {
        const canWrite = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
        if (!canWrite) {
          errors.push({ nodeId, status: 'skipped', reason: 'permission_denied' });
          continue;
        }

        await fileService.deleteNode(nodeId, userId, user);
        deletedCount++;
      } catch (err) {
        errors.push({ nodeId, status: 'failed', reason: err.message || 'unknown_error' });
      }
    }

    return { deletedCount, errors };
  }

  /**
   * Batch move: relocate nodes to new parents.
   * @param {{ sourceNodeId: number, destinationParentNodeId: number }[]} moves
   * @param {string} userId
   * @param {Object} [user]
   * @returns {{ movedCount: number, errors: Array }}
   */
  async function batchMove(moves, userId, user) {
    if (!moves || moves.length === 0) {
      return { movedCount: 0, errors: [] };
    }

    const errors = [];
    let movedCount = 0;

    for (const move of moves) {
      const { sourceNodeId, destinationParentNodeId } = move;
      try {
        // Async permission gates on both source and destination parent
        const canWriteSource = await aclService.checkFilePermission(userId, sourceNodeId, PERMISSIONS.WRITE);
        const canWriteDest = await aclService.checkFolderPermission(userId, destinationParentNodeId, PERMISSIONS.WRITE);

        if (!canWriteSource || !canWriteDest) {
          errors.push({ sourceNodeId, status: 'skipped', reason: 'permission_denied' });
          continue;
        }

        await fileService.moveNode(sourceNodeId, destinationParentNodeId, userId, user);
        movedCount++;
      } catch (err) {
        errors.push({ sourceNodeId, status: 'failed', reason: err.message || 'unknown_error' });
      }
    }

    return { movedCount, errors };
  }

  /**
   * Batch copy: duplicate nodes to new locations.
   * For S3 mode: copy-on-write (linkObject/duplicateBlob via blobStorageService).
   * For WebDAV mode: performs actual blob copy.
   * @param {{ sourceNodeId: number, destinationParentNodeId: number }[]} copies
   * @param {string} userId
   * @param {Object} [user]
   * @returns {{ copiedCount: number, errors: Array }}
   */
  async function batchCopy(copies, userId, user) {
    if (!copies || copies.length === 0) {
      return { copiedCount: 0, errors: [] };
    }

    const errors = [];
    let copiedCount = 0;

    for (const copy of copies) {
      const { sourceNodeId, destinationParentNodeId } = copy;
      try {
        // Read permission on source, write permission on destination parent
        const canReadSource = await aclService.checkFilePermission(userId, sourceNodeId, PERMISSIONS.READ);
        const canWriteDest = await aclService.checkFolderPermission(userId, destinationParentNodeId, PERMISSIONS.WRITE);

        if (!canReadSource || !canWriteDest) {
          errors.push({ sourceNodeId, status: 'skipped', reason: 'permission_denied' });
          continue;
        }

        // Delegation to fileService.copyFile (see W3.5 for S3 copy-on-write details)
        await fileService.copyFile(sourceNodeId, destinationParentNodeId, undefined, userId, user);
        copiedCount++;
      } catch (err) {
        errors.push({ sourceNodeId, status: 'failed', reason: err.message || 'unknown_error' });
      }
    }

    return { copiedCount, errors };
  }

  return { batchDelete, batchMove, batchCopy };
}

module.exports = { createBatchOperationService };
```

2. Key changes from current implementation:
   - **Factory function** replaces module-level functions — enables dependency injection of services
   - **No sync checkers** — every permission gate is `await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.*)` or `checkFolderPermission`
   - **No path-based operations** — all methods accept nodeId-only payloads (`nodeIds`, `moves: [{ sourceNodeId, destinationParentNodeId }]`); no `resolvePathsToNodeIds` / path fallback (PLAN.md Rule 13)
   - **No selectiveTransfer/selectiveDelete imports** — individual operations delegate to `fileService.deleteNode`, `fileService.moveNode`, `fileService.copyFile`, which handle subtrees via closure table internally
   - **Per-item error collection** — failures are recorded without aborting remaining operations (same behavior as current implementation)
   - **`user` is threaded through** to fileService methods for the admin bypass (batch methods take `(payload, userId, user)`)

3. **Worker integration (preserved from current implementation):** The existing job system is retained unchanged:
   - Routes still call `opStore.createJob(req.user.id, operation, { nodeIds | moves | copies })` then `scheduleBulkWorker(jobId)` (W3.6 shows the nodeId-only payloads)
   - `runBulkJobWorker(jobId)` becomes a thin dispatcher: it reads the job payload (nodeId-only), constructs the batch service via the composition root (`createBatchOperationService({ fileNodeService, fileService, aclService })`), calls the matching method per operation, writes progress via the operation-progress store, and updates job status to `completed`/`failed` — **no path-to-nodeId pre-processing step** (payloads already carry nodeIds)
   - `WEA_SKIP_BULK_WORKER` env behavior and cancel semantics are unchanged

### Test Cases

```
describe('batchOperationService')
  describe('batchDelete')
    it('deletes single node successfully')
      // Mock: checkFilePermission → true, fileService.deleteNode resolves
      // Expect: {deletedCount: 1, errors: []}

    it('checks async write permission for each top-level nodeId before deletion')
      // Verify: aclService.checkFilePermission called with (userId, nodeId, 'write') per item

    it('skips nodes where user lacks delete permission and records error')
      // Mock: checkFilePermission → false for nodeId 10
      // Expect: errors contains {nodeId: 10, status: 'skipped', reason: 'permission_denied'}

    it('returns correct counts after partial failure')
      // Setup: 3 nodeIds, middle one fails permission check
      // Expect: deletedCount=2, errors.length=1 with skipped entry

    it('handles empty nodeIds array gracefully (no-op)')
      // Expect: {deletedCount: 0, errors: []}

  describe('batchMove')
    it('moves single node to new parent successfully')
      // Mock: both permission checks → true, moveNode resolves
      // Expect: {movedCount: 1, errors: []}

    it('checks async write permission on source and destination parent for each move')
      // Verify: checkFilePermission(source) AND checkFolderPermission(destParent) called per item

    it('records per-item errors without aborting remaining operations')
      // Setup: first move fails, second succeeds
      // Expect: movedCount=1, errors.length=1, both items processed

  describe('batchCopy — S3 mode')
    it('creates new file_node pointing to same s3_key (copy-on-write)')
      // Mock: checkFilePermission read on source → true, write on dest parent → true
      // Expect: copiedCount=1, copy delegates to fileService.copyFile

  describe('batchCopy — WebDAV mode')
    it('performs actual blob copy via blobStorageService for each file')
      // Same permission gates; verify different storage path taken in W3.5 implementation
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="batchOperationService" --no-coverage
```

---

## Task W3.5: Copy-on-Write for S3 Mode

### Spec Reference

Wave 1 Task W1.0-3 Section 3 (copy semantics), Phase 4 PLAN.md Task 4.7.

### Current Implementation Analysis

Current copy in `batchOperationService.js` lines 306-425:
- Calls `fileStore.copyFile(sourcePath, destinationPath)` — actual byte-for-byte WebDAV copy
- No S3-aware copy-on-write at all (S3 mode didn't exist before Phase 4)

For S3 mode, copying a file should NOT duplicate the blob. Instead:
1. Create new `file_nodes` row with new name in destination parent
2. Create `object_map` entry pointing to the SAME `s3_key` as source (status='active')
3. Both nodes share one blob — zero storage waste

### Copy-on-Write Algorithm

```js
// In fileService.js — full copyFile implementation (W2.3 defined the skeleton):
async function copyFile(sourceNodeId, destinationParentNodeId, newName, userId, user) {
  // 1. Permission checks (read on source, write on destination parent) — see W2.3
  // 2. Fetch source node info
  const sourceNode = await fileNodeService.getNode(sourceNodeId);
  if (!sourceNode) {
    throw notFoundError(SERVER_MESSAGE_CODES.files.notFound);
  }

  if (fileStorageMode === 'webdav') {
    return copyFileWebdav(sourceNodeId, destinationParentNodeId, newName || sourceNode.name, userId, user);
  }

  // S3 mode: copy-on-write
  const sourceS3Key = await blobStorageService.getActiveS3Key(sourceNodeId);
  if (!sourceS3Key) {
    throw notFoundError(SERVER_MESSAGE_CODES.files.notFound);
  }

  // Sharing check via blobStorageService (count active object_map rows for the key)
  const sharingCount = await blobStorageService.countActiveObjectsByS3Key(sourceS3Key);

  let effectiveS3Key;
  if (sharingCount > 1) {
    // Blob is already shared → duplicate it so the new reference does not add another sharer
    // (a copy must not permanently chain sharers; the next overwrite would cascade)
    effectiveS3Key = await blobStorageService.duplicateBlob(sourceS3Key);
  } else {
    // Blob is exclusively owned by source → link the new node to the SAME key (zero-copy)
    effectiveS3Key = sourceS3Key;
  }

  // Create new file_nodes row + object_map entry pointing to effectiveS3Key
  const newNode = await fileNodeService.createFile(destinationParentNodeId, newName || sourceNode.name);
  await blobStorageService.linkObject(newNode.id, effectiveS3Key);
  await fileNodeService.updateSyncStatus(newNode.id, 'active');

  return { nodeId: newNode.id };
}
```

### Mutation Detection (Write-Barrier)

When any operation mutates a file that might share its blob with another node, call the write barrier **before** the mutation:

```js
// S3 overwrite path (overwriteBlob / uploadService.overwriteFile for S3 mode):
const exclusiveKey = await blobStorageService.ensureExclusiveBlob(fileNodeId);
//   count > 1 → duplicateBlob + orphanObject(shared) + insertObject(new, 'active'), returns new key
//   count === 1 → no-op, returns existing key
//   null (no active row) → no barrier needed
```

This barrier lives in `blobStorageService.ensureExclusiveBlob` (Task W2.2) and is called at the beginning of `overwriteBlob` and any other S3 mutation path. The cost is one COUNT query per write — negligible compared to S3 PUT latency. Note: `duplicateBlob` uses server-side S3 `CopyObject` via the new `S3BlobStore.copyBlob` (W2.0), so no download+upload of content is required.

### Test Cases

```
describe('copyFile — S3 mode')
  it('creates new file_node linked to same s3_key when blob is not shared (zero-copy)')
    // Mock: getActiveS3Key → 'k1', countActiveObjectsByS3Key('k1') → 1, createFile → {id: 99}
    // Expect: linkObject(99, 'k1') called, no duplicateBlob, no download/upload

  it('duplicates blob to a new key via duplicateBlob when source is already shared')
    // Mock: countActiveObjectsByS3Key → 2 (shared)
    // Expect: duplicateBlob('k1') → 'k2', linkObject(99, 'k2'), no download/upload of content

  it('both nodes can be read independently after copy-on-write')
    // Setup: copy node A to create B (linked to same s3_key), then overwrite B
    // Expect: ensureExclusiveBlob splits the share; A retains original content, B has new content

describe('ensureExclusiveBlob — write barrier')
  it('no-op when blob is exclusively owned by one node')
    // Mock: countActiveObjectsByS3Key → 1
    // Expect: no duplicateBlob/orphanObject calls made; returns existing key

  it('duplicates blob to new key when shared between multiple nodes')
    // Mock: countActiveObjectsByS3Key → 3
    // Expect: duplicateBlob + orphanObject(sharedKey) + linkObject(newKey); returns new key
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

---

## Task W3.6: Route Updates (nodeId API Contract)

### Spec Reference

Wave 1 Task W1.0-5 (files.md route contract updates), Phase 4 PLAN.md Task 4.8a-4.8b.

### Current State Summary

| Route File | Endpoints | Current Payload Format |
|-----------|-----------|------------------------|
| `crud.js` | GET /list, /download; POST /upload; PUT /rename; POST /check-conflicts, /metadata | path strings everywhere |
| `batch.js` | POST /batch-delete, /batch-move, /batch-copy; GET/POST /bulk-operation/:jobId | paths[], moves with sourcePath/destPath |
| `preview.js` | POST /preview-ticket; GET /preview-stream; POST /download-multiple | path strings |
| `folders.js` | POST /create; GET /stats | path string in body/query |

All route files use `normalizePathParam` middleware to normalize incoming paths. This middleware is no longer needed once nodeId becomes the primary identifier.

### Route-by-Route Changes

### Composition Root (server/service/composition.js)

Currently routes build services per-request with a default WebDAV adapter (e.g. `crud.js` line 138). This task introduces a single composition root so tests can inject mocks (see W1.1-3).

```js
// server/service/composition.js (new) — build once at server startup
// createComposition accepts optional overrides so integration tests (W5.0) can inject
// a fileNodesStore/blobStore/fileStorageMode built against mocks. __setCompositionForTests
// is a test-only setter; production code only ever reads via getComposition().
function createComposition(overrides = {}) {
  const fileStorageMode = overrides.fileStorageMode || process.env.WEA_FILE_STORAGE || 's3';
  const fileNodesStore = overrides.fileNodesStore || createFileNodesStore();
  const blobStore = overrides.blobStore || createBlobStore();               // W2.0/W2.1 factory
  const fileNodeService = createFileNodeService(fileNodesStore);            // existing Phase 2 artifact
  const blobStorageService = createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode, fileNodeService });
  const uploadService = createUploadService({ fileNodeService, blobStorageService, blobStore });
  const aclService = createAclService(/* existing deps */);
  const fileService = createFileService({ fileNodeService, blobStorageService, aclService, uploadService, fileStorageMode });
  const batchOperationService = createBatchOperationService({ fileNodeService, fileService, aclService });
  const downloadService = createDownloadService({ fileService, blobStorageService, aclService }); // W4.2
  return { fileNodeService, blobStorageService, uploadService, aclService, fileService, batchOperationService, downloadService };
}
```

All route files import the composition from `server/service/composition.js` instead of constructing services per-request. Integration tests override it with mocks via a test-only setter (`__setCompositionForTests`) or `jest.mock('server/service/composition')`.

### Route-by-Route Changes (all nodeId-exclusive — PLAN.md Rule 13)

No route accepts or resolves `path`/`oldPath`/`sourcePath`. Missing/invalid `nodeId` → 400. `normalizePathParam` is deleted in this task.

#### crud.js

**GET `/list`** (line 107):
```js
// BEFORE:
const folderPath = normalizePath(req.query.path || '/');
// ... permission checks on path
const itemsWithThumbnails = await fileService.listDirectoryWithPermissions(principalId, folderPath, user, isShare);

// AFTER:
const parentNodeId = req.query.nodeId ? parseInt(req.query.nodeId, 10) : ROOT_NODE_ID;
if (isNaN(parentNodeId) || parentNodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.files.invalidPath); // 400
}

// Permission check on nodeId instead of path
let hasPermission = await aclService.checkFolderPermission(principalId, parentNodeId, PERMISSIONS.READ);
// ... (rest similar)

const items = await fileService.listDirectoryWithPermissions(principalId, parentNodeId, user);
```

**GET `/download`** (line 144):
```js
// BEFORE: const filePath = req.query.path; ... checkFilePermission(principalId, filePath, READ)
// AFTER:
const fileNodeId = parseInt(req.query.nodeId, 10);
if (!fileNodeId || isNaN(fileNodeId) || fileNodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired); // 400
}

const buffer = await fileService.downloadFile(fileNodeId, principalId, user);
```

**POST `/upload`** (line 176):
```js
// BEFORE: folderPath from req.body.path, webdav-based upload
// AFTER:
const parentNodeId = parseInt(req.body.parentNodeId, 10);
if (!parentNodeId || isNaN(parentNodeId) || parentNodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.files.invalidPath); // 400
}

// Permission gate on nodeId
if (!req.user.is_admin) {
  const ok = await aclService.checkFolderPermission(principalId, parentNodeId, PERMISSIONS.WRITE);
  if (!ok) throw forbiddenError(SERVER_ERROR_CODES.files.accessDenied);
}

const result = await fileService.uploadFile(
  principalId, parentNodeId, originalFilename, req.file.buffer,
  req.file.mimetype || 'application/octet-stream', user, onConflict
);

res.json({
  messageCode: result.skipped ? SERVER_MESSAGE_CODES.files.uploadSkipped : SERVER_MESSAGE_CODES.files.uploadSuccess,
  nodeId: result.nodeId,
  skipped: result.skipped,
});
```

**PUT `/rename`** (line 217):
```js
// BEFORE: { oldPath, newName } → fileService.renameFile(oldPath, newName)
// AFTER:
const nodeId = parseInt(req.body.nodeId, 10);
if (!nodeId || isNaN(nodeId) || nodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired); // 400
}

const result = await fileService.renameNode(nodeId, newName, principalId, user);
res.json({
  messageCode: SERVER_MESSAGE_CODES.files.renameSuccess,
  nodeId: result.nodeId,
  display_path: await fileNodeService.getNodePath(result.nodeId),
});
```

**NEW POST `/move`** (direct route, new):
```js
// Body: { nodeId, destinationParentNodeId }
const nodeId = parseInt(req.body.nodeId, 10);
const destinationParentNodeId = parseInt(req.body.destinationParentNodeId, 10);
if (!nodeId || !destinationParentNodeId || isNaN(nodeId) || isNaN(destinationParentNodeId)) {
  throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired); // 400
}
const result = await fileService.moveNode(nodeId, destinationParentNodeId, principalId, user);
res.json({ messageCode: SERVER_MESSAGE_CODES.files.moveSuccess, nodeId: result.nodeId });
```

**NEW POST `/copy`** (direct route, new):
```js
// Body: { nodeId, destinationParentNodeId, newName? }
const nodeId = parseInt(req.body.nodeId, 10);
const destinationParentNodeId = parseInt(req.body.destinationParentNodeId, 10);
if (!nodeId || !destinationParentNodeId || isNaN(nodeId) || isNaN(destinationParentNodeId)) {
  throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired); // 400
}
const result = await fileService.copyFile(nodeId, destinationParentNodeId, req.body.newName, principalId, user);
res.json({ messageCode: SERVER_MESSAGE_CODES.files.copySuccess, nodeId: result.nodeId });
```

**NEW DELETE `/delete`** (direct route, new):
```js
// Body: { nodeId }
const nodeId = parseInt(req.body.nodeId, 10);
if (!nodeId || isNaN(nodeId) || nodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired); // 400
}
await fileService.deleteNode(nodeId, principalId, user);
res.json({ messageCode: SERVER_MESSAGE_CODES.files.deleteSuccess, nodeId });
```

**POST `/check-conflicts` and POST `/metadata`:** Accept `nodeIds[]` (no `paths`). `check-conflicts` checks for sibling name collisions against the destination parent; `metadata` returns per-nodeId rows. See test cases below.

#### batch.js

**POST `/batch-delete`** (line 20):
```js
// BEFORE: { paths: ['/a/b/c.txt', ...] } → job.payload.paths
// AFTER: { nodeIds: [...] } only — no path resolution anywhere
const nodeIds = (req.body.nodeIds || []).map(id => parseInt(id, 10)).filter(id => Number.isInteger(id) && id > 0);
if (!nodeIds.length) throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
const { jobId } = opStore.createJob(req.user.id, 'delete', { nodeIds });
scheduleBulkWorker(jobId);
```

**POST `/batch-move`** (line 31):
```js
// BEFORE: { moves: [{ sourcePath, destinationPath }] }
// AFTER: { moves: [{ sourceNodeId, destinationParentNodeId }] } only
const moves = (req.body.moves || [])
  .filter(m => Number.isInteger(parseInt(m.sourceNodeId, 10)) && Number.isInteger(parseInt(m.destinationParentNodeId, 10)))
  .map(m => ({
    sourceNodeId: parseInt(m.sourceNodeId, 10),
    destinationParentNodeId: parseInt(m.destinationParentNodeId, 10),
  }));

if (!moves.length) throw validationError(SERVER_ERROR_CODES.files.sourceDestRequired);
const { jobId } = opStore.createJob(req.user.id, 'move', { moves, onConflict: req.body.onConflict });
scheduleBulkWorker(jobId);
```

**POST `/batch-copy`:** Same pattern as batch-move (nodeId-only moves array).

The worker (`runBulkJobWorker`) is a thin dispatcher (W3.4): it reads nodeId-only payloads, calls the matching `createBatchOperationService` method via the composition root, writes progress, and sets job status `completed`/`failed`. **No path-to-nodeId pre-processing step exists.**

#### preview.js

**POST `/preview-ticket`** (line 26):
```js
// BEFORE: req.body.path → checkFilePermission(principalId, filePath, READ)
// AFTER:
const nodeId = parseInt(req.body.nodeId, 10);
if (!nodeId || isNaN(nodeId) || nodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.permissionsMiddleware.pathRequired); // 400
}
const hasPermission = await aclService.checkFilePermission(principalId, nodeId, PERMISSIONS.READ);
```

**GET `/preview-stream`** (line 50): Same pattern — `?nodeId=&ticket=`. Ticket validation uses stored nodeId instead of path comparison.

**POST `/download-multiple`:** Body changes from `{ paths: [...] }` to `{ nodeIds: [...] }`. Delegates to new `createDownloadService` with nodeId-based interface (W4.2).

#### folders.js

**POST `/create`** (line 21):
```js
// BEFORE: { path: '/folder/name' } → webdav.createDirectory(folderPath) + PermissionFacade.grant(...)
// AFTER:
const parentNodeId = parseInt(req.body.parentNodeId, 10) || ROOT_NODE_ID;
const { name } = req.body;
if (!name) throw validationError(SERVER_ERROR_CODES.folders.pathRequired);
if (isNaN(parentNodeId) || parentNodeId <= 0) {
  throw validationError(SERVER_ERROR_CODES.files.invalidPath); // 400
}

// Permission check on parent nodeId
const ok = await aclService.checkFolderPermission(principalId, parentNodeId, PERMISSIONS.WRITE);
if (!ok) throw forbiddenError(SERVER_ERROR_CODES.permissionsMiddleware.accessDenied);

const newDir = await fileNodeService.createDirectory(parentNodeId, name);
res.json({
  messageCode: SERVER_MESSAGE_CODES.folders.createSuccess,
  nodeId: newDir.id,
  display_path: await fileNodeService.getNodePath(newDir.id),
});
```

**GET `/stats`** (line 72): Query changes from `?path=` to `?nodeId=`. Stats computed via closure table descendant count + aggregated filecache sizes instead of WebDAV recursive probe.

#### Middleware Changes

`normalizePathParam` (`server/middleware/normalizePathParam.js`) is **deleted in this task** (PLAN.md Task 4.8). It is replaced by a pure nodeId validation middleware with **no path fallback**:

```js
// server/middleware/validateNodeIdParam.js (new)
'use strict';

const validationError = require('../utils/errorHandler').validationError;
const SERVER_ERROR_CODES = require('@webdav-easyaccess/shared/serverMessageCodes');

function validateNodeIdParam(field = 'nodeId') {
  return (req, res, next) => {
    const raw = req.body?.[field] ?? req.query?.[field];
    if (raw === undefined) return next();
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed <= 0) {
      return validationError(SERVER_ERROR_CODES.files.invalidPath)(req, res);
    }
    req.nodeId = parsed;
    return next();
  };
}

module.exports = validateNodeIdParam;
```

There is no coexistence window: routes migrate to nodeId contracts and the path-based middleware/fileNodeService.resolvePath fallbacks are removed in the same task. Handlers must include a direct 400 when `nodeId` is missing or invalid.

### Test Cases for Route Updates

```
describe('crud routes — nodeId mode')
  describe('GET /list')
    it('accepts ?nodeId=123 and returns items with nodeId field in response')
    it('returns 400 when nodeId is missing or non-integer')
    it('returns 403 when user lacks read permission on node')

  describe('GET /download')
    it('accepts ?nodeId=123 and returns file buffer with correct headers')
    it('returns 400 when nodeId is missing')

  describe('POST /upload')
    it('accepts { parentNodeId: 456 } in body and returns created file\'s nodeId')
    it('returns 400 when parentNodeId is missing')

  describe('PUT /rename')
    it('accepts { nodeId: 10, newName: "x.txt" } and returns updated node with display_path')
    it('returns 400 when nodeId is missing')

  describe('POST /move')
    it('moves node via { nodeId, destinationParentNodeId } and returns moved nodeId')
    it('rejects missing/invalid nodeId or destinationParentNodeId with 400')

  describe('POST /copy')
    it('copies node via { nodeId, destinationParentNodeId } and returns new nodeId')
    it('rejects missing/invalid payload with 400')

  describe('DELETE /delete')
    it('deletes node via { nodeId } and returns deleted nodeId')
    it('rejects missing/invalid nodeId with 400')

describe('batch routes — nodeId mode')
  describe('POST /batch-delete')
    it('accepts { nodeIds: [1,2,3] } and creates job with nodeId payload')
    it('rejects empty/missing nodeIds with 400')

  describe('POST /batch-move')
    it('accepts moves with sourceNodeId/destinationParentNodeId only')
    it('filters out non-integer move items and rejects when none remain')

describe('preview routes — nodeId mode')
  describe('POST /preview-ticket')
    it('accepts { nodeId: 42 } and issues ticket keyed by nodeId')

  describe('GET /preview-stream')
    it('accepts ?nodeId=42&ticket=xxx and validates nodeId matches ticket')

describe('folders routes — nodeId mode')
  describe('POST /create')
    it('accepts { parentNodeId: 10, name: "newdir" } and returns created folder\'s nodeId')

  describe('GET /stats')
    it('accepts ?nodeId=10 and returns descendant/aggregate stats')
```

### Verification Command

```bash
npm run test:integration -w server -- --testPathPatterns="files.test" --no-coverage
```

Expected: All route-level tests pass with nodeId payloads; zero path-based tests remain. Wave 1 Task W1.1-3 documented the endpoint-by-endpoint test matrix — verify each entry has a passing nodeId test.

---

## Plan Update Guide

### How to Update This Document During Execution

1. When a task completes: check off the corresponding row in the Execution Log table below and record any design decisions that emerged
2. When a test reveals a gap in the spec or implementation: add a Hypothesis Revision entry below
3. If a task scope changes (new method discovered, API contract change): update the relevant section and note the revision in "Hypothesis Revisions"
4. After all tasks complete: verify the Handoff checklist at the bottom before merging to `dev`

### Execution Log Template

| Date | Task | Status | Notes |
|------|------|--------|-------|
| — | W3.0 listDirectoryWithPermissions | ☐ Not started | — |
| — | W3.1 Upload Flow (S3 + WebDAV) | ☐ Not started | — |
| — | W3.2 Download Flow | ☐ Not started | — |
| — | W3.3 Rename/Move/Delete Fail-Safe | ☐ Not started | — |
| — | W3.4 Batch Operations Migration | ☐ Not started | — |
| — | W3.5 Copy-on-Write (S3 Mode) | ☐ Not started | — |
| — | W3.6 Route Updates (nodeId API Contract) | ☐ Not started | — |

### Hypothesis Revisions Template

```
## Revision [N]: [Date]
**Assumption:** [what was assumed]
**Evidence:** [what observation contradicted it]
**Revised Understanding:** [new conclusion]
**Affected Tasks:** [list of W3.x tasks impacted]
```

---

## Task Dependency Graph

Tasks that can execute in parallel (no dependencies between them):

```
W3.0 ──────────┐
               ├──> W3.6 (needs all services stable)
W3.1 ──────────┤
               │
W3.2 ──────────┤
               │
W3.3 ──────────┘
               │
W3.4 ────────> W3.5 ──> (both feed into batch/copy operations)
```

**Parallel execution groups:**
- **Group A (independent):** W3.0, W3.1, W3.2, W3.3 — all modify different methods in `fileService.js` and have independent test files
- **Group B (depends on Group A):** W3.4 rewrites `batchOperationService.js`, which depends on fileService methods from Group A being stable
- **Group C (depends on Groups A+B):** W3.5 copy-on-write adds to both fileService and batchOperationService; needs both services' interfaces finalized
- **W3.6 (final integration):** Route updates depend on all service methods being implemented; executes last

**Recommended sub-agent delegation:** Launch 4 sub-agents for Group A simultaneously. After they complete, launch W3.4. Then W3.5. Finally W3.6.

---

## Handoff to Wave 4

- [ ] All operation flows tested and working in both S3/WebDAV modes:
  - [ ] `listDirectoryWithPermissions` returns nodeId-based results with async permission flags (W3.0)
  - [ ] `uploadFile` dispatches correctly to uploadService (S3) or blobStorageService.uploadToWebdav (WebDAV), handles all onConflict strategies (W3.1)
  - [ ] `downloadFile` uses nodeId + permission gate, blobStorageService dual-backend dispatch works (W3.2)
  - [ ] `renameNode`, `moveNode`, `deleteNode` have fail-safe semantics: WebDAV storage failure → orphaned_node status, DB state remains consistent (W3.3)
  - [ ] batchOperationService uses factory pattern with injected deps, async permission gates per item, no sync checkers (W3.4)
  - [ ] Copy-on-write verified: two nodes share one blob, mutation of either triggers copy-to-new-key before write (W3.5)

- [ ] Routes accept/return nodeId exclusively; no path fallback anywhere (W3.6):
  - [ ] `crud.js`: /list, /download, /upload, /rename are nodeId-only; new POST /move, POST /copy, DELETE /delete routes added
  - [ ] `batch.js`: /batch-delete, /batch-move, /batch-copy accept nodeIds/nodeId moves; worker is a thin dispatcher with no path resolution
  - [ ] `preview.js`: /preview-ticket, /preview-stream, /download-multiple use nodeId payloads
  - [ ] `folders.js`: /create accepts parentNodeId, /stats accepts nodeId query param
  - [ ] `normalizePathParam` middleware deleted; replaced by nodeId-validation middleware
  - [ ] Composition root (`server/service/composition.js`) wired; routes no longer construct services per-request

- [ ] Batch operations use async permission gates (`aclService.checkFilePermission`/`checkFolderPermission`) — zero references to `buildSync*Checker` in batchOperationService.js

- [ ] Copy-on-write verified: test case creates node A, copies to B, confirms both reference same s3_key; then overwrites B and confirms A retains original content (split on write)

- [ ] Fail-safe tested: simulated WebDAV error during rename/move/delete → orphaned_node status set in DB, error logged but not thrown to caller for storage-side operations

Wave 4 will:
- Clean up server-side legacy code: remove sync checker re-exports from aclService (Task 4.8f), remove `getHomeOwnerUserIdForPath` and remaining path utilities
- Migrate client to nodeId payloads: fileService, permissionService, buildPermissionDiff, clipboard operations, FileActionSheet, hooks, and components (Tasks 4.8a-4.8h, 4.10)
- Rewrite client tests per Wave 1 Task W1.1-4 plan
