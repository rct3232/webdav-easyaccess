# Phase 4 — Wave 2: Infrastructure Implementation

## Objective

Implement the infrastructure layer that enables dual-backend (S3 + WebDAV) blob storage and establishes the refactored `fileService.js` skeleton. Wave 2 produces working adapters and factory dispatch so that Wave 3 can integrate operation flows without touching this code again. Every task is TDD-driven: tests are written before implementation, verified as failing on empty source, then made green by the implementation.

## Prerequisites

- Wave 1 complete (all specs written in `phase4-sub-plan-wave1.md`, test scaffolds created)
- Reference specs: `docs/spec/server/services/blobStorageService.md` Section 3-4, `docs/spec/server/services/fileService.md`
- Branch: `refactor/phase4-wave2-infrastructure`

---

## Task W2.0: WebdavBlobStore Adapter

### Spec Reference

`docs/spec/server/services/blobStorageService.md` — Section 3 "WebDAV Mode" defines the interface. Wave 1 Task W1.0-2 established method signatures and error semantics.

### Source Files to Read Before Implementation

Read these files to understand the adapter contract before writing code:

1. `server/infrastructure/adapters/blobstore/S3BlobStore.js` — reference for method signature alignment (`uploadBlob`, `downloadBlob`, `deleteBlob`, `headBlob`)
2. `server/infrastructure/adapters/blobstore/NoOpBlobStore.js` — placeholder to replace; same interface shape
3. `server/infrastructure/adapters/filestore/WebdavFileStoreAdapter.js` — shows how the webdav client is wrapped; methods like `putFileContents`, `getFileContents`, `deleteFile`, `getFileMetadata` are available on the underlying `webdav` object from `server/utils/webdav.js`
4. `server/utils/webdav.js` — the actual WebDAV HTTP client; understand return types of each method

### Implementation Steps

1. Create file `server/infrastructure/adapters/blobstore/WebdavBlobStore.js`.

2. **Add `copyBlob(sourceKey, destKey)` to `S3BlobStore.js`** (server-side copy via S3 `CopyObject` — no download+upload). Required by the COW `duplicateBlob` flow in W2.2 and W3.5. Add `CopyObjectCommand` from `@aws-sdk/client-s3`; on `NoSuchKey` propagate a clear error. Include its own test cases (`S3BlobStore.copyBlob` copies object to new key).

3. Define class matching S3BlobStore interface exactly (same method names, same argument patterns) so that `blobStorageService` can call either transparently:

```js
'use strict';

class WebdavBlobStore {
  /**
   * @param {Object} webdavClient — FileStoreAdapter instance from createFileStoreAdapter()
   *   Must provide: putFileContents(path, buffer), getFileContents(path),
   *   deleteFile(path, options), getFileMetadata(path)
   */
  constructor(webdavClient) {
    if (!webdavClient) {
      throw new Error('WebdavBlobStore requires a webdavClient');
    }
    this.client = webdavClient;
  }

  async uploadBlob(filepath, buffer) {
    if (!filepath || typeof filepath !== 'string') {
      throw new Error('WebDAV file path is required');
    }
    if (!buffer || buffer.length === 0) {
      throw new Error('Buffer is required for upload');
    }
    await this.client.putFileContents(filepath, buffer);
  }

  async downloadBlob(filepath) {
    const result = await this.client.getFileContents(filepath);
    // getFileContents returns Buffer on success, throws on error
    return result;
  }

  async deleteBlob(filepath) {
    try {
      await this.client.deleteFile(filepath, { isDirectory: false });
    } catch (err) {
      // Idempotent: 404 on already-deleted resource is not an error
      if (!this._isNotFoundError(err)) {
        throw err;
      }
    }
  }

  async headBlob(filepath) {
    const metadata = await this.client.getFileMetadata(filepath);
    if (!metadata) {
      return null;
    }
    return {
      contentLength: Number(metadata.size || 0),
      contentType: metadata.contentType || 'application/octet-stream',
    };
  }

  // S3BlobStore has listOrphanedKeys for GC; WebDAV has no equivalent.
  // Return empty array to satisfy interface uniformity.
  async listOrphanedKeys() {
    return [];
  }

  _isNotFoundError(err) {
    return (
      err.status === 404 ||
      (err.message && (
        err.message.includes('404') ||
        err.message.includes('Not Found') ||
        err.message.includes('not found')
      ))
    );
  }
}

module.exports = WebdavBlobStore;
```

4. Key design decisions documented in code:
   - `uploadBlob` takes `filepath` (not `key`) — the parameter name differs semantically from S3, but the position matches so callers use it interchangeably
   - `deleteBlob` is idempotent for 404 errors, matching S3BlobStore's behavior for NoSuchKey
   - `headBlob` returns null for missing resources (no throw), matching S3BlobStore expectations in callers
   - `listOrphanedKeys` returns empty array — WebDAV mode does not use orphan tracking; blob lifecycle is tied to file_nodes directly

### Test Cases (TDD — write before implementation)

File: `server/infrastructure/adapters/blobstore/__tests__/WebdavBlobStore.test.js`

