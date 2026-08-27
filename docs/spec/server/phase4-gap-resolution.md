# Phase 4 Gap Resolution Plan

## Overview

Phase 4 implementation is **90% complete**. All server-side code for tasks 4.0–4.8g is verified correct and clean of legacy path-based code. The remaining gaps fall into three categories:

1. **Client fileService permission helpers** (Task 4.8i) — 5 functions still pass path strings to nodeId-expecting APIs
2. **Route test WebDAV mock replacement** (Task 4.9) — tests pass by accident via lower-layer interception, not service-level mocking as planned
3. **Spec documentation updates** — 3 spec files not aligned with current code

---

## Gap 1: Client fileService.js Path-Based Permission Helpers

**File:** `client/src/services/fileService.js` (551 lines)  
**Affected lines:** 485–507  
**Task:** 4.8i

### Current State

Five exported functions accept path strings (`filePath`) and forward them as `folderPath: filePath` to `permissionService.js`, which now expects `nodeId`:

```javascript
// Line 485-487 — checkPermission
export const checkPermission = async (path) => {
  return checkPermissionApi(path);   // passes string where nodeId expected
};

// Line 490-492 — checkFilePermission
export const checkFilePermission = async (filePath) => {
  return checkPermissionApi(filePath);   // same issue
};

// Lines 495-497 — grantFilePermission
export const grantFilePermission = async ({ userId, filePath, permission }) => {
  await grantPermissionApi({ userId, folderPath: filePath, permission, target: 'file' });
  // sends folderPath key; server expects nodeId
};

// Lines 500-502 — revokeFilePermission
export const revokeFilePermission = async ({ userId, filePath }) => {
  await revokePermissionApi({ userId, folderPath: filePath, scope: 'pathOnly' });
  // same issue
};

// Lines 505-507 — updateFilePermission
export const updateFilePermission = async ({ userId, filePath, permission }) => {
  await grantPermissionApi({ userId, folderPath: filePath, permission, target: 'file' });
  // same issue
};
```

### Required Changes

| Function | Current Signature | New Signature | Payload Change |
|----------|-------------------|---------------|-----------------|
| `checkPermission` (L485) | `(path)` | `(nodeId)` | Pass `nodeId` to `checkPermissionApi(nodeId)` |
| `checkFilePermission` (L490) | `(filePath)` | `(fileNodeId)` | `return checkPermissionApi(fileNodeId)` |
| `grantFilePermission` (L495) | `{ userId, filePath, permission }` | `{ userId, fileNodeId, permission }` | Send `{ userId, nodeId: fileNodeId, permission, target: 'file' }` |
| `revokeFilePermission` (L500) | `{ userId, filePath }` | `{ userId, fileNodeId }` | Send `{ userId, nodeId: fileNodeId, scope: 'pathOnly' }` |
| `updateFilePermission` (L505) | `{ userId, filePath, permission }` | `{ userId, fileNodeId, permission }` | Same as grantFilePermission |

### Caller Audit Required Before Change

Before renaming parameters, verify who calls these functions. Search the client codebase for:

```
grep -rn "checkPermission\|checkFilePermission\|grantFilePermission\|revokeFilePermission\|updateFilePermission" client/src/ --include="*.js" --include="*.jsx" | grep -v "__tests__" | grep -v "node_modules"
```

Each caller currently passes a path string. Update each call site to pass `file.nodeId` or equivalent nodeId value instead. If no production callers exist, these functions can be removed entirely.

### Verification

After changes:
- Grep for `folderPath` in `client/src/services/fileService.js` → zero matches
- Grep for `filePath` parameter name in the 5 functions → zero matches (only `nodeId`/`fileNodeId`)

---

## Gap 2: explorerGateway.js Unused Imports

**File:** `client/src/services/explorerGateway.js`  
**Affected line:** 6  
**Task:** 4.8i (cleanup)

### Current State

```javascript
// Line 6 — three imports that are never used in the file body
import { normalizePath, getBasename, getParentPath } from '../utils/pathUtils';
```

These were left over from a previous iteration. Grep confirms zero usages of these identifiers within `explorerGateway.js`.

### Required Change

Remove line 6 entirely or remove only the unused identifiers:

```diff
- import { normalizePath, getBasename, getParentPath } from '../utils/pathUtils';
```

### Verification

After removal, client build succeeds (`npm run build -w client`), no "undefined" runtime errors in explorer-related features.

---

## Gap 3: Route Tests — WebDAV Mock Replacement (Task 4.9)

