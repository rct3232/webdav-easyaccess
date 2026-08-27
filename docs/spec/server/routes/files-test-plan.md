# files.test.js — Phase 4 nodeId Migration Test Plan

## 1. Current State Analysis

### 1.1 Describe Blocks & Test Cases (572 lines)

| # | describe block | Endpoint | Test cases | Payload style |
|---|---------------|----------|------------|---------------|
| 1 | `GET /api/files/list` | `/list` | 4 tests | path-based query (`?path=/...`) |
| 2 | `GET /api/files/download` | `/download` | 3 tests | path-based query (`?path=/...`) |
| 3 | `POST /api/files/preview-ticket` | `/preview-ticket` | 2 tests | path in body (`{ path: '...' }`) |
| 4 | `GET /api/files/preview-stream` | `/preview-stream` | 2 tests | path + ticket query params |
| 5 | `POST /api/files/batch-move` | `/batch-move` | 2 tests | path-based (`sourcePath`, `destinationPath`) |
| 6 | `POST /api/files/upload` | `/upload` | 2 tests | multipart field `path` |
| 7 | `POST /api/files/batch-delete` | `/batch-delete` | 2 tests | paths array (`{ paths: [...] }`) |
| 8 | `POST /api/files/batch-copy` | `/batch-copy` | 1 test | path-based (`sourcePath`, `destinationPath`) |
| 9 | `GET /api/files/bulk-operation/:jobId` | `/bulk-operation/:jobId` | 1 test | N/A (polling) |
| 10 | `PUT /api/files/rename` | `/rename` | 3 tests | path-based (`{ oldPath, newName }`) |
| 11 | `POST /api/files/check-conflicts` | `/check-conflicts` | 1 test | nodeId-based (`sourceNodeId`, `destinationParentNodeId`) |
| 12 | `POST /api/files/metadata` | `/metadata` | 2 tests | paths array (`{ paths: [...] }`) |
| 13 | `POST /api/files/download-multiple` | `/download-multiple` | 3 tests | paths array (`{ paths: [...] }`) |
| 14 | `POST /api/files/bulk-operation/:jobId/cancel` | `/bulk-operation/:jobId/cancel` | 1 test | N/A (cancel) |

**Total:** 29 test cases across 14 describe blocks. All 29 use path-based payloads or query parameters. Zero tests use `nodeId`.

### 1.2 Current Mocking Strategy

The file uses a single module-level mock of the WebDAV client:

```js
jest.mock('../../../../utils/webdav', () => {
  const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
  mockWebdav = createWebdavMock();
  return mockWebdav;
});
```

- **`webdavMock`** (`server/testing/mocks/webdavMock.js`) — provides `listDirectory`, `pathExists`, `getFileContents`, `getFileMetadata`, `isVideoFile`.
- Mocks are configured globally in `beforeAll` / `beforeEach` with deterministic defaults. Scenario-specific overrides use `.mockResolvedValueOnce()` (e.g., preview-stream test).
- **No service-layer mocks.** The tests exercise the full app via Supertest, hitting real route handlers that call through to WebDAV directly. There is no injection of `fileNodeService`, `blobStorageService`, `aclService`, or `uploadService`.

### 1.3 Authentication & Permission Setup Pattern

Every test follows a consistent setup:
1. `createAuthenticatedTestUser()` — creates user + returns `{ user, token }`
2. `permissionStore.grant(user.id, nodeId, 'read'|'write')` — grants ACL on a nodeId (post-Wave 4; replaces the prior `grantTestPermission` helper which operated on path strings)
3. Supertest request with `Authorization: Bearer ${token}`

This pattern remains valid for Phase 4. The grant mechanism operates on `nodeId` exclusively after Wave 4 removed all path-based permission functions. ACL checks route through `aclService`.

---

## 2. Required Changes for Phase 4

### 2.1 Mocking Strategy Migration

**From:** Single WebDAV module mock (`jest.mock('utils/webdav')`)
**To:** Four independently mocked services injected via the composition root:

| Service | Source spec | Methods to mock | Purpose in tests |
|---------|-------------|-----------------|-------------------|
| `fileNodeService` | `docs/spec/server/services/fileNodeService.md` | `listDirectory`, `getNodePath`, `resolvePath`, `createFile`, `renameNode`, `moveNode`, `deleteNode`, `getDescendantIds`, `updateSyncStatus` | Tree CRUD, path resolution, closure table |
| `blobStorageService` | `docs/spec/server/services/blobStorageService.md` | `downloadBlob`, `uploadToWebdav`, `prepareUpload`, `completeUpload`, `overwriteBlob`, `deleteBlob`, `getActiveS3Key`, `duplicateBlob` | Blob storage operations |
| `aclService` | (inline, no spec yet) | `checkFolderPermission`, `checkFilePermission`, `isAdminUser` | Permission gates on every operation |
| `uploadService` | `docs/spec/server/services/uploadService.md` | `uploadFile`, `overwriteFile`, `downloadFile` | 4-step upload orchestration (S3 mode) |

**Implementation approach:** The route handlers receive these services via dependency injection in the composition root (`server/index.js`). For integration tests, we inject mock implementations that replace the real service factories. Each mock is a plain object with Jest mock functions — no `jest.mock()` at module level. Per-test overrides use `.mockResolvedValueOnce()`.

**Default mock behavior (set in `beforeEach`):**
- `fileNodeService.listDirectory(parentNodeId)` → resolves children array with `nodeId`, `name`, `type` fields
- `fileNodeService.getNodePath(nodeId)` → resolves to a display path string
- `blobStorageService.downloadBlob(fileNodeId)` → resolves to `Buffer.from('content')`
- `aclService.checkFolderPermission(userId, nodeId, action)` → resolves to `true` (permission granted)
- `aclService.isAdminUser(user)` → resolves based on user object

### 2.2 Payload Rewrites — Path-to-nodeId Mapping

Every test payload must be rewritten from path strings to `nodeId` references. The mapping below defines the exact transformation for each endpoint:

| Endpoint | Current payload | New payload (Phase 4) | Notes |
|----------|-----------------|----------------------|-------|
| `GET /list` | `?path=/${username}` | `?nodeId=${homeFolderNodeId}` | Query param; nodeId must be positive integer |
| `GET /download` | `?path=/${username}/file1.txt` | `?nodeId=${fileNodeId}` | Query param |
| `POST /preview-ticket` | `{ path: '...' }` | `{ nodeId: ${fileNodeId} }` | Body; video type check via file metadata, not extension |
| `GET /preview-stream` | `?path=...&ticket=T` | `?nodeId=${fileNodeId}&ticket=T` | Query param |
| `PUT /rename` | `{ oldPath: '...', newName: '...' }` | `{ nodeId: ${fileNodeId}, newName: 'renamed.txt' }` | Body; no path reference |
| `POST /upload` (multipart) | field `path=...` | field `parentNodeId=${folderNodeId}` | Multipart form field |
| `POST /move` | *(no single-item route)* | `{ nodeId, destinationParentNodeId }` | **New endpoint** — replaces batch-move for single items |
| `POST /copy` | *(no single-item route)* | `{ nodeId, destinationParentNodeId, newName? }` | **New endpoint** |
| `DELETE /delete` | *(no single-item route)* | `{ nodeId }` | **New endpoint** |
| `POST /batch-move` | `{ moves: [{ sourcePath, destinationPath }] }` | `{ moves: [{ sourceNodeId, destinationParentNodeId }] }` | Body array of objects |
| `POST /batch-copy` | `{ copies: [{ sourcePath, destinationPath }] }` | `{ copies: [{ sourceNodeId, destinationParentNodeId, newName? }] }` | Body array of objects |
| `POST /batch-delete` | `{ paths: [...] }` | `{ nodeIds: [1, 2, 3] }` | Body; array of integers |
| `POST /download-multiple` | `{ paths: [...] }` | `{ nodeIds: [...], downloadId? }` | Body; array of integers |
| `POST /check-conflicts` | `{ operations: [{ sourcePath, destinationPath, type }] }` | `{ operations: [{ sourceNodeId, destinationParentNodeId, type }] }` | Body |
| `POST /metadata` | `{ paths: [...] }` | `{ nodeIds: [...] }` | Body; array of integers |