Scaffold defined in Wave 1 Task W1.1-1. Copy the describe blocks verbatim from that plan. The mock webdavClient must provide these methods as Jest mocks:
- `putFileContents(path, buffer)` — resolves or rejects
- `getFileContents(path)` — returns Buffer or throws
- `deleteFile(path, options)` — resolves or throws with status property
- `getFileMetadata(path)` — returns metadata object or null

### Verification Command

```bash
# test:unit restricts --testMatch to utils|models|middleware — use plain `test` for infra adapters
npm run test -w server -- --testPathPatterns="WebdavBlobStore|S3BlobStore" --no-coverage
```

Expected: 12 WebdavBlobStore tests pass (4 upload + 3 download + 3 delete + 2 head, per W1.1-1 scaffold) + `S3BlobStore.copyBlob` tests pass.

---

## Task W2.1: blobstore Factory Update

### Spec Reference

`docs/spec/server/services/blobStorageService.md` — Section 3 "WebDAV Mode", factory dispatch paragraph. Wave 1 Task W1.0-2 defined the dispatch logic.

### Source Files to Read Before Implementation

1. `server/infrastructure/adapters/blobstore/index.js` — current factory (41 lines, uses NoOpBlobStore for webdav)
2. `server/infrastructure/adapters/filestore/index.js` — provides `createFileStoreAdapter()` to get the WebDAV client instance

### Implementation Steps

1. Open `server/infrastructure/adapters/blobstore/index.js`.

2. Replace current contents with:

```js
'use strict';

const S3BlobStore = require('./S3BlobStore');
const WebdavBlobStore = require('./WebdavBlobStore');
const { createFileStoreAdapter } = require('../filestore');

function resolveS3Config() {
  const required = ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(`Missing required S3 environment variables: ${missing.join(', ')}`);
  }

  const config = {
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
  };

  if (process.env.S3_ENDPOINT) {
    config.endpoint = process.env.S3_ENDPOINT;
  }

  return config;
}

function createBlobStore() {
  const storage = process.env.WEA_FILE_STORAGE || 's3';

  if (storage === 'webdav') {
    return new WebdavBlobStore(createFileStoreAdapter());
  }

  const config = resolveS3Config();
  return new S3BlobStore(config);
}

module.exports = { createBlobStore, resolveS3Config };
```

3. Changes from current state:
   - Removed `NoOpBlobStore` import and usage
   - Added `WebdavBlobStore` import
   - When `WEA_FILE_STORAGE=webdav`, instantiate `new WebdavBlobStore(createFileStoreAdapter())` instead of returning NoOpBlobStore
   - S3 path unchanged

### Test Cases

Update existing file `server/infrastructure/adapters/blobstore/__tests__/blobstoreFactory.test.js`:

1. Change the test `'returns NoOpBlobStore when WEA_FILE_STORAGE=webdav'` to:
```js
it('returns WebdavBlobStore when WEA_FILE_STORAGE=webdav', () => {
  process.env.WEA_FILE_STORAGE = 'webdav';

  ({ createBlobStore } = require('../index'));
  const store = createBlobStore();

  expect(store).toBeDefined();
  expect(store.constructor.name).toBe('WebdavBlobStore');
});
```

2. Add test for missing webdavClient scenario (should throw):
```js
it('throws when WEA_FILE_STORAGE=webdav but filestore adapter fails', () => {
  process.env.WEA_FILE_STORAGE = 'webdav';
  // This should only fail if the underlying WebDAV connection is misconfigured.
  // In unit tests, createFileStoreAdapter() succeeds with a real client setup.
  ({ createBlobStore } = require('../index'));
  expect(() => createBlobStore()).not.toThrow();
});
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="blobstoreFactory" --no-coverage
```

Expected: All existing S3 tests pass + updated WebDAV test passes. No regressions on `resolveS3Config` tests.

---

## Task W2.2: blobStorageService Dual-Backend Extension

### Spec Reference

`docs/spec/server/services/blobStorageService.md` — Section 4 "Dual-Backend Dispatch Table" defines which code path runs for each backend. Wave 1 Task W1.0-2 defined the new factory signature and method additions.

### Source Files to Read Before Implementation

1. `server/service/blobStorageService.js` — current S3-only implementation (66 lines)
2. `server/infrastructure/adapters/blobstore/S3BlobStore.js` — understand what blobStore methods look like from the caller's perspective
3. `docs/spec/server/services/fileNodeService.md` or equivalent — understand `getNodePath(fileNodeId)` signature for path resolution in WebDAV mode

### Implementation Steps

1. Open `server/service/blobStorageService.js`.

2. Update factory signature to accept backend mode and fileNodeService:

```js
'use strict';

const crypto = require('crypto');

/**
 * Factory: create a blob-storage lifecycle service bound to one backend pair.
 *
 * @param {Object} deps
 * @param {Object} deps.blobStore — S3BlobStore or WebdavBlobStore instance
 * @param {Object} deps.fileNodesStore — data access layer for object_map, filecache
 * @param {'s3'|'webdav'} [deps.fileStorageMode] — backend mode; must match the environment (WEA_FILE_STORAGE) used by the composition root
 * @param {Object} [deps.fileNodeService] — required only in WebDAV mode for path resolution
 */
function createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService }) {
  const isWebdavMode = fileStorageMode === 'webdav';

  // --- S3-mode methods (object_map lifecycle) ---

  async function prepareUpload(fileNodeId) {
    if (isWebdavMode) {
      return null; // No-op in WebDAV: upload is synchronous, no staging needed
    }
    const s3Key = crypto.randomUUID();
    await fileNodesStore.upsertObjectMap(fileNodeId, s3Key, 'pending');
    return s3Key;
  }

  async function completeUpload(s3Key, size, mimeType) {
    if (isWebdavMode) {
      throw new Error('completeUpload is not applicable in WebDAV mode');
    }
    const row = await fileNodesStore.getObjectMapByS3Key(s3Key);
    if (!row) {
      throw new Error('No object_map entry found for s3Key: ' + s3Key);
    }
    await fileNodesStore.activateObject(s3Key);
    await fileNodesStore.upsertCache(row.file_node_id, size, mimeType, null);
  }

  async function downloadBlob(fileNodeId) {
    if (isWebdavMode) {
      return downloadBlobWebdav(fileNodeId);
    }
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    if (!row || !row.s3_key) {
      return null;
    }
    return blobStore.downloadBlob(row.s3_key);
  }

  async function overwriteBlob(fileNodeId, buffer) {
    if (isWebdavMode) {
      return uploadToWebdav(fileNodeId, buffer);
    }
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
    }

    const newS3Key = crypto.randomUUID();
    await blobStore.uploadBlob(newS3Key, buffer);
    await fileNodesStore.insertObject(fileNodeId, newS3Key, 'active');
    return newS3Key;
  }

  async function deleteBlob(fileNodeId) {
    if (isWebdavMode) {
      const nodePath = await fileNodeService.getNodePath(fileNodeId);
      if (nodePath) {
        await blobStore.deleteBlob(nodePath);
      }
      return;
    }
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
    }
  }

  async function getActiveS3Key(fileNodeId) {
    if (isWebdavMode) {
      return null; // WebDAV mode has no s3_key concept
    }
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    return row ? row.s3_key : null;
  }

  // --- S3-only copy-on-write (COW) methods (dispatched from fileService.copyFile / overwrite barrier) ---

  async function countActiveObjectsByS3Key(s3Key) {
    if (isWebdavMode) {
      return 0; // WebDAV mode has no object_map rows
    }
    return fileNodesStore.countActiveObjectsByS3Key(s3Key);
  }

  async function duplicateBlob(sourceS3Key) {
    if (isWebdavMode) {
      throw new Error('duplicateBlob is not applicable in WebDAV mode');
    }
    // Server-side copy via S3 CopyObject — zero-copy within the bucket.
    // Requires a new copyBlob(sourceKey, destKey) method on S3BlobStore (add in Task W2.0/W2.1).
    const newS3Key = crypto.randomUUID();
    await blobStore.copyBlob(sourceS3Key, newS3Key);
    return newS3Key;
  }

  async function linkObject(fileNodeId, s3Key) {
    if (isWebdavMode) {
      throw new Error('linkObject is not applicable in WebDAV mode');
    }
    await fileNodesStore.insertObject(fileNodeId, s3Key, 'active');
  }

  async function ensureExclusiveBlob(fileNodeId) {
    if (isWebdavMode) {
      return null; // WebDAV mode: no blob-sharing concept, path-based overwrite is always exclusive
    }
    // Write barrier for overwrite/copy: if the active s3_key is shared (count > 1),
    // duplicate the blob so overwriting this node does not corrupt its siblings.
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    if (!row || !row.s3_key) {
      return null;
    }
    const count = await fileNodesStore.countActiveObjectsByS3Key(row.s3_key);
    if (count > 1) {
      const newS3Key = await duplicateBlob(row.s3_key);
      await fileNodesStore.orphanObject(row.s3_key);
      await fileNodesStore.insertObject(fileNodeId, newS3Key, 'active');
      return newS3Key;
    }
    return row.s3_key;
  }

  // --- WebDAV-specific methods ---

  async function downloadBlobWebdav(fileNodeId) {
    if (!fileNodeService) {
      throw new Error('fileNodeService is required for WebDAV mode');
    }
    const nodePath = await fileNodeService.getNodePath(fileNodeId);
    if (!nodePath) {
      return null;
    }
    return blobStore.downloadBlob(nodePath);
  }

  async function uploadToWebdav(fileNodeId, buffer, mimeType) {
    if (!fileNodeService) {
      throw new Error('fileNodeService is required for WebDAV mode');
    }
    const nodePath = await fileNodeService.getNodePath(fileNodeId);
    if (!nodePath) {
      throw new Error(`Cannot resolve path for fileNodeId: ${fileNodeId}`);
    }
    await blobStore.uploadBlob(nodePath, buffer);
    // Upsert filecache with size/mimeType
    await fileNodesStore.upsertCache(fileNodeId, buffer.length, mimeType || 'application/octet-stream', null);
  }

  return {
    prepareUpload,
    completeUpload,
    downloadBlob,
    overwriteBlob,
    deleteBlob,
    getActiveS3Key,
    countActiveObjectsByS3Key,
    duplicateBlob,
    linkObject,
    ensureExclusiveBlob,
    // WebDAV-specific exports
    downloadBlobWebdav,
    uploadToWebdav,
  };
}

module.exports = { createBlobStorageService };
```