**Files:**
- `server/domains/files/routes/__tests__/files.test.js` (515 lines)
- `server/domains/files/routes/__tests__/folders.test.js` (176 lines)  
**Task:** 4.9

### Problem

Both test files use `jest.mock('../../../../utils/webdav')` to intercept WebDAV calls at the lowest layer. PLAN.md Task 4.9 requires replacing this with service-level mocking via composition root overrides (`__setCompositionForTests`). The tests pass because:

1. Route handler → composition root → blobStorageService → WebdavBlobStore → `utils/webdav` ← **mocked here**

The mock sits at the bottom of the chain, not at the service layer as intended. This means the tests do not verify that the service-layer contracts are correct — they only verify that the route handlers forward calls correctly to some lower adapter.

### Required Changes for `files.test.js`

#### Step 3a: Remove jest.mock block (lines 30-51)

Delete entirely:
```javascript
// DELETE lines 30-51
var mockWebdav;
jest.mock('../../../../utils/webdav', () => { ... });
mockWebdav.listDirectory.mockImplementation(...);
mockWebdav.pathExists.mockResolvedValue(true);
...
```

#### Step 3b: Add composition root setup in beforeAll

Replace the mock with explicit service injection. The pattern is already demonstrated in `server/domains/files/routes/__tests__/files.integration.test.js` (lines 67-72):

```javascript
// Add to imports at top of file:
const { createWebdavMock } = require('../../../../testing/mocks/webdavMock');
const WebdavBlobStore = require('../../../../infrastructure/adapters/blobstore/WebdavBlobStore');
const composition = require('../../../../service/composition');

// In beforeAll, AFTER createTestDatabase() but BEFORE app import:
let webdavMock;
let blobStore;

beforeAll(async () => {
  // ... existing database setup ...

  // Create WebDAV mock and wrap in adapter:
  webdavMock = createWebdavMock();
  blobStore = new WebdavBlobStore(webdavMock);

  // Inject into composition root:
  composition.__setCompositionForTests({
    fileStorageMode: 'webdav',
    blobStore,
  });

  // NOW require the app (it will use our overridden composition):
  app = require('../../../../index');
});
```

#### Step 3c: Configure per-test-scenario mock behavior

The current `mockWebdav.listDirectory.mockImplementation(...)` at line 37-51 configures global behavior. Move this into test-specific setup using the `webdavMock` variable created in step 3b:

```javascript
// Before each test that needs specific WebDAV responses:
beforeEach(() => {
  webdavMock.listDirectory.mockResolvedValue([...]); // test-specific data
  webdavMock.getFileContents.mockResolvedValue(Buffer.from('test content'));
  webdavMock.getFileMetadata.mockResolvedValue({ size: 100, lastmod: '2024-01-01', mime: 'text/plain' });
  webdavMock.pathExists.mockResolvedValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});
```

### Required Changes for `folders.test.js`

Same pattern as files.test.js. The WebDAV mock block is at lines 26-31:

```javascript
// DELETE these lines:
var mockWebdav;
jest.mock('../../../../utils/webdav', () => { ... });
```

The existing `beforeEach` (lines 51-56) that configures `mockWebdav.pathExists`, etc. should be moved to use the `webdavMock` from composition root setup instead.

### download-multiple Hang Fix

**File:** `server/domains/files/routes/__tests__/files.test.js`, lines 463-471

The test sends `{ nodeIds: [homeNodeId] }` where `homeNodeId` is a **directory**. The `downloadService.downloadMultiple()` tries to call `blobStorageService.downloadBlob(homeNodeId)` on it, which resolves the directory path and attempts to stream its contents into a ZIP archive. With supertest + archiver, this produces an indefinite hang because:

1. Directory nodes have no blob content in object_map
2. In WebDAV mode, `downloadBlob` falls through to `getFileContents(path)` on a directory path
3. The mock returns `Buffer.from('content')`, so the archive is created but never properly finalized in supertest's async context

**Fix options (choose one):**

**Option A — Filter directories at test level:** Change the test to send file nodeIds instead of directory:
```javascript
// Instead of homeNodeId (directory), use a file nodeId:
.send({ nodeIds: [testFileNodeId] })  // testFileNodeId is created in beforeAll
```

**Option B — Fix downloadService.downloadMultiple():** Add a type check that skips directories and only downloads files. This is the more correct production fix since users might accidentally include directory IDs.

**Recommendation:** Option A for immediate test fix + Option B as a separate improvement to `downloadService.js`.