### 2.3 Response Assertions — nodeId and display_path

All response assertions must verify that returned objects include both `nodeId` (primary identifier) and `display_path` (human-readable path string, derived from closure table traversal):

```js
// Example: list response item shape assertion
expect(res.body.items[0]).toMatchObject({
  nodeId: expect.any(Number),
  display_path: expect.any(String),
});
```

Specific per-endpoint additions:
- **`GET /list`:** Each item in `items[]` must have `nodeId` and `display_path`. Admin bypass test verifies all items return `hasReadPermission: true`, `hasWritePermission: true`.
- **`POST /upload`:** Response body includes `{ nodeId, display_path }`. Skip conflict returns `{ nodeId, skipped: true }`.
- **`PUT /rename`:** Response includes `{ nodeId, new_display_path }` (was `{ path: '...' }`).
- **`POST /move`, `POST /copy`:** Response includes `{ nodeId, display_path }`.
- **`DELETE /delete`:** Response includes `{ deletedCount }`.

### 2.4 Tests to Remove

No backward-compatibility tests are retained. All path-based test cases listed in §1.1 must be rewritten using nodeId payloads. There is no `path` parameter anywhere in Phase 4 request surfaces.

---

## 3. Endpoints Requiring nodeId Test Coverage

### 3.1 CRUD Operations (`crud.js`)

| Endpoint | Test case | Payload / Query | Expected assertion |
|----------|-----------|-----------------|-------------------|
| `GET /list` | Returns folder contents for authenticated user | `?nodeId=${homeNodeId}` | status=200, body has `items[]`, each item has `nodeId` (number) + `display_path` (string) |
| `GET /list` | Returns 401 when not authenticated | no auth header | status=401 |
| `GET /list` | Returns 403 when user lacks read permission on nodeId | `?nodeId=${otherNodeId}` | status=403, body.errorCode defined |
| `GET /list` | Admin bypass — returns all items | `?nodeId=${homeNodeId}`, admin user | status=200, all items have `hasReadPermission: true`, `hasWritePermission: true` |
| `GET /download` | Returns file content for permitted user | `?nodeId=${fileNodeId}` | status=200, body defined (buffer) |
| `GET /download` | Returns 401 when not authenticated | no auth header | status=401 |
| `GET /download` | Returns 403 when user lacks read permission | `?nodeId=${otherFileNodeId}` | status=403, body.errorCode defined |
| `POST /upload` | Returns 403 when user has no write permission on parent | multipart + field `parentNodeId=${noWriteFolderId}` | status=403, body.errorCode defined |
| `POST /upload` | Accepts multipart upload and returns nodeId | multipart + field `parentNodeId=${homeNodeId}`, file attach | status=200, body has `nodeId` (number) + `display_path`; messageCode defined |
| `PUT /rename` | Returns 403 when using share token (read-only) | `{ nodeId: ${fileNodeId}, newName: 'x.txt' }`, X-Share-Token header | status=403, body.errorCode defined |
| `PUT /rename` | Returns 400 when nodeId or newName missing | `{ nodeId: ${id} }` then `{ newName: 'x' }` | status=400, errorCode=`sourceDestRequired` |
| `PUT /rename` | Renames successfully | `{ nodeId: ${fileNodeId}, newName: 'renamed.txt' }` | status=200, messageCode=`renameSuccess`, body has `new_display_path` containing `'renamed.txt'` |
| `POST /move` | Returns 403 when user lacks write on destination parent | `{ nodeId: ${fileId}, destinationParentNodeId: ${noWriteId} }` | status=403, body.errorCode defined |
| `POST /move` | Moves successfully | `{ nodeId: ${fileId}, destinationParentNodeId: ${homeNodeId} }` | status=200, body has `nodeId`, `display_path` with new parent segment |
| `POST /copy` | Returns 403 when user lacks read on source or write on dest | `{ nodeId: ${otherFileId}, destinationParentNodeId: ${noWriteId} }` | status=403, body.errorCode defined |
| `POST /copy` | Copies successfully | `{ nodeId: ${fileId}, destinationParentNodeId: ${homeNodeId} }` | status=200, body has new `nodeId` (different from source), `display_path` |
| `DELETE /delete` | Returns 403 when user lacks write on parent | `{ nodeId: ${otherFileId} }` | status=403, body.errorCode defined |
| `DELETE /delete` | Deletes successfully | `{ nodeId: ${fileId} }` | status=200, body has `deletedCount` (≥ 1) |
| `POST /check-conflicts` | Returns conflicts array | `{ operations: [{ sourceNodeId: ${id}, destinationParentNodeId: ${destId}, type: 'move' }] }` | status=200, body.conflicts is array |
| `POST /metadata` | Returns metadata for nodeIds | `{ nodeIds: [${fileNodeId}] }` | status=200, body is array with nodeId entries |
| `POST /metadata` | Works with share token (read-only) | X-Share-Token header + `{ nodeIds: [...] }` | status=200, body is array |

