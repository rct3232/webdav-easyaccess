# Phase 4 — Wave 0 Rectification Work Order (pre-Wave-2)

## Purpose

Before Wave 2 can begin, the Wave-1 artifacts must be corrected so that the Wave-2
implementation and the Wave-1 test scaffolds/specs share ONE consistent contract.
This document is the single source of truth for that rectification. It is written so that
a fresh executor agent can perform all of the changes by reading **only this file** —
no other planning document is required to be re-read.

Each work item lists: `Location` (exact path:line), `Current state`, `Problem`,
`Required change`, and `Acceptance` (verification command / expected result).

Editing rules for the executor:
1. Follow the **canonical Contract Log** in this preamble. Any decision-log or contract
   statements written inside embedded Sections S1-S4 that disagree with the canonical
   Contract Log are superseded by the canonical log (the section authors used private
   numbering; the numbers here are authoritative).
2. TDD: where a section instructs updating a test file, update the test first, confirm it
   fails against the current source, then implement.
3. Doc-first: run the S1->S4 work items in order; S2 and S3 depend on S1 (blobStore
   `copyBlob`) and on each other's contracts, so fix contracts before code where shown.
4. Do not modify route files (`crud.js`, `batch.js`, `preview.js`, `folders.js`) in this
   rectification. See Contract D12.

---

## Canonical Contract Log (authoritative)