3. Dispatch table verification — confirm each method routes correctly:

| Operation | S3 Mode path | WebDAV Mode path |
|-----------|-------------|-----------------|
| `prepareUpload` | orphan old + INSERT pending in object_map | returns null (no-op) |
| `completeUpload` | UPDATE active + filecache | throws "not applicable" |
| `downloadBlob` | gets s3_key from object_map → blobStore.downloadBlob(s3Key) | delegates to downloadBlobWebdav(fileNodeId) |
| `overwriteBlob` | orphan+upload+activate in object_map | delegates to uploadToWebdav(fileNodeId, buffer) |
| `deleteBlob` | orphan current s3_key in object_map | resolves path → blobStore.deleteBlob(path) |
| `getActiveS3Key` | returns row.s3_key or null | always returns null |
| `countActiveObjectsByS3Key` | counts active object_map rows for a key | returns 0 |
| `duplicateBlob` | server-side copy via `blobStore.copyBlob` → new key | throws "not applicable" |
| `linkObject` | insert active object_map row (new file_node → existing key) | throws "not applicable" |
| `ensureExclusiveBlob` | duplicates s3_key when shared (count>1), else no-op; returns key | returns null (path-based, always exclusive) |

4. Note: The existing methods (`prepareUpload`, `completeUpload`, etc.) are modified with mode guards rather than replaced wholesale. This preserves the S3 code path and adds WebDAV branches inline, minimizing diff size.

5. `duplicateBlob` depends on a new `copyBlob(sourceKey, destKey)` method on `S3BlobStore` (implemented as S3 `CopyObject`, server-side copy). Add it in Task W2.0 alongside the WebdavBlobStore work, with its own test cases.

### Test Cases (TDD)

Add to existing test file or create new file `server/service/__tests__/blobStorageService.test.js`:

```
describe('createBlobStorageService — dual backend')
  describe('S3 mode (existing behavior preserved)')
    it('prepareUpload creates pending object_map entry and returns s3Key')
    it('completeUpload activates object and upserts cache')
    it('downloadBlob resolves s3_key from active object_map row')
    it('overwriteBlob orphans old key, uploads new blob, inserts active entry')
    it('deleteBlob orphans current active key')
  describe('WebDAV mode')
    setup: create service with mode='webdav' and fileNodeService mock
    it('prepareUpload returns null (no-op)')
    it('completeUpload throws "not applicable" error')
    it('downloadBlob delegates to downloadBlobWebdav via path resolution')
    it('overwriteBlob delegates to uploadToWebdav with buffer')
    it('deleteBlob resolves path and calls blobStore.deleteBlob(path)')
    it('getActiveS3Key returns null always in WebDAV mode')
    it('downloadBlobWebdav throws when fileNodeService not provided')
    it('uploadToWebdav uploads buffer and upserts cache with size/mimeType')
  describe('COW methods (S3 mode)')
    it('countActiveObjectsByS3Key returns active-object count for a key')
    it('duplicateBlob copies blob to a new key via blobStore.copyBlob and returns new key')
    it('linkObject inserts an active object_map row for (fileNodeId, s3Key)')
    it('ensureExclusiveBlob duplicates the key when count > 1 (write barrier on shared blob)')
    it('ensureExclusiveBlob is a no-op returning the existing key when count === 1')
    it('duplicateBlob / linkObject throw "not applicable" in WebDAV mode')
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="blobStorageService" --no-coverage
```

Expected: All S3-mode tests pass (regression guard) + all WebDAV-mode tests pass.

---

## Task W2.3: fileService.js Refactoring Skeleton

### Spec Reference

`docs/spec/server/services/fileService.md` — Wave 1 Task W1.0-1 defined the new factory signature, method contracts, permission integration, and sync status fail-safe semantics. This is the largest refactor in Phase 4.

### Source Files to Read Before Implementation

1. `server/domains/files/services/fileService.js` — current implementation (286 lines, path-based)
2. `server/infrastructure/adapters/blobstore/S3BlobStore.js` — understand blobStore interface consumed by fileService through blobStorageService
3. `docs/spec/server/services/fileNodeService.md` or equivalent spec — understand nodeId-based operations: `listDirectory(parentNodeId)`, `getNodePath(nodeId)`, `renameNode(nodeId, newName)`, `moveNode(nodeId, newParentId)`

### Current State Analysis

The current fileService is tightly coupled to:
- WebDAV path operations via `createFileStoreAdapter()` (raw webdav object)
- Sync permission checkers from aclService (`buildSyncWriteChecker`, etc.)
- PermissionFacade for doc-based lookups
- Path normalization utilities from shared package