### Verification

After changes:
```bash
npm run test:unit -w server -- --testPathPatterns="files.test|folders.test" --verbose 2>&1 | tail -40
```

Expected: All tests pass, no hang on download-multiple, no `jest.mock('utils/webdav')` in either file.

---

## Gap 4: Spec Documentation Updates

Three spec files need updates to reflect current code state.

### Spec A: `docs/spec/client/services/fileService.md`

**Current state:** Documents path-based signatures (`listFiles(path)`, `batchMoveFiles(moves)` with path strings).  
**Required update:** Rewrite all function signatures for nodeId-based APIs.

Specifically, the spec should document:

| Function | Current (wrong) | Should be |
|----------|-----------------|-----------|
| `listFiles` | `(path, options?)` | `(nodeId)` |
| `downloadFile` | `(path)` | `(nodeId)` |
| `uploadFile` | `(file, path, ...)` | `(file, parentNodeId, relativePath)` |
| `renameFile` | `(path, newName)` | `(nodeId, newName)` |
| `createFolder` | `(path, name)` | `(parentNodeId, name)` |
| `getFolderStats` | `(path)` | `(nodeId)` |
| `checkConflicts` | `(operations with paths)` | `(operations with sourceNodeId, destinationParentNodeId)` |
| `downloadMultipleFiles` | `(paths[])` | `(nodeIds[])` |
| `batchDeleteFiles` | `(paths[])` | `(nodeIds[])` |
| `batchMoveFiles` | `(moves with paths)` | `(moves with sourceNodeId, destinationParentNodeId)` |
| `batchCopyFiles` | `(copies with paths)` | `(copies with sourceNodeId, destinationParentNodeId)` |
| `requestThumbnailsBatch` | `(paths[])` | `(nodeIds[])` |

Also add documentation for the 5 legacy permission helpers (lines 485-507) noting they need migration (Gap 1 above).

### Spec B: `docs/spec/server/routes/folders.md`

**Current state:** Documents path-based parameters (`POST /create` body: `{path}`, `GET /stats` query: `?path=...`).  
**Required update:** Align with nodeId contract from `files.md` §2.9.

Specific changes:
- `POST /api/folders/create`: Body should be documented as `{ parentNodeId, name }` (not `{ path }`)
- `GET /api/folders/stats`: Query param should be `?nodeId=...` (not `?path=...`)
- ✅ Remove mention of `normalizePathParam` middleware — it was removed per Task 4.8 (done: `folders.md` no longer references it)

### Spec C: Composition Root — New Spec File Suggested

**File to create:** `docs/spec/server/service/composition.md`

The composition root (`server/service/composition.js`, 88 lines) is a critical architectural component with no standalone documentation. Its contract should be documented:

```markdown
# composition.md

## Purpose
Singleton service factory that wires all Phase 2-4 services once at startup. Routes call `getComposition()` to obtain pre-configured service instances.

## API

### getComposition()
Returns the cached composition object with keys:
- fileNodesStore, blobStore, fileNodeService, blobStorageService, uploadService
- aclService, fileService, batchOperationService, downloadService

### __setCompositionForTests(overrides)
Test-only override. Accepts partial object; merges into next composition creation.
Used by route tests to inject mocked services.

### resetComposition()
Clears cached instance. Call in afterEach for test isolation.

## Configuration
Reads `WEA_FILE_STORAGE` env var (default: 's3'). Determines whether S3BlobStore or WebdavBlobStore is instantiated.
```

---

## Gap 5: FileManager.test.js — 7 Failing Tests

**File:** `client/src/pages/__tests__/FileManager.test.js` (1139 lines)  
**Task:** 4.8i (client UI layer nodeId migration)

### Failure Root Causes