| ID | Owner | Decision (target contract) |
|----|-------|-----------------------------|
| D1 | S1 | `WebdavBlobStore` uses S3-uniform methods `uploadBlob/downloadBlob/deleteBlob/headBlob/listOrphanedKeys`; constructor takes a file-store adapter `webdavClient` (NOT a raw `{baseUrl,...}` config); `headBlob` maps `getFileMetadata().mime -> contentType`. WebdavBlobStore test must be rewritten to these names + adapter-shaped mock; 13 tests (4+3+3+3). |
| D2 | S1 | blobstore factory `createBlobStore()` is parameterless (reads `process.env.WEA_FILE_STORAGE || 's3'`); `webdav` -> `new WebdavBlobStore(createFileStoreAdapter())`; else S3 via existing `resolveS3Config()`. Remove `NoOpBlobStore` import+usage. Reconcile `blobstoreFactory.test.js`: remove the `NoOpBlobStore` test and the `createBlobStore({}) throws /webdav/i` test. |
| D3 | S1 | `S3BlobStore.copyBlob(sourceKey, destKey)` via `CopyObjectCommand`; propagate clear `NoSuchKey` error. Extend `S3BlobStore.test.js` mock `send()` switch for `CopyObjectCommand`. |
| D4 | S2 | `fileNodesStore.countActiveObjectsByS3Key(s3Key)` -> count of `object_map.status='active'` rows for that `s3_key` (SQLite+PG). |
| D5 | S2 | `createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode='s3', fileNodeService })`. Return set = `prepareUpload,completeUpload,downloadBlob,overwriteBlob,deleteBlob,getActiveS3Key,countActiveObjectsByS3Key,duplicateBlob,linkObject,ensureExclusiveBlob,uploadToWebdav,downloadBlobWebdav`. Both WebDAV methods exported in BOTH modes (NOT conditional). No `downloadFromWebdav` name. |
| D6 | S3 | `createFileService.copyFile(nodeId, destinationParentNodeId, newName, userId, user)` — **5 args**. Both `docs/spec/server/services/fileService.md` and `fileService.test.js` updated to 5 args. |
| D7 | S3 | File nodes use `aclService.checkFilePermission`; folders / move-destination / directory listing use `aclService.checkFolderPermission`. Applies to rename/delete/move-source/download (file) vs move-dest/list (folder per child type). |
| D8 | S4 | Define required file error codes. Cleanup: add the needed codes and align every `fileService` reference that currently points at wrong keys (`SERVER_MESSAGE_CODES.files.invalidPath/duplicateFile` are undefined at runtime). (Decision detail in S4.) |
| D9 | S3 | Expose `fileNodeService.getNode(nodeId)`; existence checks use `getNode`, not `getNodePath` null-guards (getNodePath never returns null). |
| D10 | S3 | `fileService.deleteNode` returns `{ deletedCount }` built from `fileNodeService.getDescendantIds(nodeId)`. `listDirectoryWithPermissions` maps child `updatedAt -> modifiedAt`. |
| D11 | S3 | `createBatchOperationService` = Wave-3 work; its 19-test scaffold stays RED in Wave-2, excluded from the Wave-2 gate; correct its spec test path (`server/service/__tests__` -> `domains/files/services/__tests__`). |
| D12 | S3 | Do NOT modify routes in this wave. Legacy path-based method surface of `fileService` stays exported & behavior-preserving so `crud.js` + `files.test.js` stay GREEN (PLAN Rule #2). New nodeId methods added alongside. Correct phase4-sub-plan-wave2.md claim (~L929) that `files.test.js` will break in Wave 2. |

> NOTE: The embedded Sections were written independently. If an embedded section
> contains its own "Decision Log" using D-numbers that differ from the table above,
> IGNORE that embedded log and use this canonical table.

---

## Table of Contents

- **S1 — Infrastructure / Blobstore rectification** (Adapted from `/tmp/opencode/rectify`): WebdavBlobStore, factory, S3BlobStore.copyBlob, tests. **D1, D2, D3**
- **S2 — blobStorageService + fileNodesStore + downloadService**: dual-backend contract, missing store method, spec alignment. **D4, D5** (and downloadService defer note)
- **S3 — fileService refactor + route/PLAN reconciliation**: nodeId contract, legacy surface, scaffold rewrite, batch deferral. **D6, D7, D9, D10, D11, D12**
- **S4 — Shared codes + spec-document normalization**: D8 + permission mapping + doc alignment.

---

## Execution order

1. Execute **S1** (infrastructure). Run S1 acceptance.
2. Execute **S2** (needs S1 `copyBlob`, D3). Run S2 acceptance.
3. Execute **S3** (needs S2 contract + D4/D9 store additions). Run S3 acceptance.
4. Execute **S4** (shared codes + docs alignment; independent, may run after S1).
5. Full-gate: `npm run test:ci -w server`.

Command note: `blobstore`/`service`/`domains/files/services` tests are NOT matched by
`test:unit` (utils|models|middleware) nor `test:integration` (routes). Use the plain
`test` script: `npm run test -w server -- --testPathPatterns="..." --no-coverage`.
Always use `--testPathPatterns` (Jest 30) — never the singular form.

---

<!-- S1 -->

---

<!-- S1-infra-blobstore -->

# Section S1: Infrastructure / Blobstore Rectification

Work-order fragment for the **blobstore** rectification. This section is standalone: an executor can apply every change below without reading any other document. It relies on the Unified Blobstore Contract (D1, D2, D3) restated inline.

## Contract restated (ground truth to target)

- **D1 — Webdav server method names**: `uploadBlob(filepath, buffer)`, `downloadBlob(filepath) -> Buffer|null`, `deleteBlob(filepath)` (idempotent on 404), `headBlob(filepath) -> {contentLength, contentType}|null`, `listOrphanedKeys() -> []`. Constructor is `new WebdavBlobStore(webdavClient)` where `webdavClient` is a file-store adapter exposing:
  - `putFileContents(path, buffer)` (returns Promise)
  - `getFileContents(path) -> Buffer`
  - `deleteFile(path, {isDirectory: false})`
  - `getFileMetadata(path) -> {size, lastmod, mime}`
  - `headBlob` must map `mime -> contentType` and `size -> contentLength`.
- **D2 — Factory** `server/infrastructure/adapters/blobstore/index.js` exports `createBlobStore()` (NO config arg; reads `process.env.WEA_FILE_STORAGE || 's3'`) and `resolveS3Config()`. `webdav` branch returns `new WebdavBlobStore(createFileStoreAdapter())` (imported from `../filestore`). `NoOpBlobStore` is removed from import and usage.
- **D3 — S3** `async copyBlob(sourceKey, destKey)` added to `S3BlobStore.js` using `CopyObjectCommand` from `@aws-sdk/client-s3`, propagating a clear error on `NoSuchKey`.

Verified facts used below (all confirmed by reading the files):
- `server/infrastructure/adapters/blobstore/WebdavBlobStore.js` does **NOT exist** (only its test exists). WI-A1 creates it.
- `@aws-sdk/client-s3` is a dependency (`server/package.json`: `"@aws-sdk/client-s3": "^3.1098.0"`). `CopyObjectCommand` is importable (confirmed present in `node_modules/@aws-sdk/client-s3/dist-cjs/index.js`).
- `server/testing/mocks/s3Mock.js:44` already implements `copyObject` (throws `new Error('NoSuchKey')` when source is absent).
- `server/infrastructure/adapters/filestore/index.js` already exports `createFileStoreAdapter()` which returns `WebdavFileStoreAdapter(webdav)` wrapping `utils/webdav`.
- `FileStoreAdapter.js:21` documents `getFileMetadata -> {size, lastmod, mime}`; `deleteFile(path, options)` where options `{isDirectory?: boolean}`.

---

## WI 1 — Rewrite `WebdavBlobStore.js` (create the class per D1)

- **Location**: `server/infrastructure/adapters/blobstore/WebdavBlobStore.js` (currently does not exist; must be created).
- **Current state**: File absent. The only artifact is the test scaffold at `server/infrastructure/adapters/blobstore/__tests__/WebdavBlobStore.test.js` (WI-A2 below), which today references a `{baseUrl, username, password}` config constructor and methods `uploadToWebdav/downloadFromWebdav/deleteOnWebdav/headOnWebdav`.
- **Problem**: No WebDAV blob-store implementation exists, and the intended contract (D1) uses an adapter-constructor (`(webdavClient)`) and unified method names (`uploadBlob/downloadBlob/deleteBlob/headBlob/listOrphanedKeys`).
- **Required change**: Create `WebdavBlobStore.js` with the exact source below.

```js
'use strict';

class WebdavBlobStore {
  constructor(webdavClient) {
    if (!webdavClient) {
      throw new Error('WebdavBlobStore requires a webdavClient file-store adapter');
    }
    this.webdav = webdavClient;
  }

  async uploadBlob(filepath, buffer) {
    if (!filepath) throw new Error('WebDAV filepath is required');
    if (!buffer || buffer.length === 0) throw new Error('Buffer is required');
    await this.webdav.putFileContents(filepath, buffer);
  }

  async downloadBlob(filepath) {
    try {
      const data = await this.webdav.getFileContents(filepath);
      return Buffer.isBuffer(data) ? data : Buffer.from(data);
    } catch (err) {
      if (this._isNotFound(err)) return null;
      throw err;
    }
  }

  async deleteBlob(filepath) {
    try {
      await this.webdav.deleteFile(filepath, { isDirectory: false });
    } catch (err) {
      if (this._isNotFound(err)) return;
      throw err;
    }
  }

  async headBlob(filepath) {
    try {
      const meta = await this.webdav.getFileMetadata(filepath);
      return {
        contentLength: meta.size,
        contentType: meta.mime,
      };
    } catch (err) {
      if (this._isNotFound(err)) return null;
      throw err;
    }
  }

  async listOrphanedKeys() {
    return [];
  }

  _isNotFound(err) {
    if (!err) return false;
    if (err.status === 404) return true;
    if (String(err.name).toLowerCase().includes('notfound')) return true;
    return String(err.message || '').includes('404');
  }
}

module.exports = WebdavBlobStore;
```

- **Acceptance / verification**: covered by WI-A2's 13 passing tests and the factory test in WI-A5.

---

## WI2 — Rewrite `WebdavBlobStore.test.js` (per D1) — 13 tests

- **Location**: `server/infrastructure/adapters/blobstore/__tests__/WebdavBlobStore.test.js` (full rewrite of the existing 176-line file).
- **Current state**: The existing file:
  - Line 3 imports `createWebdavMock` from `../../../../testing/mocks/webdavMock`;
  - Line 7 uses `jest.mock('../../../../utils/webdav', ...)` (raw-cors mock of the underlying module);
  - Lines 23-27 build a raw `{baseUrl, username, password}` config;
  - Lines 40, 79, 149 etc. call `new WebdavBlobStore(config)`;
  - Describes `uploadToWebdav` (4), `downloadFromWebdav` (3), `deleteOnWebdav` (3), `headOnWebdav` (3) = 13 tests.
- **Problem**: It tests the OLD method names and constructor, and mocks the raw `utils/webdav` module with a raw config. It will fail against the D1 implementation.
- **Required change**: Rewrite the file to construct `new WebdavBlobStore(adapterMock)` and test the D1 method names. It must NOT `jest.mock('../../../../utils/webdav', ...)` and must NOT import `createWebdavMock`. Keep exactly **13 tests** (4 upload + 3 download + 3 delete + 3 head).

**Mock adapter factory** (define at top of the test file):

```js
function createAdapterMock(overrides = {}) {
  return {
    putFileContents: jest.fn().mockResolvedValue(undefined),
    getFileContents: jest.fn().mockResolvedValue(Buffer.from('file content')),
    deleteFile: jest.fn().mockResolvedValue({ success: true }),
    getFileMetadata: jest.fn().mockResolvedValue({
      size: 12,
      lastmod: '2024-01-01T00:00:00.000Z',
      mime: 'text/plain',
    }),
    ...overrides,
  };
}
```

In `describe('WebdavBlobStore')` use `let adapterMock;` and in `beforeEach` do `adapterMock = createAdapterMock();` and `WebdavBlobStore = require('../WebdavBlobStore');`. Every instantiation is `new WebdavBlobStore(adapterMock);`.

**Exact 13 test list to produce (describe / it titles):**

`describe('uploadBlob')`:
1. `'uploads buffer to WebDAV path via putFileContents successfully'` — assert `adapterMock.putFileContents` called with `('/remote/path/file.txt', data)`.
2. `'throws descriptive error for empty/null/undefined filepath'` — rejects on `''`, `null`, `undefined` filepath.
3. `'throws descriptive error for null or empty buffer'` — rejects on `null`, `undefined`, `Buffer.from('')`.
4. `'propagates WebDAV server errors with original message'` — `adapterMock.putFileContents.mockRejectedValue({status: 503, message: 'Server error: 503 Service Unavailable'})`; rejects.toThrow().

`describe('downloadBlob')`:
5. `'retrieves content and returns Buffer'` — `adapterMock.getFileContents.mockResolvedValue(Buffer.from('test file data'))`; assert result is `Buffer` and equal to input; assert called with path.
6. `'returns null for 404 (file not found)'` — `getFileContents.mockRejectedValue({status: 404})`; assert `result === null`.
7. `'throws on non-404 HTTP errors'` — `getFileContents.mockRejectedValue({status: 500})`; rejects.toThrow().

`describe('deleteBlob')`:
8. `'deletes resource successfully'` — assert `adapterMock.deleteFile` called with `('/remote/path/file.txt', { isDirectory: false })`.
9. `'is idempotent for already-deleted resources (404 -> no throw)'` — `deleteFile.mockRejectedValue({status: 404})`; `resolves.not.toThrow()`.
10. `'propagates server errors'` — `deleteFile.mockRejectedValue({status: 500})`; rejects.toThrow().

`describe('headBlob')`:
11. `'returns { contentLength, contentType } mapping mime->contentType'` — seed `getFileMetadata.mockResolvedValue({size: 42, lastmod: '...', mime: 'image/png'})`; assert `meta.contentLength === 42` and `meta.contentType === 'image/png'`.
12. `'returns null for 404'` — `getFileMetadata.mockRejectedValue({status: 404})`; assert `null`.
13. `'throws on non-404 HTTP errors'` — `getFileMetadata.mockRejectedValue({status: 502})`; rejects.toThrow().

- **Acceptance**: `npm run test -w server -- --testPathPatterns="WebdavBlobStore" --no-coverage` → 13 passed, 0 failed.

---

## WI3 — Add `copyBlob` to `S3BlobStore` (+ mock switch + tests)

- **Location**: `server/infrastructure/adapters/blobstore/S3BlobStore.js`. Test file: `server/infrastructure/adapters/blobstore/__tests__/S3BlobStore.test.js`.
- **Current state**: `S3BlobStore.js` has `uploadBlob/downloadBlob/deleteBlob/headBlob/listOrphanedKeys` (lines 15-86); there is **no** `copyBlob`. The import line 3 is:
  `const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');`
  Test mock switch at `S3BlobStore.test.js:21-31` handles `PutObjectCommand/GetObjectCommand/DeleteObjectCommand/HeadObjectCommand/ListObjectsV2Command` and throws `Unknown command` otherwise.
- **Problem**: The S3 adapter lacks copy support; the test mock will throw `Unknown command` for any copy command.
- **Required change**:

1. In `S3BlobStore.js:3`, add `CopyObjectCommand` to the destructured import:
   `const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command, CopyObjectCommand } = require('@aws-sdk/client-s3');`

2. Add this method to `S3BlobStore` (place after `headBlob`, before `listOrphanedKeys`):

```js
  async copyBlob(sourceKey, destKey) {
    try {
      await this.client.send(new CopyObjectCommand({
        Bucket: this.bucket,
        CopySource: `${this.bucket}/${sourceKey}`,
        Key: destKey,
      }));
    } catch (err) {
      if (err.name === 'NoSuchKey' || String(err.message || '').includes('NoSuchKey')) {
        throw new Error(`Source key not found for copy: ${sourceKey}`);
      }
      throw err;
    }
  }
```

3. In `S3BlobStore.test.js:21-31` add a handler line to the mock `send()` switch:
   `if (cmdName === 'CopyObjectCommand') return currentMockS3.copyObject(command);`
   (Place it after the `HeadObjectCommand` line and before the thrown `Unknown command` fallback.)

4. Add a `describe('copyBlob')` block with these tests:

```js
  describe('copyBlob', () => {
    it('copies object to a new key via CopyObjectCommand', async () => {
      currentMockS3.putObject({ Bucket: 'test-bucket', Key: 'src-key', Body: Buffer.from('data'), ContentType: 'text/plain' });

      const store = new S3BlobStore(config);
      await store.copyBlob('src-key', 'dest-key');

      const dest = currentMockS3.getStore().get('dest-key');
      expect(dest).toBeDefined();
      expect(dest.Body).toEqual(Buffer.from('data'));
    });

    it('throws clear error when source key is missing (NoSuchKey)', async () => {
      const store = new S3BlobStore(config);
      await expect(store.copyBlob('missing-src', 'dest-key')).rejects.toThrow(/source key not found/i);
    });
  });
```

  Note: the shared mock's `copyObject` (`s3Mock.js:44-59`) throws `new Error('NoSuchKey')` when the source is absent and stores the copy otherwise, which satisfies both assertions. Do NOT rewrite `s3Mock.js`.
- **Acceptance**: copyBlob 2 new tests pass under the WI-A6 command; existing method tests (upload/download/delete/head/list) remain green (their command branches are untouched).

---

## WI4 — Update `blobstore/index.js` factory (per D2)

- **Location**: `server/infrastructure/adapters/blobstore/index.js`.
- **Current state**: 
  - Line 4 imports `NoOpBlobStore`; 
  - `createBlobStore()` (lines 30-39) has no args, reads `WEA_FILE_STORAGE`, and for `webdav` returns `new NoOpBlobStore()`.
- **Problem**: `webdav` returns NoOp and imports an obsolete class (D2). No resource is stored.
- **Required change**: Replace the whole file body with the D2 factory (`createBlobStore()` takes NO config arg). `resolveS3Config()` must be preserved unchanged.

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

- **Acceptance**: on `WEA_FILE_STORAGE=webdav`, `createBlobStore()` returns an instance whose `constructor.name === 'WebdavBlobStore'`, constructed via `createFileStoreAdapter()` (asserted by WI-A5). `resolveS3Config` behavior unchanged.

---

## WI5 — Reconcile `blobstoreFactory.test.js` (per D2)

- **File**: `server/infrastructure/adapters/blobstore/__tests__/blobstoreFactory.test.js` (132 lines). Uses `jest.resetModules()` and a real `require('../index')`; no `jest.mock` of the store modules. Current total = 11 tests.
- **Problem**: (a) The NoOp test will fail because `NoOpBlobStore` is removed; (b) the `createBlobStore({})` webdav-throw test calls `createBlobStore({})` with an argument and expects a `/webdav/i` throw, but the new factory reads only env and never throws in unit scope for `webdav`.
- **Required changes**:

  **Remove these two describe/it blocks** (they must be deleted):
  - `'returns NoOpBlobStore when WEA_FILE_STORAGE=webdav'` — currently at lines 34-42 (inside `describe('createBlobStore')`). REMOVE.
  - `'throws clear error when WEA_FILE_STORAGE=webdav but no webdavClient provided'` — currently at lines 106-112 (inside `describe('createBlobStore — WebDAV mode')`). REMOVE (this is the `createBlobStore({})` `/webdav/i` throw test).

  **Keep unchanged** (do not touch these `it`s):
  - `describe('createBlobStore')`:
    - `'returns S3BlobStore when WEA_FILE_STORAGE=s3'` (line 24)
    - `'defaults to S3BlobStore when WEA_FILE_STORAGE is empty or undefined'` (line 44)
  - `describe('resolveS3Config')` (all 4 tests, lines 55-92) — keep intact.
  - `describe('createBlobStore — WebDAV mode')`:
    - `'returns WebdavBlobStore instance when config.fileStorageMode is "webdav"'` (line 96) — KEEP; must still pass because `createBlobStore()` now returns `new WebdavBlobStore(...)`.
    - `'returns S3BlobStore instance when config.fileStorageMode is "s3" (existing behavior preserved)'` (line 114) — KEEP.
    - `'validates required S3 keys are present when mode is "s3" (existing behavior preserved)'` (line 123) — KEEP.

  **No new tests are required.**

- **Final expected test count**: 11 − 2 removed = **9 tests**.
- **Acceptance**: run WI-A6 command; `blobstoreFactory` reports **9 passed, 0 failed**.
- **Note**: Because the kept WebDAV test uses a real `require` chain (`../index` → `../filestore` → `utils/webdav`), no mocking of `utils/webdav` is done in this file — it remains valid since `webdav` resolution doesn't hit the network at construction.

---

## WI6 — Verification commands and expected pass counts

- **Command** (run from `server/`): use the plain `test` script, NOT `test:unit`. `test:unit` restricts Jest to `**/(utils|models|middleware)/**/*.test.js`, so it would skip these adapter tests. Use:

```bash
cd server
NODE_OPTIONS=--max-old-space-size=8192 npx jest --testPathPattern="WebdavBlobStore|S3BlobStore|blobstoreFactory" --no-coverage
```

or equivalently:

```bash
cd server
npm run test -- --testPathPattern="WebdavBlobStore|S3BlobStore|blobstoreFactory" --no-coverage
```

(The confirmation command specified in the task: `npm run test -w server -- --testPathPatterns="..." --no-coverage` is equivalent; note the workspace runner flags affect only how it is inviked, the test selector is the same.)

- **Expected pass counts**:
  - `WebdavBlobStore.test.js`: **13 passed, 0 failed** (4 upload + 3 download + 3 delete + 3 head).
  - `S3BlobStore.test.js`: 11 existing tests (3 upload + 1 download + 2 delete + 2 head + 3 listOrphaned) **plus 2 new `copyBlob` tests** → **13 passed, 0 failed** (11 existing + 2 copyBlob = 13).
  - `blobstoreFactory.test.js`: **9 passed, 0 failed** (down from 11 after removal of the NoOp test and the webdav-config-throw test).

- **Total**: `WebdavBlobStore(13) + S3BlobStore(13) + blobstoreFactory(9) = 35 passed, 0 failed`.

- **Success criteria (overall for S-A)**:
  1. `WebdavBlobStore.js` exists and exports a class constructed with a webdav-client adapter, exposing `uploadBlob/downloadBlob/deleteBlob/headBlob/listOrphanedKeys`; `headBlob` maps `size->contentLength`, `mime->contentType`. (S-A-WI1)
  2. `WebdavBlobStore.test.js` has exactly 13 green tests, constructs `new WebdavBlobStore(adapterMock)`, and contains no `jest.mock('../../../../utils/webdav')` and no `uploadedToWebdav/downloadFromWebdav/deleteOnWebdav/headOnWebdav` references. (S-A-WI2)
  3. `S3BlobStore.js` has `copyBlob(sourceKey, destKey)` via `CopyObjectCommand` with clear NoSuchKey error; the send-switch `Unknown command` branch no longer triggers for copy. (S-A-WI3)
  4. `blobstore/index.js` has `createBlobStore()` (no config arg) + `resolveS3Config()`; `webdav → new WebdavBlobStore(createFileStoreAdapter())`; `NoOpBlobStore` absent. (S-A-WI4)
  5. `blobstoreFactory.test.js` has 9 green tests; NoOp and `createBlobStore({})` webdav-throw tests are gone. (S-A-WI5)
  6. `npm run test` above reports 35 passed, 0 failed. (S-A-WI6)

---

<!-- S2-blobStorage -->

# Section S2 — blobStorageService, fileNodesStore, downloadService rectification

Project root: `/home/dev/repos/webdav-easyaccess`

This is the full rectification for **Section S2**. An executor agent must be able to make all
required edits from this document alone. Only the files listed below are in scope. No other source
files may be modified.

Scope
- `server/service/blobStorageService.js` (rewrite — WI-S2-1)
- `server/store/fileNodesStore.js` (add `countActiveObjectsByS3Key` — WI-S2-2)
- `docs/spec/server/services/blobStorageService.md` (correct spec — WI-S2-3)
- `server/service/downloadService` — NOTE ONLY, no code (WI-S2-4)

---

## 1. Ground truth (verified by reading)

### 1.1 `server/service/blobStorageService.js` (current, 66 lines)
- Factory `createBlobStorageService({ blobStore, fileNodesStore })`.
- Exports exactly 6 methods: `prepareUpload`, `completeUpload`, `downloadBlob`, `overwriteBlob`,
  `deleteBlob`, `getActiveS3Key`.
- `prepareUpload(fileNodeId)` -> `crypto.randomUUID()`, `upsertObjectMap(fileNodeId, key, 'pending')`,
  returns key.
- `completeUpload(s3Key, size, mimeType)` -> `getObjectMapByS3Key(s3Key)`; if missing throws
  `new Error('No object_map entry found for s3Key: ' + s3Key)`; else `activateObject(s3Key)` +
  `upsertCache(row.file_node_id, size, mimeType, null)`. This error message must not regress.
- `downloadBlob(fileNodeId)` -> `getActiveObject`; returns null if `!row || !row.s3_key`; else
  `blobStore.downloadBlob(row.s3_key)`.
- `overwriteBlob(fileNodeId, buffer)` -> orphan current active; `newS3Key = crypto.randomUUID()`;
  `blobStore.uploadBlob(newKey, buffer)`; `insertObject(fileNodeId, newKey, 'active')`; returns newKey.
- `deleteBlob(fileNodeId)` -> orphan current active object. No blobStore deletion.
- `getActiveS3Key(fileNodeId)` -> `row ? row.s3_key : null`.
- No `fileStorageMode`, no WebDAV.

### 1.2 `server/store/fileNodesStore.js`
Present object_map/filecache methods: `upsertObjectMap(fileNodeId, s3Key, status)`,
`insertObject(fileNodeId, s3Key, status)`, `getActiveObject(fileNodeId)`,
`getObjectMapByS3Key(s3Key)`, `activateObject(s3Key)`, `orphanObject(s3Key)`,
`upsertCache(fileNodeId, size, mimeType, contentHash)`, `deleteCache(fileNodeId)`.
- **Absent: `countActiveObjectsByS3Key`** (must be added).
- Every DB method has an `isPg` branch (Postgres `$1` placeholders, `storage.getPgPool().query`)
  and an SQLite branch (`?` placeholders, `storage.sqliteRun` / `storage.sqliteQuery`).
- The Public API `return { ... }` block starts near line 797; object_store exports end around
  line 818 with `orphanObject`.
- `object_map` columns used: `file_node_id`, `s3_key`, `storage_backend`, `version_number`, `status`
  (`'pending'` / `'active'` / `'orphaned'`).

### 1.3 `server/service/fileNodeService.js`
- Current exports: `createFile`, `createDirectory`, `renameNode`, `moveNode`, `deleteNode`,
  `listDirectory`, `getNodePath`, `resolvePath`, `getDescendantIds`, `updateSyncStatus`.
- **Does NOT export `getNode`.**
- `getNodePath(nodeId)` returns a string, always non-null (e.g. `'/a/b'` or `'/'`).
- `deleteNode` returns `undefined`.
- `fileNodesStore` does expose `getNode(nodeId)` (used internally by `getNodePath`).

> Precondition P1: the target `blobStorageService` guards by calling `fileNodeService.getNode(nodeId)`.
> Since `fileNodeService` does not currently export `getNode`, this precondition must be satisfied
> before the WebDAV guards run. Resolve it by adding a thin forwarding to `fileNodeService.js`
> (step 5.2). If a getNode already exists at execution time, skip that step.

### 1.4 Tests
- `server/service/__tests__/blobStorageService.test.js`: 14 `it()` cases, all S3-compatible;
  they call `createBlobStorageService` WITHOUT `fileStorageMode` (defaults to `'s3'`). Includes
  `completeUpload` rejection with `/No object_map entry found/`. All 14 must stay green.
- `server/store/__tests__/fileNodesStore.test.js`: has `describe('object_map', ...)` with
  `const testPrefix = 'obj-'` and `afterEach` cleanup on `name LIKE 'obj-%'`. New tests reuse
  `testPrefix`.

### 1.5 `copyBlob` dependency (from S1)
- `blobStore.copyBlob(sourceKey, destKey)` does NOT yet exist in this repo (grep has no hits). It is
  delivered by S1 on `S3BlobStore`. The target code below CALLS `blobStore.copyBlob(...)`. If S1 is
  not merged, the `duplicateBlob`/`ensureExclusiveBlob` S3 branches cannot be exercised; other
  branches still run. Building `copyBlob` is out of S2 scope.

### 1.6 Wave-2 reference
`phase4-sub-plan-wave2.md` Task W2.2 (lines 246-455) defines the dual-backend intent. This section
reproduces that intent but the DECISIONS (Section 2) override it: both WebDAV methods are exported
in both modes; guard on `fileNodeService.getNode`; `uploadToWebdav(fileNodeId, buffer, mimeType)`.

---

## 2. DECISIONS (authoritative target)

- **D4** — Add `countActiveObjectsByS3Key(s3Key) -> integer` to `fileNodesStore`. It COUNTs
  `object_map` rows whose `status = 'active'` for that `s3_key`. SQL and tests in WI-S2-2.
- **D5** — `createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService })`.
  The returned object MUST export ALL of:
  `prepareUpload`, `completeUpload`, `downloadBlob`, `overwriteBlob`, `deleteBlob`,
  `getActiveS3Key`, `countActiveObjectsByS3Key`, `duplicateBlob`, `linkObject`,
  `ensureExclusiveBlob`, `uploadToWebdav`, `downloadBlobWebdav`.
  Both WebDAV methods are exported in BOTH modes (NOT conditional). There is NO `downloadFromWebdav`
  name. WebDAV methods resolve the path via `fileNodeService.getNodePath(nodeId)` but MUST guard on
  node existence via `fileNodeService.getNode(nodeId)` (because `getNodePath` never returns null); if
  the node is missing return `null`.

Dispatch table (method, S3 vs WebDAV):

| Method | S3 mode | WebDAV mode |
|--------|---------|-------------|
| `prepareUpload(fileNodeId)` | upsert pending object_map -> return s3Key | returns `null` (synchronous) |
| `completeUpload(s3Key,size,mimeType)` | getObjectMapByS3Key (throw if missing) -> activate -> upsertCache | throws `completeUpload is not applicable in WebDAV mode` |
| `downloadBlob(fileNodeId)` | active s3_key -> `blobStore.downloadBlob(key)` | delegates to `downloadBlobWebdav(fileNodeId)` |
| `overwriteBlob(fileNodeId,buffer)` | orphan old, upload new, insert active | delegates to `uploadToWebdav(fileNodeId, buffer)` |
| `deleteBlob(fileNodeId)` | orphan current active | resolve path (guard node), `blobStore.deleteBlob(path)` |
| `getActiveS3Key(fileNodeId)` | active s3_key or null | always `null` |
| `countActiveObjectsByS3Key(s3Key)` | `fileNodesStore.countActiveObjectsByS3Key` | returns `0` |
| `duplicateBlob(sourceS3Key)` | `blobStore.copyBlob(source, newKey)` -> newKey | throws `duplicateBlob is not applicable in WebDAV mode` |
| `linkObject(fileNodeId,s3Key)` | `fileNodesStore.insertObject(fileNodeId, s3Key, 'active')` | throws `linkObject is not applicable in WebDAV mode` |
| `ensureExclusiveBlob(fileNodeId)` | if count>1: duplicate + orphan + insert active -> newKey; else active key | returns `null` |
| `uploadToWebdav(fileNodeId,buffer,mimeType)` | n/a | resolve path -> `blobStore.uploadBlob(path,buffer)` -> `upsertCache(fileNodeId, buffer.length, mimeType, null)` |
| `downloadBlobWebdav(fileNodeId)` | n/a | guard node -> `blobStore.downloadBlob(path)` or null |

Exact WebDAV throw messages:
- `completeUpload` -> `'completeUpload is not applicable in WebDAV mode'`
- `duplicateBlob` -> `'duplicateBlob is not applicable in WebDAV mode'`
- `linkObject` -> `'linkObject is not applicable in WebDAV mode'`

---

## 3. FULL TARGET SOURCE — `server/service/blobStorageService.js`

Replace the entire current file with:

```js
'use strict';

const crypto = require('crypto');

/**
 * Factory: create a blob-storage lifecycle service bound to one backend pair.
 *
 * @param {Object} opts
 * @param {Object} opts.blobStore - S3BlobStore or WebDAV blob store. Exposes uploadBlob,
 *   downloadBlob, deleteBlob; S3 additionally uses copyBlob.
 * @param {Object} opts.fileNodesStore - data access for object_map + filecache.
 * @param {'s3'|'webdav'} [opts.fileStorageMode='s3'] - backend mode.
 * @param {Object} [opts.fileNodeService] - needed in WebDAV mode; exposes getNode(nodeId)
 *   and getNodePath(nodeId).
 */
function createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService }) {
  const isWebdavMode = fileStorageMode === 'webdav';

  async function prepareUpload(fileNodeId) {
    if (isWebdavMode) {
      return null;
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
      const nodePath = await resolveWebdavPathOrNull(fileNodeId);
      if (nodePath !== null) {
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
      return null;
    }
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    return row ? row.s3_key : null;
  }

  async function countActiveObjectsByS3Key(s3Key) {
    if (isWebdavMode) {
      return 0;
    }
    return fileNodesStore.countActiveObjectsByS3Key(s3Key);
  }

  async function duplicateBlob(sourceS3Key) {
    if (isWebdavMode) {
      throw new Error('duplicateBlob is not applicable in WebDAV mode');
    }
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
      return null;
    }
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

  /**
   * Resolve a WebDAV path for a file node, guarding on node existence.
   * @returns {Promise<string|null>} path, or null when the node is missing.
   */
  async function resolveWebdavPathOrNull(fileNodeId) {
    if (!fileNodeService) {
      return null;
    }
    const node = await fileNodeService.getNode(fileNodeId);
    if (!node) {
      return null;
    }
    return fileNodeService.getNodePath(fileNodeId);
  }

  async function downloadBlobWebdav(fileNodeId) {
    const nodePath = await resolveWebdavPathOrNull(fileNodeId);
    if (nodePath === null) {
      return null;
    }
    return blobStore.downloadBlob(nodePath);
  }

  async function uploadToWebdav(fileNodeId, buffer, mimeType) {
    const nodePath = await resolveWebdavPathOrNull(fileNodeId);
    if (nodePath === null) {
      return null;
    }
    await blobStore.uploadBlob(nodePath, buffer);
    await fileNodesStore.upsertCache(fileNodeId, buffer.length, mimeType || null, null);
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
    uploadToWebdav,
    downloadBlobWebdav,
  };
}

module.exports = { createBlobStorageService };
```

Notes:
- `isWebdavMode = fileStorageMode === 'webdav'`; default mode is `'s3'`, so existing S3 tests
  (which omit `fileStorageMode`) behave unchanged.
- `completeUpload` keeps the exact S3 message `'No object_map entry found for s3Key: ' + s3Key`.
- WebDAV paths are resolved via `resolveWebdavPathOrNull`, which calls `getNode` first (guard) then
  `getNodePath`. `uploadToWebdav` passes the caller-supplied `mimeType` (or null) to `upsertCache`.
- There is no `downloadFromWebdav` symbol anywhere.

---

## 4. Work items

### WI-S2-1: Rewrite blobStorageService (recap)
- **Location:** `server/service/blobStorageService.js`
- **Current state:** 6 S3-only methods, no `fileStorageMode`, no header service hooks.
- **Problem:** does not conform to D4/D5; both-mode dispatch and the 12-method export set missing.
- **Required change:** replace the file with the target source in Section 3; then satisfy the
  `getNode` precondition (step 5.2).
- **Acceptance:** `blobStorageService.test.js` (14 S3 cases) stays green, including
  `rejects.toThrow(/No object_map entry found/)`. The returned object exposes the exact 12 names in
  D5. For `duplicateBlob`/`ensureExclusiveBlob`, provide a stub `fileStore.copyBlob` (from S1) in
  tests; if S1 is not merged those branches cannot run and are out of S2 scope.

### WI-S2-2: Add `countActiveObjectsByS3Key` to `fileNodesStore`
- **Location:** `server/store/fileNodesStore.js` (object_map section + Public API export)
- **Current state:** method absent (Section 1.2).
- **Problem:** `countActiveObjectsByS3Key` dispatch and `ensureExclusiveBlob` barrier need a
  store-level count.
- **Required change:** add the method (Section 4.1 below) and register it (4.2).
- **Acceptance:** store unit tests pass (test names in 4.3); returns `0`/`N` Number.

#### 4.1 Method body — insert after `orphanObject`, before the `filecache` section

```js
  async function countActiveObjectsByS3Key(s3Key) {
    if (isPg) {
      try {
        const pool = storage.getPgPool();
        const res = await pool.query(
          `SELECT COUNT(*)::int AS count FROM object_map WHERE s3_key = $1 AND status = 'active'`,
          [String(s3Key)]
        );
        return Number(res.rows[0].count);
      } catch (error) {
        throw mapDatabaseError(error);
      }
    }

    try {
      const res = await storage.sqliteQuery(
        `SELECT COUNT(*) AS count FROM object_map WHERE s3_key = ? AND status = 'active'`,
        [String(s3Key)]
      );
      return Number(res.rows[0].count);
    } catch (error) {
      throw mapDatabaseError(error);
    }
  }
```

Returns a Number: 0 when no rows, or the count of `active` rows for the `s3_key`. Orphaned/pending
rows are excluded.

#### 4.2 Public API registration
In the `return { ... }` of `fileNodesStore` add after `orphanObject,`:

```js
    countActiveObjectsByS3Key,
```

#### 4.3 Store test names — add inside `describe('object_map')` in
`server/store/__tests__/fileNodesStore.test.js`, reusing `testPrefix`:
- `it('returns 0 when no active objects exist for an s3 key', ...)`
- `it('counts a single active object for an s3 key', ...)`
- `it('counts multiple active rows sharing the same s3 key', ...)`
- `it('excludes orphaned rows from countActiveObjectsByS3Key', ...)`

### WI-S2-3: Correct the spec doc
- **Location:** `docs/spec/server/services/blobStorageService.md`
- **Current state:** factory §2.2 takes `{ blobStore, fileNodesStore, webdavClient, fileNodeService,
  fileStorageMode }`; the §2.2 `return { ... }` lists WebDAV adapter methods `uploadToWebdav(webdavPath,...)`,
  `downloadFromWebdav`, `deleteOnWebdav`, `headOnWebdav`; `webdavClient` referenced; no `getNode` guard.
- **Problem:** contradicts D5 (WebDAV adapter methods are not service methods; `webdavClient` is removed).
- **Required change:**
  1. §2.2 signature must become
     `function createBlobStorageService({ blobStore, fileNodesStore, fileStorageMode = 's3', fileNodeService })`
     (remove `webdavClient`).
  2. Replace the §2.2 `return { ... }` list with the 12 service methods of D5 (incl.
     `downloadBlobWebdav(fileNodeId)` and `uploadToWebdav(fileNodeId, buffer, mimeType)`). Do NOT
     list `downloadFromWebdav`, `deleteOnWebdav`, `headOnWebdav`.
  3. §3 WebDAV section: define `downloadBlobWebdav(fileNodeId)` and
     `uploadToWebdav(fileNodeId, buffer, mimeType)` and note the node-existence guard via
     `fileNodeService.getNode(fileNodeId)` (return null when missing).
  4. Remove all `webdavClient` references.
- **Acceptance:** the spec contains no `webdavClient` and no `downloadFromWebdav`; §2.2 method list
  exactly matches D5.

### WI-S2-4: downloadService is Wave-4.2 — NO CODE
- **Location:** `server/service/downloadService.js` and its spec (future).
- **Current state:** `createDownloadService` is NOT built; not part of S2.
- **Required change:** none. Do NOT design or implement it here.
- **Documented for the future (D5/D2 mapping):** the planned Wave-4.2 `createDownloadService`
  should depend on `blobStorageService`'s `downloadBlob(fileNodeId)` (S3) and
  `downloadBlobWebdav(fileNodeId)` (WebDAV), built on this section's D4/D5 work.
- **Acceptance:** no `downloadService` code or spec was created or modified.

---

## 5. Precondition P1 — expose `getNode` on `fileNodeService` (companion)

Location: `server/service/fileNodeService.js`. Only if `getNode` is not already exported (currently
not), forward to the store and add to the returned object:

```js
  async function getNode(nodeId) {
    return fileNodesStore.getNode(nodeId);
  }
```

and add `getNode,` to the `return { ... }` list (e.g. next to `getNodePath`). This is required by the
`blobStorageService` WebDAV guards in D5. Skip if already available.

---

## 6. Success criteria and acceptance commands (from repo root; `server/` is the package root)

1. Targeted unit tests (service + store):
   ```bash
   npm run test -w server -- --testPathPatterns="blobStorageService|fileNodesStore" --no-coverage
   ```
2. Full server suite:
   ```bash
   npm run test:ci -w server
   ```
3. Existing `blobStorageService.test.js` (14 S3 cases) stays green — including
   `rejects.toThrow(/No object_map entry found/)` (error message must not regress).

Per-WI acceptance:
- WI-S2-1: 12-method export set; S3 tests green; dispatch per table; WebDAV throws exact messages.
- WI-S2-2: `countActiveObjectsByS3Key` returns Number; store tests for 0/1/N + orphan exclusion pass.
- WI-S2-3: spec has no `webdavClient` / `downloadFromWebdav`; §2.2 list exactly D5.
- WI-S2-4: no downloadService code/spec touched.

---
*End of Section S2.*

---

<!-- S3-fileService-routes -->

# Section S3 — fileService refactor contract + route/PLAN-rule reconciliation

Work-order fragment. Executes against repo root `/home/dev/repos/webdav-easyaccess`.
Source files MAY NOT be modified by this fragment's authors; the executor edits them using
ONLY the instructions below. All file:line references were captured against the current tree.

---

## 1. Preamble

### 1.1 Purpose

This is Section S3 of the Phase 4 nodeId-refactor plan. Contracts D1–D12 from the orchestration
prelude are already decided; this section encodes the **fileService refactor** (WI-A), the
**fileService test-scaffold reconciliation** (WI-B), the **fileService spec alignment** (WI-C),
and the **batchOperationService deferral** (WI-D). It also corrects an erroneous claim inside
`phase4-sub-plan-wave2.md` (the "files.test.js will break during Wave 2" claim) per Decision D12.

### 1.2 Governing rule

PLAN.md **Execution Rule #2 — "No net behavior change per public API"**. The legacy path-based
surface consumed by the route handlers and by `server/domains/files/routes/__tests__/files.test.js`
**must remain exported and behavior-preserving during Wave 2**. NodeId methods are added *alongside*
the legacy methods; the legacy methods are the ones routes and `files.test.js` still call.

### 1.3 Decisions already fixed (carried forward, not re-litigated)

- D6 — `createFileService.copyFile` signature is 5 args: `(nodeId, destinationParentNodeId, newName, userId, user)`.
- D7 — permission ACL mapping: `renameNode`/`deleteNode`/`move-source`/`download` → `aclService.checkFilePermission`; `move-dest` and directory `listDirectoryWithPermissions` and per-dir children → `checkFolderPermission`; per-child permission follows `type` (file → `checkFilePermission`, directory → `checkFolderPermission`).
- D9/D10 — `deleteNode` returns `{ deletedCount }` built from `getDescendantIds(nodeId).length`; existence confirmed via `fileNodeService.getNode` (a NodeJs resolver that **never** returns null for getNodePath); `listDirectoryWithPermissions` maps `updatedAt -> modifiedAt`.
- D12 — **KEY**: do NOT modify `crud.js`, `batch.js`, `preview.js`, or `files.test.js` in Wave 2. `crud.js` still constructs `createFileService()` at request time (see crud.js:138, 158, 200, 235) and calls only path-based methods. So "files.test.js will break" is WRONG; correct it.
- D11 — `batchOperationService` (factory `createBatchOperationService`) is Wave-3 work; the 19-test scaffold + spec path belong to Wave 3 and the scaffold stays RED (excluded from the Wave-2 gate).

---

## 2. Section WI-A — fileService.js refactor spec

### 2.1 File and goal

- File: `server/domains/files/services/fileService.js` (286 lines; factory `createFileService` at fileService.js:36, returns at fileService.js:278-283).
- Keep `createFileService` idempotent and backward-compatible. File path **must remain** `server/domains/files/services/fileService.js` (spec §2.1 currently wrong; see WI-C).

### 2.2 Immutable legacy surface (MUST remain intact, behavior-preserving)

Keep these exported with identical signatures and behavior; scaffold + routes + `files.test.js` depend on them:

| Method | Signature | Behavior to preserve |
|--------|-----------|---------------------|
| `listDirectoryWithPermissions` | `(principalId, folderPath, user, isShare)` | Path-based, `PermissionFacade` + per-item sync checkers (fileService.js:41-120). Returns `{...item, path, thumbnailUrl}...`. |
| `downloadFile` | `(filePath)` | `webdav.getFileContents(filePath)` (fileService.js:122-124). |
| `uploadFile` | `(user, folderPath, fileBuffer, originalFilename, relativePath, onConflict)` | `{ path }` / `{ path, skipped }`; conflict/permission flows (fileService.js:126-235). |
| `renameFile` | `(oldPath, newName)` | `{ path: newPath }` (fileService.js:237-276). |

**Exported alongside are the new nodeId methods (below).** `createFileService` DI surface gains
`fileNodeService`, `blobStorageService`, `uploadService`, `aclService`, `fileStorageMode` (defaults
divert nothing; old `webdav` opt still honored for legacy methods).

### 2.3 New nodeId method contract

Each new method is an addition; it does not replace a legacy method by name. NodeId dispatch:

| Method | Signature | Permission gate | S3 dispatch | WebDAV dispatch | Returns |
|--------|-----------|-----------------|-------------|-----------------|---------|
| `renameNode` | `(nodeId, newName, userId, user)` | non-admin → `checkFilePermission` if the node is a file | none (blob key decoupled) | best-effort WebDAV MOVE; on fail `updateSyncStatus(nodeId,'orphaned_node')`, do not abort DB rename | `{ nodeId, newName }` + validation (empty/contains `/` or `\`) and UNIQUE-conflict rethrow |
| `moveNode` | `(nodeId, newParentNodeId, userId, user)` | **source parent write + dest parent write** → **move-source on a file = `checkFilePermission`**, **move-dest = `checkFolderPermission`** | none (key decoupled) | best-effort MOVE; on fail mark moved node + descendants `orphaned_node`, do not abort | `{ nodeId, newParentId }` |
| `deleteNode` | `(nodeId, userId, user)` | non-admin → `checkFilePermission` for a file node being deleted | DB-only; `fileNodeService.deleteNode` cascade marks object_map orphaned | bottom-up `deleteBlob` per descendant, per-node `orphaned_node` on catch, DB delete proceeds | `{ deletedCount }` = `getDescendantIds(nodeId).length` |
| `copyFile` | `(nodeId, destinationParentNodeId, newName, userId, user)` — **5 args, D6** | read on source (`checkFilePermission`) + write on dest parent (`checkFolderPermission`) | COW via `blobStorageService` (see below) | `downloadBlob(nodeId)` then `uploadToWebdav(...)` | `{ sourceNodeId, copiedNodeId }` where relevant |
| `listDirectoryWithPermissions` (node filter) | `(userId, parentNodeId, user)` | per-item, non-blocking | via `fileNodeService.listDirectory` | — | array with `{ nodeId, name, type, size, mimeType, modifiedAt, hasReadPermission, hasWritePermission }` (`updatedAt -> modifiedAt`, D10) |
| `downloadFile` (node) | `(fileNodeId, userId, user)` | non-admin → `checkFilePermission(fileNodeId,'read')` | `blobStorageService.downloadBlob(fileNodeId)` | `blobStorageService.downloadBlob(fileNodeId)` | `Buffer`; if blob resolves null **throw not-found (D e)**. No `downloadFromWebdav`; that name does not exist (D d). |
| `uploadFile` (node) | `(userId, parentNodeId, name, buffer, mimeType, user, onConflict)` | non-admin → `checkFolderPermission(parentNodeId,'write')` | `uploadService.uploadFile(parentNodeId,name,buffer,mimeType)` → `{ nodeId, size, mimeType }` | (WebDAV) `createFile` then `blobStorageService.uploadToWebdav(nodeId, buffer)`; on PUT fail `updateSyncStatus(nodeId,'orphaned_node')`, rethrow | `{ nodeId, size, mimeType }` / `{ nodeId, skipped:true }` |

### 2.4 AWS proceedings of the copy node in `copyFile` (S3)

- Do NOT rewrite the COW helper here — `copyFileS3` is owned by Wave-3 Task W3.5 (`phase4-plan-wave2.md` line 842-844, 879). Wave-2 `copyFile` must still revert to existing `copy2 === 'S3'` mode; if the fileStorageMode is `webdav`, do a real blob copy through `blobStorageService` (reuse `createFile` / `downloadBlob` / `uploadToWebdav`).

### 3.5 Permission gate (D7) — authoritative mapping

| method/node | permission subject | ACL call |
|-------------|--------------------|----------|
| renameNode / file | file node itself | `checkFilePermission(userId, nodeId, 'write')` |
| deleteNode / file | file node itself | `checkFilePermission(userId, nodeId, 'write')` |
| moveNode — source | source parent | `checkFilePermission(userId, nodeId, 'write')` |
| moveNode — destination | destination parent | `checkFolderPermission(userId, newParentNodeId, 'write')` |
| downloadFile | file node | `checkFilePermission(userId, fileNodeId, 'read')` |
| uploadFile | destination parent | `checkFolderPermission(userId, parentNodeId, 'write')` |
| listDirectoryWithPermissions per-child | file children / dir children | `checkFilePermission` / `checkFolderPermission`(childNodeId, 'read'/'write') |
| move (files) — Dir children flags | directory child | `checkFolderPermission(childNodeId,...)` |

Admin bypass via `aclService.isAdminUser(user)` short-circuits all gates.

### 3.6 deleteNode counted-result (D9)

`deletedCount` = `(await fileNodeService.getDescendantIds(nodeId)).length`; confirm existence
first via `fileNodeService.getNode(nodeId)` (resolvers return node or throw; they are typed
non-null). The DB deletion itself remains delegated to `fileNodeService.deleteNode(nodeId)`.
Return `{ deletedCount: descendantIds.length }` (spec §2.3 deleteNode return shape).

### 3.7 listDirectory updatedAt -> modifiedAt (D10)

`listDirectoryWithPermissions` response items map `file_nodes.updated_at` into `modifiedAt`
and do **not** surface `updatedAt` in the nodeId return shape (it may remain on the raw child object).

---

## 4. Section WI-B — fileService.test.js scaffold updates

### 4.0 Invariants

- File: `server/domains/files/services/__tests__/fileService.test.js` (997 lines).
- Factory import: `const { createFileService } = require('../fileService');` — build every unit
  with the **real** `createFileService` under injected mocks (fileService.test.js:14, deps per test).
- **Keep exactly 33 tests** (do not add/remove). The scaffold is correct for the *future* Wave-2 target;
  Change test **names/calls** and any **over-assertions** to match the D6/D7/D9/D10/D-e contract.
- The scaffold text (fileService.test.js:3-12) states the tests fail pre-refactor — **that is
  stale and must be corrected**: the nodeId methods will exist post-refactor and tests target them.

### 4.2 Changes table (Test name | Current asserts | New required asserts)

| # | Test (describe / it) | Current asserts | New required asserts |
|---|----------------------|-----------------|----------------------|
| 1 | listDirectoryWithPermissions / "returns children with nodeId and permission flags..." (line 71) | ToMatchObject with `modifiedAt`; asserts `checkFilePermission(1,1,'read')` & `checkFolderPermission(1,2,'read')` | **Same** — already correct. Ensure mock child `updatedAt` maps to `modifiedAt`; keep both ACL assertions. |
| 2 | listDirectoryWithPermissions / "includes size and mimeType from filecache LEFT JOIN" (line 108) | size/mimeType/match (line 129-131) | No change. |
| 3 | listDirectoryWithPermissions / "sets hasReadPermission=false..." (line 134) | `checkFilePermission` toggling | No change. |
| 4 | listDirectoryWithPermissions / "admin bypass..." (line 164) | via `isAdminUser` bypass | No change. |
| 5 | listDirectoryWithPermissions / "returns empty array..." (line 196) | `toEqual([])` | No change (needs mock listDirectory → []/default). |
| 6 | listDirectoryWithPermissions / "throws 404 when parent nodeId missing" (line 215) | `toThrow()` | Keep; ensure not-found maps to notFoundError. |
| 7 | uploadFile S3 / "creates file_node via uploadService.uploadFile and returns new nodeId" (line 239) | `checkFolderPermission(1,5,'write')`, uploadService called, result `{nodeId:10}` | Unchanged (D7 matches). |
| 8 | uploadFile S3 / "sets sync_status=active..." (line 264) | result, uploadService invoked | Unchanged. |
| 9 | uploadFile S3 / "pending_upload if TX1 ok but blob fails" (line 288) | reject, upload call | Unchanged. |
| 10 | uploadFile S3 / "rolls back file_nodes..." (line 312) | reject | Unchanged. |
| 11 | uploadFile WebDAV / "creates file_node and performs synchronous WebDAV PUT" (line 339) | `uploadToWebDav('/uploads/hello.txt', buffer)`; `getNodePath(30)`; result {nodeId:30} | **Change**: drop `getNodePath` assert; assert `uploadToWebdav(nodeId, buffer)` (i.e. `blobStorageService.uploadToWebdav(30, Buffer)`) — **D d**. |
| 12 | uploadFile WebDAV / "orphaned-node if PUT fails after commit" (line 370) | `updateSyncStatus(31,'orphaned_node')` | **Keep** stopProp avoid asserting `getNodePath`. |
| 13 | downloadFile / "S3 via downloadBlob" (line 402) | `downloadBlob(10)` + return buffer | Unchanged. |
| 14 | downloadFile / "WebDAV via path resolution" (line 426) | `getNodePath(10)` + `downloadFromWebdav('/files/10/data.txt')` | **Rewrite: remove `getNodePath` and `downloadFromWebdav`; assert `blobStorageService.downloadBlob(10)` returns buffer** (D d). |
| 15 | downloadFile / "returns null when no active object_map" (line 453) | `result` toBeNull | **Rewrite: when `downloadBlob` returns null/notFound, expect `rejects.toThrow` (notFound) — D e.** |
| 16 | downloadFile / "permission denied non-admin" (line 475) | `checkFilePermission(1,10,'read')` | Unchanged. |
| 17 | renameNode / "updates name in DB only for S3" (line 499) | `checkFolderPermission` called | **Change `checkFolderPermission` → `checkFilePermission(userId, nodeId, 'write')` (D7).** `renameNode(10,'new')` unchanged. Result `{node:}/{new:}`: assert match `{nodeId:10,newName:'new'}`. |
| 18 | renameNode / "WebDAV MOVE, orphaned on failure" (line 523) | `getNodePath`, MOVE fail, orphaned, rename OK | **Drop `getNodePath`; assert `checkFilePermission` gate + `updateSyncStatus(10,'orphaned_node')` + `renameNode` called** (D7,D-d). Return not asserted (C). |
| 19 | renameNode / "throws empty/invalid newName" (line 556) | reject for empty and separators | Keep — no permission mock needs change to `checkFilePermission`. |
| 20 | renameNode / "throws if sibling conflict" (line 586) | reject on UNIQUE | Keep; assert `renameNode(10,'existing.txt')`. |
| 21 | moveNode / "updates parent_id..." (line 612) | `checkFolderPermission` called | **Two gates: `checkFilePermission` for move-source, `checkFolderPermission` for move-dest (D7). Assert both.** |
| 22 | moveNode / "no storage for S3" (line 635) | `moveNode(10,20)`, no deleteBlob/upload `rewrite` | **Same + assert gate calls.** |
| 23 | moveNode / "WebDAV orphaned on failure" (line 660) | `getNodePath` + orphaned | **Drop `getNodePath`; keep MOVE orphaned.** (D d) |
| 24 | moveNode / "rejects cycle" (line 692) | reject | Unchanged (cycle inside fileNodeService; do not re-derive descendant check here). |
| 25 | deleteNode / "deletes leaf after write-permission gate" (line 720) | `checkFolderPermission` called | **The deleted node is a file → assert `checkFilePermission` (D7).** `getDescendantIds(10)` → `{deletedCount:1}`. |
| 26 | deleteNode / "enumerates descendants via getDescendantIds" (line 744) | getDescendantIds(5) → {deletedCount:3} | Keep `expect(getDescendantIds).toHaveBeenCalled`; `{deletedCount:3}`; gate. **Add/assert `getNode(5)` existence → not null (D9).** |
| 27 | deleteNode / "WebDAV bottom-up, orphaned on phantom" (line 768) | bottom-up `deleteBlob(101/100)`, `updateSyncStatus(101,'orphaned')`, `deleteNode(100)`, {dc:2} | **Same; add `checkFilePermission` gate; drop `getNodePath` (D d). Do NOT assert read null**. Delete storage per-descendant. |
| 28 | deleteNode / "S3 DB-only no blob calls" (line 805) | no deleteBlob | **Same; + gate checkFilePermission.** |
| 29 | copyFile S3 / "zero-copy when unshared" (line 837) | 4-arg call `copyFile(10,20,3,{})`; `getActiveS3Key(10)`, `linkObject(50,'key-original')`, no `duplicateBlob` | **Call 5-arg `copyFile(10,20, newName, 1,{id:1})`; `createFile(20, newName)`; same S3 asserts; `checkFilePermission(source)`+`checkFolderPermission(dest)`** (D6). Zero-copy keeps COW semantics. |
| 30 | copyFile S3 / "duplicates when shared" (line 870) | `duplicateBlob(10)`,`linkObject(51,...)` | **5-arg call; + gate asserts.** |
| 31 | copyFile S3 / "checks read on source..." (line 900) | 4-arg; rejects on deny | **5-arg call; `checkFilePermission(1,10,'read')`.** |
| 32 | copyFile WebDAV / "performs actual blob copy" (line 933) | `getNodePath(60)` + `uploadToWebdav('/dest/copy.txt',buf)`; `downloadBlob(10)` | **Rewrite: drop `getNodePath`; use `downloadBlob(10)` then `uploadToWebdav(nodeId, buffer)` (D d); 5-arg copy call; return `{source/copyId}`.** |
| 33 | copyFile WebDAV / "orphaned_node if upload fails after node creation" (line 967) | `updateSyncStatus(61,'orphaned_node')`; reject | **5-arg; drop `getNodePath`; keep orphaned.** |

`service.copyFile(10, 20, 1, { id: 1 })` — current 4-arg — appears at lines 859, 893, 924, 955, 955-991.
All become 5-arg `(nodeId, destParent, newName|under-suffix-provided, userId, user)`.

**Must be removed entirely:** `createMockBlobStorageService` has mock `downloadFromWebdav` at
fileService.test.js:45 — irrelevant; drop usage (D d). `getNodePath` mocks referenced by WebDAV
tests (fileService.test.js:365, 448, 552, 664, 936-982) become unreferenced — leave the mock factory
entry but no assertion uses it (per D12 do not alter other modules, only the test).

### 4.2 Correct the scaffold header

Lines 3-16 state: "These tests FAIL against the pre-refactor... intentional until Wave 2 implements
the nodeId contract." Amend to: "The nodeId methods are implemented in Wave 2 alongside the legacy
path-based surface. These tests target the nodeId methods and pass against the refactored
`createFileService`."

---

## 5. Section WI-C — fileService.md spec alignment (docs/spec/server/services/fileService.md)

| Line region | Current | Required change |
|-------------|---------|-----------------|
| 4.1 Overview / §2.1 (spec line 15) | "Source: `server/service/fileService.js` (new file replacing ...)" | **Module path stays `server/domains/files/services/fileService.js`** (or the same). If a `server/service/` dir exists, link-import it; do not create a second copy. |
| §2.2 (spec line 15-32) | factory lists `copyFile(sourceNodeId, destinationParentNodeId, userId, user)` (4 args) | **5-arg: `copyFile(nodeId, destinationParentNodeId, newName, userId, user)` (D6).** |
| §2.2/§2.3 copyFile S3 §254-256 | "new file_node inherits source name; append numeric suffix" | Clarify **newName param overrides; name conflict → numeric suffix via `createFile` behavior**. |
| §2.3 upload S3 line 99-107 | uses `blobStore.uploadBlob(s3Key, buffer)` phrase | **S3 upload routes through `uploadService.uploadFile` (not raw blobStore). FileService never calls blob raw.**
| §2.3 downloadFile (line 139) | "dispatch to `blobStorageService.downloadBlob(fileNodeId)`" | In S3 = buffer; WebDAV via `downloadBlob(nodeId)`; **WebDAV null → notFound**. |
| §2.3 rename/move/delete (lines 161,166,187-194,213,217,351-353) | uses `checkFolderPermission` for rename/delete | **D7: rename/delete/move-source/download → `checkFilePermission`; move-dest uses `checkFolderPermission`.** |
| §2.4 Dependencies (line 236) | lists `getNodePath` as WebDAV bytes | **Remove `getNodePath`-based WebDAV path flow; instead `downloadBlob(nodeId)` + `uploadToWebdav(nodeId, buffer)`.** |

---

## 6. Section WI-D — batchOperationService deferral + spec path fix (D11)

- `server/domains/files/services/__tests__/batchOperationService.test.js` (522 lines, 19 tests)
  imports `createBatchOperationService` from `../batchOperationService` (batchOperationService.test.js:9)
  via factory `{ fileNodeService, fileService, aclService }` (line 9 method). That factory does not
  exist yet; it is Wave-3 work.
- DO NOT implement/adjust batchOperationService in Wave 2. The scaffold and its spec stay RED through
  Wave 2 and are **excluded from the Wave-2 gate** (from `npm run test:ci -w server` if that pattern
  would pull them in; otherwise keep the gate over `files/**`).
- **Spec path correction:** `docs/spec/server/services/batchOperationService.md` §2.1 (line 15-16)
  says source `server/service/batchOperationService.js`, test `server/service/__tests__/batchOperationService.test.js`.
  The actual test lives at `domains/files/services/__tests__/batchOperationService.test.js`, matching
  `fileService`/`batchOperationService` location. Correct the spec test path to
  `domains/files/services/__tests__/batchOperationService.test.js`.
- **Wave-claim fix:** Wave 1's "until Wave 2 exports `copyFile`/`batchOperationService`" wording
  (artifacts in `phase4-sub-plan-wave1.md` / `phase4-sub-plan-wave2.md`) is wrong: this service is
  Wave-3 work. Correct the phase map so Wave 1/Wave 2 do not promise an export that only Wave 3 provides.

---

## 7. Plan correction (Wave-2 line L873 / L929)

`phase4-sub-plan-wave2.md`:

- Line 873: "This is a breaking API change at the service layer, but route handlers (Wave 3 Task 4.8) will adapt." — **Amend**: NOT breaking; legacy path surface (`listDirectoryWithPermissions/downloadFile/uploadFile/renameFile`) is preserved export-side (D12), so `routes/__tests__/files.test.js` remains GREEN through Wave 2.
- Line 929: "Existing integration tests in files.test.js **may break** during this refactor — updated in Wave 3 Task 4.8." — **Amend**: This claim is WRONG per Rule #2 / D12. `files.test.js` must stay GREEN; no Wave-3 updates to `crud.js` `batch.js` `preview.js` `files.test.js` are needed for fileService refactor in Wave 2.

---

## 8. Acceptance

### 8.1 fileService unit gate

```bash
npm run test -w server -- --testPathPatterns="fileService" --no-coverage
```

- **Pass Criteria:** all 33 `fileService.test.js` tests green (listDistribution 6 + upload→4 + uploadWebDAV 2 + download 4 + rename 4 + move 4 + delete 4 + copyS3 3 + copyWebDAV 2 = 33).
- Does NOT include `batchOperationService` (Wave 3, stays RED).

### 8.2 Route/integration gate

```bash
npm run test -w server -- --testPathPatterns="files" --no-coverage
```

- `server/domains/files/routes/__tests__/files.test.js` stays GREEN — **no source/test edits to routes or that test file in Wave 2** (D12).

### 8.3 Full server gate (final)

```bash
npm run test:ci -w server
```

- Must pass with the batch scaffold excluded (or, if the runner picks it up, seeded so the never-fails run is filtered). If `test:ci` cannot exclude, coordinate: the batch scaffold is authored Wave-3 and its tests are red **by design**; do not let them fail the Wave-2 gate.
- Resources: this amounts to a **coverage equality** for fileService nodes + routes + no API break.

### Success criteria (summary)

1. 33 node-level fileService tests green; 0 skipped, 0 added.
2. `files.test.js` green with zero route/test file edits (proves D12).
3. crud.js (138,158,200,235), batch.js, preview.js untouched and passing.
4. fileService.js export list contains both legacy 4 methods and the nodeId methods,
5. No `downloadFromWebdav` name exists (D d).
6. Spec file housekeeping (WI-C, WI-D) reflects D6/D7/D9/D10/D11.

---

<!-- S4-codes-specs -->

# Section S4 — Shared error codes + spec/documents alignment

> Rectification FRAGMENT. DOCUMENTATION ONLY — do not modify source. An executor applies the Work Items (Wi-N) below to make the changes; each Wi is self-contained (Location, Current state, Problem, Required Change, Acceptance). All file:line references were verified by reading the repository at write time.

## 0. Ground-truth verification (evidence)

- The shared-code module lives at **`shared/serverMessageCodes.js`** (repo-root `shared/`, NOT `server/shared/` as the task brief guessed).
  - `SERVER_ERROR_CODES.files` = `shared/serverMessageCodes.js:77-90`. Keys present: folderAccessDenied, accessDenied, invalidPath, previewNotVideo, previewTicketInvalid, previewTicketExpired, sourceDestRequired, uploadFail, zipFail, duplicateFile, jobNotFound, progressNotFound. It does NOT contain `notFound`, `permissionDenied`, or `invalidName`.
  - `SERVER_MESSAGE_CODES.files` = `shared/serverMessageCodes.js:215-221`. Keys: uploadSkipped, uploadSuccess, nameUnchanged, renameSuccess, cancelRequested. It does NOT contain notFound, permissionDenied, duplicateFile, invalidName.
  - Source bug confirmed: `server/domains/files/services/fileService.js:49` reads `SERVER_MESSAGE_CODES.files.invalidPath`, and `:230` and `:252` read `SERVER_MESSAGE_CODES.files.duplicateFile`. Both are undefined on the MESSAGE map. The correct holders (`invalidPath`, `duplicateFile`) exist only on `SERVER_ERROR_CODES.files` (`:80`, `:87`).
- aclService signatures: `checkFilePermission(principalId, fileNodeId, requiredPermission = PERMISSIONS.READ)` at `server/domains/permissions/services/aclService.js:67`; `checkFolderPermission(principalId, dirNodeId, requiredPermission = PERMISSIONS.READ)` at `:101`. Both are `(userId, nodeId, perm)` — D7 expectation holds.
- Permission route mount: `server/index.js:83` `app.use('/api/permissions', require('./domains/permissions/routes'))`. The brief's `server/domains/files/permission routes` is wrong; correct module tree is `server/domains/permissions/routes/` (`index.js:4-6` dispatches folderPermissions, filePermissions, queries).
- Client transport: `client/src/services/httpClient.js:7` sets `BASE_URL = '/api'`; `buildFullPath()` at `:10-14` prepends it. `permissionService.js` calls relative `/permissions/...` (`:41,:67,:78,:89,:97,:108`), so the deployed URL is `/api/permissions/...`, matching the server mount and the spec doc.
- `GET /api/permissions/check` serializes field `nodeId` (`server/domains/permissions/routes/queries.js:53`).

---

## 1. Decision D8 — file error codes (target encoding)

`phase4-sub-plan-wave3.md` Task W2.3 requires service code that throws `notFoundError`/`conflictError`; the referenced keys `notFound`, `permissionDenied`, `duplicateFile`, `invalidName` are all thrown errors. The codebase standard puts error-style codes under `SERVER_ERROR_CODES` (`duplicateFile`, `invalidPath` already there). 

DECISION (one consistent choice): Add the four codes to `SERVER_ERROR_CODES.files`; keep the success message domain untouched in `SERVER_MESSAGE_CODES.files`; and correct every reference (source + plan) that currently points to the wrong map. Rule internal consistency: thrown errors live under `SERVER_ERROR_CODES`; success messages live under `SERVER_MESSAGE_CODES`.

New entries — insert into `SERVER_ERROR_CODES.files` in `shared/serverMessageCodes.js` (recommended position: immediately after `duplicateFile` at line 87):

```js
    notFound: P('serverErrors.files', 'notFound'),
    permissionDenied: P('serverErrors.files', 'permissionDenied'),
    invalidName: P('serverErrors.files', 'invalidName'),
```

- Do NOT re-add `duplicateFile` (already at `:87`) or `invalidPath` (already at `:80`).

Reference alignment table (every site):

| Reference site | Current key | Correct resolution |
|---|---|---|
| `shared/serverMessageCodes.js:80` | `invalidPath` (SERVER_ERROR_CODES) | keep — already correct |
| `shared/serverMessageCodes.js:87` | `duplicateFile` (SERVER_ERROR_CODES) | keep — already correct |
| `shared/serverMessageCodes.js` (new) | `notFound` | add to `SERVER_ERROR_CODES.files` |
| `shared/serverMessageCodes.js` (new) | `permissionDenied` | add to `SERVER_ERROR_CODES.files` |
| `shared/serverMessageCodes.js` (new) | `invalidName` | add to `SERVER_ERROR_CODES.files` |
| `server/domains/files/services/fileService.js:49` | `SERVER_MESSAGE_CODES.files.invalidPath` | `SERVER_ERROR_CODES.files.invalidPath` |
| `server/domains/files/services/fileService.js:230` | `SERVER_MESSAGE_CODES.files.duplicateFile` | `SERVER_ERROR_CODES.files.duplicateFile` |
| `server/domains/files/services/fileService.js:252` | `SERVER_MESSAGE_CODES.files.duplicateFile` | `SERVER_ERROR_CODES.files.duplicateFile` |
| `phase4-sub-plan-wave3.md:631,:639` | `SERVER_MESSAGE_CODES.files.notFound` | `SERVER_ERROR_CODES.files.notFound` |
| `phase4-sub-plan-wave3.md:658,:733,:766,:794,:829` | `SERVER_MESSAGE_CODES.files.permissionDenied` | `SERVER_ERROR_CODES.files.permissionDenied` |
| `phase4-sub-plan-wave3.md:671` | `SERVER_MESSAGE_CODES.files.duplicateFile` | `SERVER_ERROR_CODES.files.duplicateFile` |
| `phase4-sub-plan-wave3.md:723,:726` | `SERVER_MESSAGE_CODES.files.invalidName` | `SERVER_ERROR_CODES.files.invalidName` |

Spec `docs/spec/server/services/fileService.md` describes error outcomes behaviorally (status tables §2.5, §5) and does not embed these map keys; it needs no change for D8 other than Wi-4 / Wi-6 wording.

---

## 2. Decision D7 — permissions mapping

`docs/spec/server/utils/permissionPolicy.md:54` maps file-node checks to `checkFolderPermission`. Verified: file nodes must use `checkFilePermission`, folder nodes use `checkFolderPermission` (aclService `:67,:101`). Precedents in the repo: `phase4-sub-plan-wave3.md:585` dispatches via `child.type === 'directory' ? checkFolderPermission : checkFilePermission`, and `server/domains/permissions/services/aclService.js:139-141` dispatches by node `type`.

The only incorrect entry in permissionPolicy.md is the `canReadFile` row of the §2.3 table (Wi-10). §2.5 already maps `canReadFile → aclService.checkFilePermission` correctly; leave it.

---

## 2. Work Items

### Wi-1 — fileService.md module path must be `domains/files/services/`

- **Location:** `docs/spec/server/services/fileService.md:15` (Section 2.1 File Path)
- **Current state:**
  > `- **Source:** \`server/service/fileService.js\` (new file replacing \`server/domains/files/services/fileService.js\`)`
- **Problem:** The real file is `server/domains/files/services/fileService.js` (present in repo). Wave 3 refactors it IN PLACE at that path (`phase4-sub-plan-wave3.md` Task W2.3, "server/domains/files/services/fileService.js`); a brand-new path under `server/service/` is false and misleads the executor.
- **Required Change:** Replace the line with:
  > `- **Source:** \`server/domains/files/services/fileService.js\` (refactored in place to a nodeId-based factory; do NOT create a new file under \`server/service/\`)`
- **Acceptance:** The tree still resolves to `server/domains/files/services/fileService.js`; grep `server/service/fileService` in the spec yields no path wiring contradicting it.

### Wi-2. fileService.md: `copyFile` gains `newName` (Decision D6)

- **Location:** `docs/spec/server/services/fileService.md:29` (§2.2 factory signature) and `:225-235` (§2.3 `copyFile` signature + param table).
- **Current state (line 29 and line 225):**
  > `copyFile(sourceNodeId, destinationParentNodeId, userId, user)`
- **Problem:** Wave-3 factory is `copyFile(nodeId, destinationParentNodeId, newName, userId, user)` (`phase4-sub-plan-wave3.md:561-563`), and the route `POST /copy` body is `{ nodeId, destinationParentNodeId, newName? }` (`docs/spec/server/routes/files.md:37`). The spec omits the optional `newName`.
- **Required Change:** In both places replace the signature with:
  > `copyFile(sourceNodeId, destinationParentNodeId, newName, userId, user)`
  In the §2.3 param table insert a row between `destinationParentNodeId` and `userId`:
  > `newName` | string | no | Optional new name for the copy; default to the source name when omitted.
  Update §2.6 copyFile-S3 step 4 to: "New file node inherits the source name, or `newName` when provided; if the resulting name collides with an existing sibling, append a numeric suffix."
- **Acceptance:** `copyFile` carries `newName` in factory, method heading, and param table, matching `phase4-sub-plan-wave3.md` and `files.md` `/copy`.

### Wi-3. fileService.md: S3 upload flow routes through uploadService, not raw blobStore

- **Location:** `docs/spec/server/services/fileService.md:99-107` (§2.3 S3 Mode Flow).
- **Current state (lines 103-106):**
  > Dispatch to `uploadService.uploadFile(parentNodeId, name, buffer, mimeType)`:
  > - TX1: `fileNodeService.createFile()` + `blobStorageService.prepareUpload()`
  > - S3 PUT: `blobStore.uploadBlob(s3Key, buffer)` — outside transaction boundary
  > - TX2: `blobStorageService.completeUpload()` + `fileNodeService.updateSyncStatus(nodeId, 'active')`
- **Problem:** Line 105 exposes raw `blobStore.uploadBlob` as a direct fileService call. The refactored fileService constructs only `uploadService`/`blobStorageService`; the storage transporter (`blobStoreS3BlobStore`) is internal to `blobStorageService`. Raw access here would break the abstraction.
- **Required Change:** Replace step 3 listing with:
  > Dispatch to `uploadService.uploadFile(parentNodeId, name, buffer, mimeType)`. This orchestration internally runs TX1 (`fileNodeService.createFile()` + `blobStorageService.prepareUpload()`), the transport PUT (inside blobStorageService, never a direct blobStore call from fileService), and TX2 (`blobStorageService.completeUpload()` + `fileNodeService.updateSyncStatus(nodeId, 'active')`).
- **Acceptance:** No `blobStore.uploadBlob` reference remains in fileService.md S3 flow; text routes the write through uploadService.

### Wi-4. fileService.md: permission-gate params use PERMISSIONS constants

- **Location:** `docs/spec/server/services/fileService.md:76,:80,:75,:87,:89,:101,:110,:117,:141,:163` — every aclService call uses string `'read'`/`'write'`.
- **Current state (e.g. line 76):**
  > `aclService.checkFolderPermission(userId, childId, 'read')`
- **Problem:** The implementation standard passes `PERMISSIONS.READ`/`PERMISSIONS.WRITE` constants (see default in `aclService.js:67`, and `phase4-sub-plan-wave3.md`). The doc strings `'read'`/`'write'` differ, causing friction.
- **Required Change:** In each aclService call listing replace `'read'` with `PERMISSIONS.READ` and `'write'` with `PERMISSIONS.WRITE`. Example: line 76 becomes `aclService.checkFolderPermission(userId, childId, PERMISSIONS.READ)`.
- **Acceptance:** No `'read'`/`'write'` literal remains in an aclService call context in the spec; every call uses `PERMISSIONS.*`.

### Wi-5. fileService.md: downloadFile returns/throws consistency

- **Location:** `docs/spec/server/services/fileService.md:134` (returns line), `:134-141` ops, `:304` / `:424` verify items.
- **Current state (line 134):**
  > **Returns:** `Buffer \| null` — content, or null if no active storage object exists.
  §2.6 verify item: "Returns null when no active object_map entry or storage resource exists (not an error)".
- **Problem:** Wave-3 `downloadFile` throws `notFoundError(SERVER_ERROR_CODES.files.notFound)` on a falsy buffer (`phase4-sub-plan-wave3.md:631,:639`), and the route contract `GET /download` returns 404 when file not found (`docs/spec/server/routes/files.md:33`). A returning-null contract contradicts both.
- **Required Change:** Normalize to THROW. Set:
  > `Returns: Buffer — file content. Throws notFoundError(SERVER_ERROR_CODES.files.notFound) when blobStorageService.downloadBlob(fileNodeId) yields no buffer.`
  Update op wording and §2.6 verify to "Throws notFoundError on empty active object (route maps to 404)". Remove null-return wording for downloadFile.
- **Acceptance:** No spec statement says downloadFile returns `null`; spec, wave-3 code, and files.md route all produce a 404 on missing blob.

### Wi-6. blobStorageService.md: remove `webdavClient` factory parameter

- **File:** `docs/spec/server/services/blobStorageService.md:21` (§2.2 factory signature).
- **Current state:**
  > `function createBlobStorageService({ blobStore, fileNodesStore, webdavClient, fileNodeService, fileStorageMode }) {`
- **Problem:** The refactored service has NO `webdavClient`; WebDAV path resolution goes through `fileNodeService` internally and the webdav client lives in the adapter (WebdavBlobStore). Leaving the param invites wiring a client that must not exist here.
- **Required Change:**
  > `function createBlobStorageService({ blobStore, fileNodesStore, fileNodeService, fileStorageMode }) {`
- **Acceptance:** No `webdavClient` reference in blobStorageService.md; signature matches `phase4-03-wave3.md` factory.

### Wi-7. blobStorageService.md: §2.2 return list must be service methods, not adapter methods

- **File:** `docs/spec/server/services/blobStorageService.md:23-33` (§2.2 return object) and `:127-134` (§3.1 Interface Methods), `:144` (§4 dispatch table).
- **Current state (§2.2):** `prepareUpload, completeUpload, downloadBlob, overwriteBlob, deleteBlob, getActiveS3Key` plus legacy `uploadToWebdav(webdavPath,...)`, `downloadFromWebdav(webdavPath)`, `downloadFromWebdav`, `deleteOnWebdav`, `headOnWebdav`. §3.1 lists adapter-shaped path-methods; §4 line 144 says `webdavClient.downloadFromWebdav(path)`.
- **Problem:** Lines apply to WebdavBlobStore *internal* lifecycle; the service object must expose node-id-based methods (matching `phase-03-wave3.md:311-323`), not adapter path-methods.
- **Required Change:** Replace §2.2 return with the node-id-based surface (exact text):
  ```js
  return {
    prepareUpload(fileNodeId),
    completeUpload(s3Key, size, mimeType),
    downloadBlob(fileNodeId),
    overwriteBlob(fileNodeId, buffer),
    deleteBlob(fileNodeId),
    getActiveS3Key(fileNodeId),
    countActiveObjectsByS3Key(s3Key),
    duplicateBlob(sourceS3Key),
    linkObject(fileNodeId, s3Key),
    ensureExclusiveBlob(fileNodeId),
    // WebDAV-mode only (undefined in S3 mode):
    downloadBlobWebdav(fileNodeId),
    uploadToWebdav(fileNodeId, buffer, mimeType),
  };
  ```
  Remove the four path-shaped methods (`uploadToWebdav(webdavPath,..)`, `downloadFromWebdav`, `deleteOnWebdav`, `headOnWebdav`) from the return list and §3.1. §3.1 becomes the node-id methods `downloadBlobWebdav(fileNodeId)` and `uploadToWebdav(fileNodeId, buffer, mimeType)`. Update §4 row 144 to text-only "WebDAV resolve path via getNodePath → blobStore.downloadBlob(path)".
- **Acceptance:** Return-object shape matches wave-3 code; no `webdavPath`-param method remains in the spec; §3.1 and code agree on `downloadBlobWebdav`/`uploadToWebdav`.

### Wi-8. blobStorageService.md: getNodePath server null-guard

- **File:** `docs/spec/server/services/blobStorageService.md:132-134` (§3.2 Path Resolution).
- **Current state:**
  > `file_node_id` → reconstruct display path via `fileNodeService.getNodePath(nodeId)` → pass to WebDAV methods.
- **Problem:** `getNodePath` may return `null`; wave-3 methods null-guard (`downloadBlobWebdav` returns `null`; `uploadToWebdav` throws `Cannot resolve path for fileNodeId` at `wave:401-421`). The spec doesn't document the guard.
- **Required Change:** Append:
  > `getNodePath(nodeId)` may return `null` for an unknown or empty node. WebDAV methods MUST null-guard: `downloadBlobWebdav(fileNodeId)` returns `null`; `uploadToWebdav(fileNodeId, buffer)` throws a descriptive error when the resolved path is falsy.
- **Acceptance:** A WebDAV-only spec/unit test exercises both null branches and matches the described behavior.

### Wi-9. Batch/download spec test-path mismatch

- **Files:** `docs/spec/server/services/batchOperationService.md:16`; `downloadService.md:16`.
- **Current state:**
  > `server/service/__tests__/batchOperationService.test.js`
  > `server/service/__tests__/downloadService.test.js`
- **Problem:** Wave-3 test scaffolds live under `domains/files/services/__tests__/` (fileService at `wave3.md:883`; W1.1-2 at `wave1.md:314`). `server/service/__tests__` is wrong; the executor will chase the wrong directory.
- **Required Change:**
  > batch `domains/files/services/__tests__/batchOperationService.test.js`
  > download `domains/files/services/__tests__/downloadService.test.js`
- **Acceptance:** Both test paths point under `domains/files/services/__tests__/`, matching the actual suite.

### Wi-10. downloadService.md: use `checkFilePermission` for file nodes (Decision D7)

- **File:** `docs/spec/server/services/downloadService.md:45,:71,:77,:123`.
- **Current state:**
  > `:45` / `:77` — "call `aclService.checkFolderPermission(userId, nodeId, 'read')`"
  > `:71` — deps table row "checkHolderPermission(userId, nodeId, 'read')"
- **Decision:** D7. `downloadMultiple` inputs are file nodeIds; file workers must gate via `checkFilePermission`, not `checkFolderPermission`.
- **Required Change:** Replace each `checkFolderPermission(userId, <fileNodeId>, 'read')` with `checkFilePermission(userId, <fileNodeId>, PERMISSIONS.READ)` (constant per Wi-17). Keep other deps unchanged.
- **Acceptance:** downloadService routes file nodes through `checkFilePermission`; no file-node check uses `checkFolderPermission`.

### Wi‑11. permissionPolicy.md: fix `canReadFile → checkFilePermission` mapping (Decision D7)

- **File:** `docs/spec/server/utils/permissionPolicy.md:54`.
- **Current state:**
  > | `canReadFile` | fileService.downloadFile | `aclService.checkFolderPermission(userId, nodeId, 'read')` | 4.1 |
- **Problem:** file-node read is filed through `checkFolderPermission`; it must be `checkFilePermission` (see §0 evidence).
- **Required Change:** Row becomes:
  > | `canReadFile` | fileService.downloadFile | `aclService.checkFilePermission(userId, nodeId, 'read')` | 4.1 |
- **Acceptance:** `grep` shows no `canReadFile → checkFolderPermission` mapping anywhere in permissionPolicy.md.

### Wi-12. permissionPolicy.md: explicitly mark Tier-2/3 sections "pre-removal / not to be used"

- **File:** `docs/spec/server/utils/permissionPolicy.md` §2.5 (functions table, lines 64-83) and §2.12 (verification, lines 125-134).
- **Current state:** Both tabs list Tier-2 (`canReadFolder`, `canReadFile`, etc.) and Tier-3 (`buildSync*Checker`, SyncFuncs) as (apparently) valid exported references.
- **Problem/Decision:** Removal program is Tasks 4.8d-4.8f. §2.5/§2.12 must not be read as the supported (Tier-1) surface, even though §1 line 9 already has a Phase-4 note. Mark each section explicitly.
- **Required Change:** Insert this banner immediately above §2.5 and again above §2.12:
  > **PRE-REMOVAL — NOT FOR NEW USE** — Any Tier-2 (path-based) and Tier-3 (`buildSync*Checker`) entries listed in this tab are intermediates for Phase 4 removal (Tasks 4.8d-4.8f). Treat them as reference only; new code must use the Tier-1 node-id API (`canReadNode`, `canWriteNode`, aclService). The banner does NOT cover Tier-1 rows (`isAdminUser`, `canReadNode`/`canWriteNode`, ownerNodeResolver, inheritance, permissionRank).
- **Acceptance:** Both §2.5 and §2.12 are preceded by the banner; the executor honors Tier-1 rows.

### Wi-13. files.md: route tests use service mocks, not WebDAV-mock factories

- **File:** `docs/spec/server/routes/files.md:68-76` (§2.5 Test Mock Strategy).
- **Current state:**
  > Routes use Supertest with shared WebDAV mock factories; default `pathExists`/`listDirectory`/`getFileContents`.
- **Decision:** W1.1-3 (`wave1.md:381-420`) and Task 4.9 (`wave3.md:1456`) mandate routes inject `fileNodeService`+`blobStorageService`+`aclService`+`uploadService` via the composition root. The WebDAV adapter is not mocked at route level.
- **Required Change:** Write §2.5 to:
  > Routes run with Supertest + service mocks injected through the composition root (`server/service/composition.js`): `fileNodeService`, `blobStorageService`, `aclService`, `uploadService`. Do NOT mock the WebDAV adapter at route level. Defaults are deterministic success (e.g. `listDirectory` returns two children; `downloadBlob` returns a small stub buffer). Failure scenarios (404, conflict, permission-denied) are per-test overrides (`mockResolvedValueOnce`/`mockRejectedValueOnce`). Worker internals (batch) are tested as unit tests; routes assert only API contract (status/body).
- **Acceptance:** The "WebDAV mock factory" route strategy paragraph is gone; the mock list is the four services via the composition root, matching W1.1-3/Task 4.9.

### Wi-14. files.md: remove 20 legacy listing of selectiveTransfer/selectiveDownload

- **File:** `docs/spec/server/routes/files.md:26` (§2.1 Services line) and `:97` (§2.7 Related Documents).
- **Current state (line 26):**
  > `- **Services:** \`domains/files/services/\` — conflictResolver, batchOperationService, fileService, selectiveTransfer, selectiveDownload, selectiveDelete`
- **Decision:** These legacy path workers are superseded by batchOperationService; `selectiveDelete` remains. Remove only `selectiveTransfer` and `selectiveDownload`.
- **Required Change line 26:**
  > `- **Services:** \`domains/files/services/\` — conflictResolver, batchOperationService, fileService, selectiveDelete`
  §2.7 (line 97): drop the `selectiveTransfer, selectiveDownload` reference and keep `selectiveDelete`.
- **Acceptance:** `selectiveTransfer`/`selectiveDownload` no longer listed as active; the legacy `docs/spec/server/services/selectiveDownload.md` and `selectiveTransfer.md` may remain but files.md now link only to `selectiveDelete`.

### Wi-15. permissionService.md: URL prefix reconciliation

- **File:** `docs/spec/client/services/permissionService.md:22-27` and client `permissionService.js:41,67,78,89,97,108`; `httpClient.js:7,10-14`.
- **Decision:** canonical network prefix = `/api/permissions/...`. Spec table (§22) already states that absolute prefix; the client source's relative `/permissions/...` is resolved by httpClient to the same. No behavior change; make the rule explicit to prevent future thrash.
- **Required Change (add a Base-path note in §2.1 near line 14):**
  > All permission endpoints are mounted at `/api/permissions`. The service implementation passes relative `/permissions/...`; httpClient (`BASE_URL='/api'`) describes the absolute prefix. Treat `/api/permissions/...` as the canonical documented form.
- **Acceptance:** The `absolute` example in §2.2 stays; doc contains the resolution rule.

### Wi-16. permissionService.md: reconcile `fileNodeId` fixture vs canonical `nodeId`

- **File:** `docs/spec/client/services/permissionService.md:65` (§2.5 Response Shape).
- **Current state (line 65):**
  > Responses include `{ fileNodeId, nodeId, display_path, permission }` instead of `{ folderPath, permission }`
- **Decision:** the route returns `nodeId` (queries.js:53). `fileNodeId` is a duplicate alias; unify to canonical `nodeId`.
- **Required Change (line 65):**
  > Responses include `{ nodeId, display_path, permission }`. The canonical identifier is `nodeId`; `fileNodeId` is NOT serialized for permission-list responses.
- **Acceptance:** Permission responses are asserted against `nodeId`; no server payload and no client assertion depends on `fileNodeId` for these endpoints.

---

## 4. (SUPERSEDED — see preamble) Decision Log

> IMPORTANT: The "Decision Log" in this embedded S4 section was written by a section
> author and uses D-number meanings that CONFLICT with the Canonical Contract Log in the
> preamble. Per the preamble editing rule, IGNORE this embedded log. The authoritative
> contract is the **Canonical Contract Log (D1-D12)** at the top of this document.
> (Historical note for the Curator: this S4 author reused D1/D6/D7/D8 numbers for
> different meanings; the canonical table is right.)

| ID | Owned by | One-line meaning |
|----|----------|------------------|
| D1 | S1 (earlier section) | Node-listing metadata / thumbnail URL keys (not reused) |
| D2 | S1 (earlier section) | File-type detection, no template (reserved) |
| D3 | S2 (earlier section) | Route module ownership under the domain split (used) |
| D4 | S2 (earlier section) | Download/list response shape (used) |
| D5 | S3 (earlier section) | Blob dispatch return contract (used) |
| D6 | **S4** (Wi-2) | `copyFile` gains optional `newName` across factory, method, and route contract |
| D7 | **S4** (Wi-4, Wi-10, Wi-11) | File nodes check via `checkFilePermission(nodeId)`; folder nodes via `checkFolderPermission`; fix policy mapping + file-scope checks |
| D8 | **S4** (Wi-1, Wi-2, Wi-3) | Add notFound/permissionDenied/invalidName to `SERVER_ERROR_CODES.files` and correct MESSAGE/ERROR map references |
| D9 | reserved | (not yet assigned — use for the next new decision) |
| D10 | reserved | (not yet assigned) |
| D11 | reserved | (not yet assigned) |
| D12 | reserved | (not yet assigned) |

Rule: new decisions claim D9, then D10, … in order. Never reuse D1–D8.

---

## 8. Executor checklist (apply order, grouped for dependency)

1. **Source token-layer (only source change in S4):** Wi-1 (add codes to `shared/serverMessageCodes.js`); then Wi-2 (fix `fileService.js:49,230,252`).
2. **Plan doc:** Wi-3 (fix `phase4-sub-plan-wave3.md` W2.3 code markers).
3. **Permissions specs:** Wi-11, Wi-12 (permissionPolicy.md D7); Wi-10 (downloadService checkFilePermission).
4. **Services specs:** Wi-6, Wi-7, Wi-8 (blobStorageService); Wi-5 (fileService download throw); Wi-1, Wi-3, Wi-4 (fileService module path, S3 flow, PERMISSIONS constants).
5. **Routes specs:** Wi-13, Wi-14 (files.md).
6. **Client specs:** Wi-15 (prefix), Wi-16 (nodeId canonical).
7. **Perf verification:** run `npm run test -w server -- --testPathPatterns="serverMessageCodes|fileService"` (server) and `npm run test -w client -- --testPathPatterns="permissionService|buildPermissionDiff"` only if the executor modifies source outside Wi-2. For doc-only edits, verify via grep per each Acceptance clause.
8. Record the change in `docs/fail_log.md` only if a failing test is diagnosed (RCA workflow).

Note: The source-code edit is limited to Wi-1/Wi-2. All other Wi are pure documentation alignment.