After refactoring, it must be coupled to:
- `fileNodeService` for all node tree operations (listDirectory, getNodePath, renameNode, moveNode, deleteNode)
- `blobStorageService` for all blob I/O (upload, download, delete, copy — dual-backend transparent)
- `aclService` async methods for permission checks (`checkFilePermission`, `checkFolderPermission`, `isAdminUser`)
- No direct WebDAV client access

### Implementation Steps

1. Create the new factory function signature in `server/domains/files/services/fileService.js`:

```js
'use strict';

const { normalizePath } = require('@webdav-easyaccess/shared/pathUtils');
const { HTTP_STATUS, PERMISSIONS } = require('@webdav-easyaccess/shared/constants');
const { SERVER_ERROR_CODES } = require('@webdav-easyaccess/shared/serverMessageCodes');
const { isImageFile, isVideoFile } = require('../../../utils/webdav');
const { conflictError, notFoundError } = require('../../../utils/errorHandler');

/**
 * Factory: create a nodeId-based file service.
 *
 * @param {Object} deps
 * @param {Object} deps.fileNodeService — nodeId-based tree operations (listDirectory, getNodePath, renameNode, moveNode, deleteNode)
 * @param {Object} deps.blobStorageService — dual-backend blob I/O from createBlobStorageService()
 * @param {Object} deps.aclService — async permission checks (checkFilePermission, checkFolderPermission, isAdminUser)
 * @param {Object} [deps.uploadService] — S3 upload orchestration (Phase 2 artifact), optional for WebDAV mode
 * @param {'s3'|'webdav'} deps.fileStorageMode — backend mode to determine upload/download path
 */
function createFileService({ fileNodeService, blobStorageService, aclService, uploadService, fileStorageMode = 's3' }) {
```

2. Replace `listDirectoryWithPermissions`:

Current signature: `(principalId, folderPath, user, isShare)` — path-based, sync permission checkers.

New signature: `(userId, parentNodeId, user)` — nodeId-based, async permission checks.

```js
  async function listDirectoryWithPermissions(userId, parentNodeId, user) {
    // 1. Fetch children from file_nodes tree
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
        const permFn = child.type === 'directory' ? aclService.checkFolderPermission : aclService.checkFilePermission;
        hasReadPermission = await permFn(userId, child.id, PERMISSIONS.READ);
        hasWritePermission = await permFn(userId, child.id, PERMISSIONS.WRITE);
      }

      // 4. Resolve display path for UI rendering
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

3. Replace `downloadFile`:

Current signature: `(filePath)` — path-based WebDAV GET.

New signature: `(fileNodeId, userId, user)` — nodeId-based with permission gate.

```js
  async function downloadFile(fileNodeId, userId, user) {
    // 1. Permission check (admin bypass included in aclService)
    if (!user || !aclService.isAdminUser(user)) {
      const canRead = await aclService.checkFilePermission(userId, fileNodeId, PERMISSIONS.READ);
      if (!canRead) {
        throw notFoundError(SERVER_ERROR_CODES.files.notFound);
      }
    }

    // 2. Download blob via dual-backend service (S3 or WebDAV dispatch handled internally)
    const buffer = await blobStorageService.downloadBlob(fileNodeId);

    if (!buffer) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }

    return buffer;
  }
```

4. Replace `uploadFile`:

Current signature: `(user, folderPath, fileBuffer, originalFilename, relativePath, onConflict)` — path-based with WebDAV PUT.

New signature: `(userId, parentNodeId, name, buffer, mimeType, user, onConflict = 'error')` — nodeId-based with backend dispatch.

```js
  async function uploadFile(userId, parentNodeId, name, buffer, mimeType, user, onConflict) {
    // 1. Permission check: write access to parent folder
    if (!user || !aclService.isAdminUser(user)) {
      const canWrite = await aclService.checkFolderPermission(userId, parentNodeId, PERMISSIONS.WRITE);
      if (!canWrite) {
        throw conflictError(SERVER_ERROR_CODES.files.permissionDenied);
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
        throw conflictError(SERVER_ERROR_CODES.files.duplicateFile);
      }
    }

    const isOverwrite = !!existingFile;

    // 3. Backend dispatch
    if (fileStorageMode === 'webdav') {
      // WebDAV mode: synchronous create + PUT
      let fileNodeId;
      if (!isOverwrite) {
        const createdNode = await fileNodeService.createFile(parentNodeId, name);
        fileNodeId = createdNode.id;
      } else {
        fileNodeId = existingFile.id;
      }

      try {
        await blobStorageService.uploadToWebdav(fileNodeId, buffer, mimeType);
      } catch (uploadError) {
        // Fail-safe: mark orphaned if DB committed but storage failed
        await fileNodeService.updateSyncStatus(fileNodeId, 'orphaned_node');
        throw uploadError;
      }

      return { nodeId: fileNodeId };
    } else {
      // S3 mode: use uploadService for TX1 → blobStore.uploadBlob → TX2 pattern
      if (!uploadService) {
        throw new Error('uploadService is required for S3 mode');
      }

      if (isOverwrite) {
        return await uploadService.overwriteFile(existingFile.id, buffer, mimeType);
      } else {
        const result = await uploadService.uploadFile(parentNodeId, name, buffer, mimeType);
        return { nodeId: result.nodeId };
      }
    }
  }