### 3.2 Preview & Thumbnails (`preview.js`)

| Endpoint | Test case | Payload / Query | Expected assertion |
|----------|-----------|-----------------|-------------------|
| `POST /preview-ticket` | Returns ticket for video file with permission | `{ nodeId: ${videoFileId} }` | status=200, body.ticket is string |
| `POST /preview-ticket` | Returns 400 when file is not a video type | `{ nodeId: ${txtFileId} }` | status=400, errorCode=`files.previewNotVideo` |
| `GET /preview-stream` | Streams video inline with valid ticket | `?nodeId=${videoFileId}&ticket=${validTicket}` | status=200, headers include `content-disposition: inline`, `content-type` starts with `video/` |
| `GET /preview-stream` | Returns 403 for invalid ticket | `?nodeId=${fileId}&ticket=nope` | status=403, errorCode=`files.previewTicketInvalid` |

### 3.3 Batch Operations (`batch.js`)

| Endpoint | Test case | Payload / Query | Expected assertion |
|----------|-----------|-----------------|-------------------|
| `POST /batch-move` | Returns 400 when moves missing | `{}` (empty body) | status=400, body.errorCode defined |
| `POST /batch-move` | Returns 202 + jobId for valid batch-move | `{ moves: [{ sourceNodeId: ${id1}, destinationParentNodeId: ${destId} }] }` | status=202, body.jobId defined |
| `POST /batch-copy` | Returns 202 + jobId for valid batch-copy | `{ copies: [{ sourceNodeId: ${id1}, destinationParentNodeId: ${destId} }] }` | status=202, body.jobId defined |
| `POST /batch-delete` | Returns 202 + jobId for valid batch-delete | `{ nodeIds: [${id1}, ${id2}] }` | status=202, body.jobId defined |
| `GET /bulk-operation/:jobId` | Returns 404 for unknown jobId | path param = `'nonexistent-job-id'` | status=404, body.errorCode defined |
| `POST /bulk-operation/:jobId/cancel` | Cancels job and returns messageCode | Create batch-move → cancel with jobId from response | move: status=202; cancel: status=200, messageCode=`cancelRequested`, body.jobId matches |

### 3.4 Download Multiple (`preview.js`)

| Endpoint | Test case | Payload / Query | Expected assertion |
|----------|-----------|-----------------|-------------------|
| `POST /download-multiple` | Returns 400 when nodeIds is empty array | `{ nodeIds: [] }` | status=400, body.errorCode defined |
| `POST /download-multiple` | Returns ZIP for valid nodeIds | `{ nodeIds: [${fileId}] }` | status=200, content-type matches `application/zip` |
| `POST /download-multiple` | Returns 403 when user lacks read on any nodeId | `{ nodeIds: [${noAccessFileId}] }` | status=403, body.errorCode defined |

---

## 4. Test Infrastructure Changes

### 4.1 Setup Replacement

**Remove:**
```js
jest.mock('../../../../utils/webdav', () => { ... });
// All mockWebdav.* configuration in beforeAll/beforeEach
```