| # | Test Name | Line | Error | Root Cause |
|---|-----------|------|-------|------------|
| 1 | path navigation: clicking folder updates list | L375-446 | Cannot find "sub.txt" | Explorer navigation mock doesn't trigger `loadFiles` for new nodeId after double-click. MSW handler routing may not match nodeId-based request. |
| 2 | bulk download flow | L610-664 | 400 response, not matching `/complete\|done\|downloading/i` | MSW handler at L625-634 expects `{ paths }` in body but test sends `{ nodeIds }`. Handler signature needs update. |
| 3 | create folder flow | L762-801 | `createFolderPath` is undefined | MSW handler for `/api/folders/create` never fires — likely because the request payload shape changed from `{ path }` to `{ parentNodeId, name }`. |
| 4 | upload flow no conflict | L807-851 | Expected `/testuser/`, received `"/"` | Upload target defaults to root. Test navigates to `/files` (root) instead of `/files/testuser`, so the `parentNodeId` resolves to root. Fix test navigation or MSW handler. |
| 5 | upload flow with conflict | L857-916 | Cannot find "Skip duplicates" button | Conflict dialog never opens — `check-conflicts` endpoint may not be triggered in nodeId-based upload flow, or the MSW handler doesn't match the new request shape. |
| 6 | download: context menu Download | L923-958 | Expected `"/testuser/test.txt"`, received `null` | Test asserts on `url.searchParams.get('path')` but downloads now use `?nodeId=...`. Assertion needs to check for nodeId parameter instead. |
| 7 | permission request | L1027-1091 | pointer-events: none on button | ShareTargetDialog renders the "Request read permission" button as disabled because nodeId-based data doesn't populate the dialog's internal state (missing `ownerExists` flag or incorrect permission check response). |

### Required Fixes

Each fix targets either the **MSW handler** (to match new API shape) or the **test assertion** (to expect nodeId instead of path):

1. **Test #2 (bulk download):** Update MSW handler at line 625-634 to match `{ nodeIds: [...] }` body instead of `{ paths: [...] }`.

2. **Test #3 (create folder):** Update MSW handler for `/api/folders/create` to accept `{ parentNodeId, name }` body shape. The current handler likely matches on `path` in the request body.

3. **Test #4 (upload path):** Either navigate test to correct URL (`/files/testuser`) before upload, or adjust assertion to match root-level upload path.

4. **Test #5 (conflict):** Verify that `check-conflicts` MSW handler matches the new nodeId-based payload: `{ operations: [{ sourceNodeId, destinationParentNodeId }] }`.

5. **Test #6 (download context menu):** Change assertion from `url.searchParams.get('path')` to `url.searchParams.get('nodeId')`. The captured value should be a numeric string matching the test file's nodeId.

6. **Tests #1 and #7:** Investigate the MSW handlers in `client/src/mocks/handlers.js` for routing patterns that may not match the new API shapes. The handlers file was confirmed to use nodeId (from previous investigation), but specific handler bodies may need adjustment for these edge cases.

### Verification

After fixes:
```bash
npm run test -w client -- --testPathPattern="FileManager" 2>&1 | tail -30
```

Expected: All 7 previously failing tests pass, total 19/19.

---

## Execution Order

The gaps should be resolved in this order to minimize cascading changes:

```
Gap 4 (Spec docs)     → No code risk, can be done anytime
                      ↓
Gap 2 (Unused imports) → Trivial cleanup, no behavior change
                      ↓
Gap 1 (fileService permission helpers) → May have callers; audit first
                      ↓
Gap 5 (FileManager test fixes)         → Depends on Gap 1 if any failing test uses permission helpers
                      ↓
Gap 3 (Route test WebDAV mock replacement) → Independent of client changes
```

---

## Summary Table

| Gap | File(s) | Lines Affected | Effort | Risk |
|-----|---------|----------------|--------|------|
| 1. Permission helpers | `client/src/services/fileService.js` | 485-507 (13 lines + callers) | Low — 5 function signatures | Medium — caller audit needed |
| 2. Unused imports | `client/src/services/explorerGateway.js` | 6 (1 line) | Trivial | None |
| 3a. files.test.js mock replacement | `server/domains/files/routes/__tests__/files.test.js` | 30-51, + download-multiple L463 | Medium — rewrite setup block | Low — tests already pass |
| 3b. folders.test.js mock replacement | `server/domains/files/routes/__tests__/folders.test.js` | 26-31, + beforeEach | Medium — same pattern as 3a | Low |
| 4a. client fileService spec | `docs/spec/client/services/fileService.md` | Full rewrite of signatures | Low — documentation only | None |
| 4b. folders route spec | `docs/spec/server/routes/folders.md` | Parameter sections | Low — parameter rename | None |
| 4c. composition root spec | New file: `docs/spec/server/service/composition.md` | ~50 lines new | Low | None |
| 5. FileManager test fixes | `client/src/pages/__tests__/FileManager.test.js` + MSW handlers | Multiple locations across 1139 lines | High — each failure needs individual diagnosis and fix | Medium — touch production UI code only if dialog state is wrong |

**Total remaining effort:** ~2-4 hours of focused work, no architectural changes needed.