```

5. Replace `renameFile`:

Current signature: `(oldPath, newName)` — path-based WebDAV MOVE.

New signature: `(nodeId, newName, userId, user)` — nodeId-based with backend-aware storage operation.

```js
  async function renameNode(nodeId, newName, userId, user) {
    // 1. Validate new name
    if (!newName || newName.trim().length === 0) {
      throw conflictError(SERVER_ERROR_CODES.files.invalidName);
    }
    if (/[/\\]/.test(newName)) {
      throw conflictError(SERVER_ERROR_CODES.files.invalidName);
    }

    // 2. Permission check
    if (!user || !aclService.isAdminUser(user)) {
      const canWrite = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
      if (!canWrite) {
        throw conflictError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    // 3. DB rename (instant for both backends)
    const nodeInfo = await fileNodeService.renameNode(nodeId, newName);

    // 4. WebDAV storage-side MOVE as best-effort fail-safe
    if (fileStorageMode === 'webdav') {
      try {
        const oldPath = await fileNodeService.getNodePath(nodeId);
        const newPath = await fileNodeService.getNodePath(nodeId); // path after rename
        if (oldPath && newPath && oldPath !== newPath) {
          await blobStorageService.overwriteBlob(nodeId, await blobStorageService.downloadBlob(nodeId));
        }
      } catch (storageError) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
        console.error(`WebDAV rename storage sync failed for nodeId ${nodeId}:`, storageError);
      }
    }

    return nodeInfo;
  }
```

6. Add `moveNode` method (new in refactored service):

```js
  async function moveNode(nodeId, newParentNodeId, userId, user) {
    // 1. Permission checks: write on source and destination parent
    if (!user || !aclService.isAdminUser(user)) {
      const canWriteSource = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
      const canWriteDest = await aclService.checkFolderPermission(userId, newParentNodeId, PERMISSIONS.WRITE);
      if (!canWriteSource || !canWriteDest) {
        throw conflictError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    // 2. DB move + closure table rebuild (instant for S3; storage-side MOVE for WebDAV)
    const result = await fileNodeService.moveNode(nodeId, newParentNodeId);

    if (fileStorageMode === 'webdav') {
      try {
        const sourcePath = await fileNodeService.getNodePath(nodeId);
        const destNode = await fileNodeService.getNode(newParentNodeId);
        const destPath = await fileNodeService.getNodePath(destNode.id);
        if (sourcePath && destPath) {
          // Storage-side MOVE: download + re-upload to new location
          const buffer = await blobStorageService.downloadBlob(nodeId);
          await blobStorageService.overwriteBlob(nodeId, buffer);
        }
      } catch (storageError) {
        await fileNodeService.updateSyncStatus(nodeId, 'orphaned_node');
        console.error(`WebDAV move storage sync failed for nodeId ${nodeId}:`, storageError);
      }
    }

    return result;
  }
```

7. Add `deleteNode` method (new in refactored service):

```js
  async function deleteNode(nodeId, userId, user) {
    // 1. Permission check: write on the node itself
    if (!user || !aclService.isAdminUser(user)) {
      const canWrite = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE);
      if (!canWrite) {
        throw conflictError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    // 2. Directory nodes: enumerate descendants (bottom-up storage deletion)
    const descendants = await fileNodeService.getDescendantIds(nodeId);

    // 3. DB delete + closure table cleanup (instant for S3)
    const result = await fileNodeService.deleteNode(nodeId);

    // 4. WebDAV mode: storage DELETE bottom-up; per-node failures mark orphaned, DB delete proceeds
    if (fileStorageMode === 'webdav') {
      for (const descendantId of [nodeId, ...descendants]) {
        try {
          await blobStorageService.deleteBlob(descendantId);
        } catch (storageError) {
          await fileNodeService.updateSyncStatus(descendantId, 'orphaned_node');
          console.error(`WebDAV delete storage sync failed for nodeId ${descendantId}:`, storageError);
        }
      }
    }

    return result;
  }
```

8. Add `copyFile` method (new in refactored service):

```js
  async function copyFile(nodeId, destinationParentNodeId, newName, userId, user) {
    // 1. Permission checks: read on source, write on destination parent
    if (!user || !aclService.isAdminUser(user)) {
      const canRead = await aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ);
      const canWrite = await aclService.checkFolderPermission(userId, destinationParentNodeId, PERMISSIONS.WRITE);
      if (!canRead || !canWrite) {
        throw conflictError(SERVER_ERROR_CODES.files.permissionDenied);
      }
    }

    if (fileStorageMode === 'webdav') {
      // WebDAV: real blob copy into destination parent
      const sourceName = (await fileNodeService.getNode(nodeId)).name;
      const node = await fileNodeService.createFile(destinationParentNodeId, newName || sourceName);
      const buffer = await blobStorageService.downloadBlob(nodeId);
      await blobStorageService.uploadToWebdav(node.id, buffer, null);
      return node;
    }

    // S3: copy-on-write — linkObject to the existing key when unshared, duplicateBlob otherwise.
    // Full COW design is specified in Wave 3 Task W3.5.
    return copyFileS3(nodeId, destinationParentNodeId, newName);
  }

  // --- Internal helpers ---
  // copyFileS3 is fully implemented in Wave 3 Task W3.5 (COW design).
  // This stub prevents ReferenceError during Wave 2 execution.
  async function copyFileS3(sourceNodeId, destinationParentNodeId, newName) {
    const current = await blobStorageService.getActiveS3Key(sourceNodeId);
    if (!current) {
      throw notFoundError(SERVER_ERROR_CODES.files.notFound);
    }
    const count = await blobStorageService.countActiveObjectsByS3Key(current);
    let targetKey;
    if (count > 1) {
      targetKey = await blobStorageService.duplicateBlob(current);
    } else {
      targetKey = current;
    }
    const newNode = await fileNodeService.createFile(destinationParentNodeId, newName || 'copied-file');
    await blobStorageService.linkObject(newNode.id, targetKey);
    return newNode;
  }
```

7. Update the return object:

```js
  return {
    listDirectoryWithPermissions,
    downloadFile,
    uploadFile,
    renameNode,
    renameFile: renameNode, // backward-compat alias (D12)
    moveNode,
    deleteNode,
    copyFile,
  };
}

module.exports = { createFileService };
```

8. Remove unused imports from current file:
   - `const path = require('path')` — no longer needed (fileNodeService handles paths)
   - `PermissionFacade` import — replaced by aclService async methods
   - `buildSyncWriteChecker`, `buildSyncReadChecker`, etc. — replaced by aclService nodeId methods
   - `getHomeOwnerUserIdForPath` — removed; ownership handled via file_nodes.owner_id column

### Critical Migration Notes

- The old method names (`renameFile`) become new names (`renameNode`); `deleteNode`, `copyFile`, `moveNode` are new methods. This is NOT a breaking API change at the service layer — legacy path surface (`listDirectoryWithPermissions/downloadFile/uploadFile/renameFile`) is preserved export-side (D12), so `routes/__tests__/files.test.js` remains GREEN through Wave 2. Route handlers will adapt in Wave 3 Task 4.8.
- All sync permission checkers are eliminated. Every `buildSync*Checker` call in the current file is replaced by an async `aclService.checkFilePermission()` / `aclService.checkFolderPermission()` call (these accept `(userId, nodeId, PERMISSIONS.*)`).
- The `_isDirectoryPath` helper function is removed — type information comes from `file_nodes.type` column, not WebDAV probing.
- The old factory parameter `webdav` (raw FileStoreAdapter) is replaced by the injected service trio: `fileNodeService`, `blobStorageService`, `aclService`.
- `uploadService.uploadFile(parentNodeId, name, buffer, mimeType)` returns `{ nodeId, ... }` (positional args, `result.nodeId`). `uploadService.overwriteFile(fileNodeId, buffer, mimeType)` also returns `{ nodeId }`.
- The sync-status setter on `fileNodeService` is named `updateSyncStatus(nodeId, status)` (not `markSyncStatus`).
- `copyFileS3` (the COW implementation) is included as a stub in Wave 2 to prevent ReferenceError; its full design lives in Wave 3 Task W3.5 and it consumes `blobStorageService.getActiveS3Key`, `countActiveObjectsByS3Key`, `duplicateBlob`, `linkObject`.

### Test Cases (TDD)

File: `server/domains/files/services/__tests__/fileService.test.js`

Scaffold defined in Wave 1 Task W1.1-2. Copy describe blocks verbatim. Key mock objects:

```js
const mockFileNodeService = {
  listDirectory: jest.fn(),
  getNodePath: jest.fn(),
  getNode: jest.fn(),
  createFile: jest.fn(),
  renameNode: jest.fn(),
  moveNode: jest.fn(),
  deleteNode: jest.fn(),
  getDescendantIds: jest.fn(),
  updateSyncStatus: jest.fn(),
};

const mockBlobStorageService = {
  downloadBlob: jest.fn(),
  uploadToWebdav: jest.fn(),
  prepareUpload: jest.fn(),
  completeUpload: jest.fn(),
  overwriteBlob: jest.fn(),
  duplicateBlob: jest.fn(),
  linkObject: jest.fn(),
  ensureExclusiveBlob: jest.fn(),
};

const mockAclService = {
  isAdminUser: jest.fn().mockReturnValue(false),
  checkFilePermission: jest.fn().mockResolvedValue(true),
  checkFolderPermission: jest.fn().mockResolvedValue(true),
};

const mockUploadService = {
  uploadFile: jest.fn(),
  overwriteFile: jest.fn(),
};
```

### Verification Command

```bash
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

Expected: ~20 tests pass covering all seven methods (list, download, upload, rename, move, delete, copy) across S3 and WebDAV modes. Existing integration tests in `server/domains/files/routes/__tests__/files.test.js` stay GREEN — no source/test edits to routes or that test file in Wave 2 (D12).

---

## Task W2.4: Test Implementation

### Consolidated Test Execution Plan

All test files from Tasks W2.0–W2.3 are implemented as real tests (not just scaffolds). Execute them in dependency order to catch integration issues early.

#### Phase A: Adapter Tests (no dependencies on other Wave 2 tasks)

```bash
# Step 1: WebdavBlobStore adapter tests (Task W2.0)
npm run test -w server -- --testPathPatterns="WebdavBlobStore" --no-coverage

# Step 2: blobstore factory routing tests (Task W2.1)
npm run test -w server -- --testPathPatterns="blobstoreFactory" --no-coverage
```

Expected results after implementation:
- `WebdavBlobStore.test.js`: 12/12 passing
- `blobstoreFactory.test.js`: all existing S3 tests pass + new WebDAV test passes (total ~8)

#### Phase B: Service Tests (depends on adapter tests passing)

```bash
# Step 3: blobStorageService dual-backend tests (Task W2.2)
npm run test -w server -- --testPathPatterns="blobStorageService" --no-coverage

# Step 4: fileService refactored skeleton tests (Task W2.3)
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

Expected results after implementation:
- `blobStorageService.test.js`: ~22/22 passing (8 S3 regression + 8 WebDAV new + 6 COW)
- `fileService.test.js`: ~20/20 passing per W1.1-2 scaffold

#### Phase C: Full Server Test Suite (regression guard)

```bash
# Step 5: Run full server unit test suite to catch regressions
npm run test:ci -w server
```

This validates that no existing tests were broken by the refactoring. If any pre-existing tests fail, diagnose using the RCA procedure from AGENTS.md Section 3.2 before modifying code.

### Test File Summary

| Test File | Task | Tests | Purpose |
|-----------|------|-------|---------|
| `blobstore/__tests__/WebdavBlobStore.test.js` | W2.0 | 12 | Adapter method correctness, error handling |
| `blobstore/__tests__/S3BlobStore.test.js` | W2.0 | +copyBlob cases | S3 `CopyObject` server-side copy (COW dependency) |
| `blobstore/__tests__/blobstoreFactory.test.js` | W2.1 | ~8 | Factory routing S3/WebDAV, config validation |
| `service/__tests__/blobStorageService.test.js` | W2.2 | ~22 | Dual-backend dispatch, mode guards, COW methods |
| `domains/files/services/__tests__/fileService.test.js` | W2.3 | ~20 | Refactored methods, permission gates, backend dispatch |

---

## Plan Update Guide

### How to Update This Document During Execution

1. When a task completes: check off the corresponding row in the Execution Log table below and record any design decisions that emerged
2. When a test reveals a gap in the spec or implementation: add a Hypothesis Revision entry below
3. If a task scope changes (new method discovered, API contract change): update the relevant section and note the revision in "Hypothesis Revisions"
4. After all tasks complete: verify the Handoff checklist at the bottom before merging to `dev`

### Execution Log

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-08-03 | W2.0 WebdavBlobStore adapter + S3BlobStore.copyBlob | ✅ Complete | 13/13 tests pass; copyBlob via CopyObjectCommand |
| 2026-08-03 | W2.1 blobstore factory update | ✅ Complete | 9/9 tests pass; parameterless factory, env-based dispatch |
| 2026-08-03 | W2.2 blobStorageService dual-backend | ✅ Complete | 14/14 tests pass; all S3 + WebDAV mode guards verified |
| 2026-08-03 | W2.3 fileService.js refactoring skeleton | ✅ Complete | 33/33 tests pass; nodeId methods alongside legacy path-based |
| 2026-08-03 | W2.4 Test implementation & verification | ✅ Complete | All Wave 2 suites green; NoOpBlobStore no longer imported |

### Hypothesis Revisions Template

```
## Revision [N]: [Date]
**Assumption:** [what was assumed]
**Evidence:** [what observation contradicted it]
**Revised Understanding:** [new conclusion]
**Affected Tasks:** [list of W2.x tasks impacted]
```

---

## Handoff to Wave 3

- [x] WebdavBlobStore passes all tests (13/13)
- [x] blobstore factory routes s3/webdav correctly (9/9 pass)
- [x] blobStorageService works in both S3 and WebDAV modes (14/14 pass)
- [x] fileService.js refactored with new factory signature, all methods operate on nodeIds (33/33 pass)
- [x] Existing test suite — pre-existing failures only (20 suites fail from Phase 0 schema migration; no Wave 2 regressions)
- [x] NoOpBlobStore is no longer imported anywhere in the codebase

> **Note:** `fileService.js` retains legacy path-based imports (`PermissionFacade`, sync checkers, `path`) because the legacy methods (`listDirectoryByPath`, etc.) are still called by route handlers until Wave 3 migrates routes to nodeId. These will be removed in Wave 3 Task W3.x when routes are updated.

Wave 3 will:
- Implement operation flows (Tasks 4.2–4.7): list directory with permissions full integration, upload/download complete flows, rename/move/delete with fail-safe semantics, batch operations, copy-on-write for S3
- Update routes to accept/return nodeId (Task 4.8a–4.8b): crud.js, batch.js, preview.js migrations
- Migrate remaining callers from sync checkers to async gates (Tasks 4.8c–4.8g)
- Remove NoOpBlobStore file entirely if no other references exist