**Add (in `beforeEach` or per-test):**
```js
const mockFileNodeService = {
  listDirectory: jest.fn(),
  getNodePath: jest.fn(),
  resolvePath: jest.fn(),
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
  deleteBlob: jest.fn(),
  getActiveS3Key: jest.fn(),
  duplicateBlob: jest.fn(),
};

const mockAclService = {
  checkFolderPermission: jest.fn().mockResolvedValue(true),
  checkFilePermission: jest.fn().mockResolvedValue(true),
  isAdminUser: jest.fn().mockReturnValue(false),
};

const mockUploadService = {
  uploadFile: jest.fn(),
  overwriteFile: jest.fn(),
  downloadFile: jest.fn(),
};
```

### 4.2 Service Injection in Tests

The app must be bootstrapped with mocked services instead of real ones. This requires either:
- A test-only composition root that substitutes mocks for production factories, OR
- Monkey-patching the service module exports before `require('../../../../index')` loads the app.

The existing pattern (`process.env.WEA_SKIP_BULK_WORKER = '1'`, then `require('../../../../index')`) remains, but gains an additional injection step for service mocks.

### 4.3 nodeId Fixtures

Tests need deterministic node IDs instead of path strings. A fixture helper should provide:
```js
const FIXTURE_IDS = {
  homeFolder: 1,        // user's home directory node
  subDir: 2,            // child directory under home
  file1: 3,             // file1.txt under home
  videoFile: 4,         // video.mp4 under home
  otherUserFolder: 10,  // another user's home (no permission)
};
```

Wave 4 completed this migration: test helpers now call `permissionStore.grant(userId, nodeId, permission)` directly. The prior `grantTestPermission` helper (path-based) was removed alongside `PermissionFacade`.

### 4.4 Default Mock Behaviors (`beforeEach`)

```js
beforeEach(() => {
  jest.clearAllMocks();

  // fileNodeService defaults
  mockFileNodeService.listDirectory.mockResolvedValue([
    { id: FIXTURE_IDS.file1, name: 'file1.txt', type: 'file', size: 7, mimeType: 'text/plain' },
    { id: FIXTURE_IDS.subDir, name: 'subdir', type: 'directory', size: null, mimeType: null },
  ]);
  mockFileNodeService.getNodePath.mockImplementation((nodeId) => `/${username}/${getNodeName(nodeId)}`);

  // blobStorageService defaults
  mockBlobStorageService.downloadBlob.mockResolvedValue(Buffer.from('content'));

  // aclService defaults — permission granted unless test overrides
  mockAclService.checkFolderPermission.mockResolvedValue(true);
  mockAclService.checkFilePermission.mockResolvedValue(true);
  mockAclService.isAdminUser.mockReturnValue(false);
});
```

---

## 5. Migration Checklist

- [ ] Remove `jest.mock('../../../../utils/webdav')` and all `mockWebdav.*` references
- [ ] Create per-service mock objects (`fileNodeService`, `blobStorageService`, `aclService`, `uploadService`)
- [ ] Wire mocks into app bootstrap (composition root injection)
- [ ] Rewrite all 29 test cases to use nodeId payloads per §3 mapping table
- [ ] Add response assertions for `nodeId` and `display_path` in returned objects
- [ ] Create nodeId fixture constants (`FIXTURE_IDS`)
- [x] ~~Update `grantTestPermission` calls~~ — completed in Wave 4: replaced with `permissionStore.grant(userId, nodeId, permission)`; path-based helper removed
- [ ] Add new describe blocks for `POST /move`, `POST /copy`, `DELETE /delete` (single-item endpoints)
- [ ] Remove any test that exercises path-based behavior exclusively
- [ ] Verify all 29+ rewritten tests pass with mocked service layer

---

## 6. Test Count Summary

| Category | Before (path-based) | After (nodeId-based) | Delta |
|----------|-------------------|-------------------|-------|
| CRUD endpoints | 14 tests | 18 tests | +4 (new single-item move/copy/delete) |
| Preview/thumbnails | 4 tests | 4 tests | 0 |
| Batch operations | 7 tests | 7 tests | 0 |
| Download multiple | 3 tests | 3 tests | 0 |
| **Total** | **29** | **32** | **+3** |

The three new test cases come from the single-item endpoints (`POST /move`, `POST /copy`, `DELETE /delete`) that did not exist as individual routes in the path-based API. Each receives at minimum a success case and a 403 permission-denied case.
