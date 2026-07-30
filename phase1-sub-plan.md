# Phase 1 Sub-Plan: S3 Blob Store Adapter

## Objective

Implement S3 blob store adapter layer providing opaque-key-based blob operations (`uploadBlob`, `downloadBlob`, `deleteBlob`, `headBlob`, `listOrphanedKeys`). This is the foundation for S3+PostgreSQL architecture where PostgreSQL manages filesystem metadata and S3 serves as flat blob storage.

## Scope

| In scope | Out of scope |
|----------|-------------|
| S3BlobStore adapter (5 methods) | Phase 2 service layer (fileNodeService, blobStorageService, uploadService) |
| NoOpBlobStore stub for WebDAV mode | E2E tests with real MinIO (Phase 8) |
| Factory (`createBlobStore`) + env config validation | s3Mock.js (already exists from Phase 0 Task 1.5) — reuse if present |

## Branch

`refactor/phase1-s3-blobstore` (branched from `dev`)

---

## Tasks

### Step 0: Docs-First — blobstore.md spec

**File:** `docs/spec/server/store/blobstore.md` (new)

Follow the standard spec pattern (see `storage.md`, `fileNodesStore.md` for reference).

| Section | Content |
|---------|---------|
| Overview | Single-row table: `Role` = S3 blob store adapter, relationship with `object_map`, two-tier GC strategy |
| 2.1 File Path | `Source: server/infrastructure/adapters/blobstore/S3BlobStore.js`, `Test file: __tests__/S3BlobStore.test.js` |
| 2.2 Main Methods | Table with columns: `Method`, `Signature`, `Description` — 5 methods + NoOpBlobStore stub signatures |
| 2.3 Backend Strategy | Behavior split: `s3` → S3BlobStore (real S3 operations), `webdav` → NoOpBlobStore (no-op stub) |
| 2.4 Configuration | Env vars table: `Variable | Purpose | Values | Required` — `WEA_FILE_STORAGE`, `S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `S3_ENDPOINT` (optional) |
| 2.5 Dependencies | List: `@aws-sdk/client-s3`, `errorHandler`, `shared/SERVER_ERROR_CODES` |
| 2.6 Verification Scenarios | Checklist: upload/download/delete/head/listOrphanedKeys success + error paths, backend switching |
| 2.7 Error Cases | AWS SDK error → HTTP status → error code mapping table (see Error Handling section below) |

**No code blocks.** Reference source files by path. No DDL duplication — point to `001_initial_normalized_schema.sql` for `object_map` table definition.

**Verify:** Spec file exists, follows standard pattern, covers all adapter methods.

---

### Step 1: Add `@aws-sdk/client-s3` dependency

**File:** `server/package.json`  
**Change:** Add `"@aws-sdk/client-s3": "^3.x"` to dependencies (use latest stable minor).

```bash
npm install @aws-sdk/client-s3 -w server
```

**Verify:** Module resolves: `node -e "require('@aws-sdk/client-s3'); console.log('OK')"` in `server/` directory.

---

### Step 2: Create S3 mock (`s3Mock.js`) — TDD prerequisite

**File:** `server/testing/mocks/s3Mock.js` (new)  
**Pattern:** Same factory pattern as `webdavMock.js`, `emailMock.js`.

```javascript
function createS3Mock(overrides = {}) {
  const store = new Map(); // key → { Body: Buffer, ContentType, ContentLength, LastModified }
  const pageSize = overrides.pageSize || 1000; // for pagination testing
  
  return {
    putObject: jest.fn(async ({ Bucket, Key, Body, ContentType }) => {
      store.set(Key, { 
        Body, 
        ContentType: ContentType || 'application/octet-stream',
        ContentLength: Body.length,
        LastModified: new Date() 
      });
      return { Location: `/${Bucket}/${Key}` };
    }),
    
    getObject: jest.fn(async ({ Bucket, Key }) => {
      const obj = store.get(Key);
      if (!obj) throw new Error('NoSuchKey');
      return { Body: obj.Body, ContentType: obj.ContentType, ContentLength: obj.ContentLength };
    }),
    
    deleteObject: jest.fn(async ({ Bucket, Key }) => {
      store.delete(Key);
      return {};
    }),
    
    headObject: jest.fn(async ({ Bucket, Key }) => {
      const obj = store.get(Key);
      if (!obj) throw Object.assign(new Error('NotFound'), { name: 'NoSuchKey' });
      return { ContentLength: obj.ContentLength, ContentType: obj.ContentType, LastModified: obj.LastModified };
    }),
    
    listObjectsV2: jest.fn(async ({ Bucket, ContinuationToken, MaxKeys }) => {
      const now = new Date();
      const limit = MaxKeys || pageSize;
      const allEntries = Array.from(store.entries()).map(([key, val]) => ({
        Key: key,
        Size: val.ContentLength,
        LastModified: val.LastModified || now,
      }));
      
      // Find starting index from ContinuationToken
      let startIndex = 0;
      if (ContinuationToken) {
        const tokenIndex = allEntries.findIndex(e => e.Key === ContinuationToken);
        startIndex = tokenIndex >= 0 ? tokenIndex : 0;
      }
      
      const page = allEntries.slice(startIndex, startIndex + limit);
      const isTruncated = startIndex + limit < allEntries.length;
      const nextToken = isTruncated ? allEntries[startIndex + limit].Key : undefined;
      
      return {
        Contents: page.length > 0 ? page : undefined,
        KeyCount: page.length,
        IsTruncated: isTruncated,
        NextContinuationToken: nextToken,
      };
    }),
    
    ...overrides,
  };
}

module.exports = { createS3Mock };
```

**Verify:** Importable from any test file. Methods are `jest.fn()` spies. Store is Map-based and inspectable.

---

### Step 3: Write S3BlobStore tests (red phase)

**File:** `server/infrastructure/adapters/blobstore/__tests__/S3BlobStore.test.js` (new)

| Test Case | Verify |
|-----------|--------|
| uploadBlob puts object in store | putObject called with correct Key, Body, Bucket |
| downloadBlob retrieves object | getObject called, returns Buffer |
| deleteBlob removes object | deleteObject called, key no longer exists |
| headBlob returns metadata | { contentLength, contentType } shape |
| headBlob throws on missing key | NoSuchKey error propagated |
| headBlob handles network error | Network/timeout → retryable error (503) |
| listOrphanedKeys filters by olderThan | Only keys with LastModified < olderThan returned |
| listOrphanedKeys handles pagination | Multiple ListObjectsV2 calls if IsTruncated=true |
| listOrphanedKeys handles empty bucket | Contents undefined → returns empty array, zero or one API call |
| listOrphanedKeys respects MaxKeys | MaxKeys parameter passed to ListObjectsV2 |
| listOrphanedKeys single page | All items fit in one page, IsTruncated=false |
| uploadBlob validates input | Empty buffer or missing key → descriptive error |
| upload error propagation | AWS SDK error → application error (status code mapping) |
| deleteBlob handles missing key | Deleting non-existent key succeeds (idempotent) |

**Mock setup:** `jest.mock('@aws-sdk/client-s3')` at top of test file; inject `createS3Mock()` return values.

---

### Step 4: Implement S3BlobStore.js (green phase)

**File:** `server/infrastructure/adapters/blobstore/S3BlobStore.js` (new)  
**Pattern:** Class-based, `'use strict'`, CommonJS module.exports.

```javascript
'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');

class S3BlobStore {
  constructor(config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      region: config.region,
      credentials: config.credentials,
      ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
    });
  }

  async uploadBlob(key, buffer) { ... }
  async downloadBlob(key) { ... }
  async deleteBlob(key) { ... }
  async headBlob(key) { ... }
  async listOrphanedKeys(olderThan) { ... }
}

module.exports = S3BlobStore;
```

**Implementation details per method:**

| Method | Key Logic |
|--------|-----------|
| `uploadBlob(key, buffer)` | `this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer }))` |
| `downloadBlob(key)` | GetObject → stream collection: `const chunks = []; for await (const chunk of response.Body) chunks.push(chunk);` → return `Buffer.concat(chunks)` |
| `deleteBlob(key)` | DeleteObject → void (idempotent, no error on missing key) |
| `headBlob(key)` | HeadObject → `{ contentLength: Number(res.ContentLength), contentType: res.ContentType }` |
| `listOrphanedKeys(olderThan)` | while loop: `do { response = await client.send(new ListObjectsV2Command({ Bucket, ContinuationToken })); items.push(...(response.Contents ?? []).filter(o => o.LastModified < olderThan)); } while (response.IsTruncated);` → return `items.map(o => o.Key)` |

**Constructor details:**
```javascript
constructor(config) {
  this.bucket = config.bucket;
  this.client = new S3Client({
    region: config.region,
    credentials: config.credentials,
    ...(config.endpoint ? { endpoint: config.endpoint, forcePathStyle: true } : {}),
  });
}
```
- `forcePathStyle: true` only when `config.endpoint` is present (MinIO compatibility)

**Error handling:** Wrap AWS SDK calls in try-catch; map common errors (see Error Cases section):
- `NoSuchKey` / `NotFound` → 404 error
- Network/timeout → retryable error (status 503 or similar)
- Permission denied → 403 error

**Error mapping table:**

| AWS SDK Error | HTTP Status | Error Code | Retryable |
|---------------|-------------|------------|-----------|
| `NoSuchKey` / `NotFound` | 404 | `STORAGE.NOT_FOUND` | No |
| `NetworkingError` / `TimeoutError` | 503 | `STORAGE.NETWORK_ERROR` | Yes |
| `AccessDenied` | 403 | `STORAGE.PERMISSION_DENIED` | No |
| `NoSuchBucket` | 500 | `STORAGE.BUCKET_NOT_FOUND` | No |
| `SignatureDoesNotMatch` | 403 | `STORAGE.INVALID_CREDENTIALS` | No |
| `SlowDown` | 429 | `STORAGE.RATE_LIMITED` | Yes (with backoff) |

---

### Step 5: Write factory tests (red phase)

**File:** `server/infrastructure/adapters/blobstore/__tests__/blobstoreFactory.test.js` (new)

| Test Case | Verify |
|-----------|--------|
| WEA_FILE_STORAGE=s3 → S3BlobStore instance | S3 mode detected, config resolved |
| WEA_FILE_STORAGE=webdav → NoOpBlobStore instance | WebDAV mode returns stub |
| Empty/default WEA_FILE_STORAGE → S3BlobStore (default) | Default is S3 |
| Missing required env vars → throws clear error | `S3_BUCKET`, `AWS_REGION` etc. validated |
| Optional S3_ENDPOINT included in config when present | MinIO-compatible endpoint support |

**Environment manipulation:** Save/restore `process.env` in beforeEach/afterEach (same pattern as `storage.test.js`).

---

### Step 6: Implement NoOpBlobStore + factory index.js (green phase)

**File:** `server/infrastructure/adapters/blobstore/NoOpBlobStore.js` (new)

```javascript
'use strict';

class NoOpBlobStore {
  async uploadBlob() {}
  async downloadBlob() { return Buffer.from(''); }
  async deleteBlob() {}
  async headBlob() { return { contentLength: 0, contentType: 'application/octet-stream' }; }
  async listOrphanedKeys() { return []; }
}

module.exports = NoOpBlobStore;
```

**File:** `server/infrastructure/adapters/blobstore/index.js` (new)

```javascript
'use strict';

const S3BlobStore = require('./S3BlobStore');
const NoOpBlobStore = require('./NoOpBlobStore');

function resolveS3Config() {
  const requiredKeys = ['S3_BUCKET', 'AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'];
  const missing = requiredKeys.filter((k) => !process.env[k]);
  
  if (missing.length > 0) {
    // Use createError from errorHandler + SERVER_ERROR_CODES from shared
    throw new Error(`S3 configuration missing: ${missing.join(', ')}`);
  }

  return {
    bucket: process.env.S3_BUCKET,
    region: process.env.AWS_REGION,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
    ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
  };
}

function createBlobStore() {
  const fileStorage = (process.env.WEA_FILE_STORAGE || 's3').toLowerCase();
  
  if (fileStorage === 'webdav') {
    return new NoOpBlobStore();
  }
  
  const config = resolveS3Config();
  return new S3BlobStore(config);
}

module.exports = { createBlobStore, resolveS3Config };
```

**Verify:** `npm run test -w server -- --testPathPattern="blobstore"` passes all tests.

---

## File Structure After Phase 1

```
server/
├── infrastructure/
│   └── adapters/
│       └── blobstore/                    ← NEW
│           ├── S3BlobStore.js            ← Task 4
│           ├── NoOpBlobStore.js          ← Task 6
│           ├── index.js                  ← Task 6 (factory)
│           └── __tests__/                ← NEW
│               ├── S3BlobStore.test.js   ← Step 3
│               └── blobstoreFactory.test.js ← Step 5
├── testing/
│   └── mocks/
│       ├── emailMock.js                  (existing)
│       ├── webdavMock.js                 (existing)
│       └── s3Mock.js                     ← Step 2 NEW
docs/
└── spec/
    └── server/
        └── store/
            └── blobstore.md              ← Step 0 NEW
```

---

## Execution Order (TDD)

```
Step 0:  Docs-First — docs/spec/server/store/blobstore.md 작성
Step 1:  npm install @aws-sdk/client-s3 -w server
Step 2:  testing/mocks/s3Mock.js 작성
Step 3:  blobstore/__tests__/S3BlobStore.test.js 작성 → 실행 (실패)
Step 4:  S3BlobStore.js 구현 → 테스트 통과 ✅
Step 5:  blobstore/__tests__/blobstoreFactory.test.js 작성 → 실행 (실패)
Step 6:  NoOpBlobStore.js + index.js factory 구현 → 테스트 통과 ✅
```

## Verification Command

```bash
npm run test -w server -- --testPathPattern="blobstore"
```

All tests must pass. Coverage for new files should be >= 90%.

---

## Commit Strategy (per task)

| Order | Commit Message | Files Changed |
|-------|---------------|---------------|
| 1 | `docs: add blobstore adapter spec` | `docs/spec/server/store/blobstore.md` |
| 2 | `chore: add @aws-sdk/client-s3 dependency` | `server/package.json`, `package-lock.json` |
| 3 | `test: add S3 mock for unit tests` | `server/testing/mocks/s3Mock.js` |
| 4 | `feat: implement S3BlobStore adapter` | `S3BlobStore.js`, `S3BlobStore.test.js` |
| 5 | `feat: add NoOpBlobStore + factory for blobstore adapters` | `NoOpBlobStore.js`, `index.js`, `blobstoreFactory.test.js` |

---

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `@aws-sdk/client-s3` version incompatibility | Pin to latest stable minor; test against MinIO (S3-compatible) in E2E |
| Stream handling complexity in downloadBlob | Use simple Buffer.concat approach for correctness first; optimize later if needed |
| listOrphanedKeys pagination performance | Collect all keys up to reasonable limit; add logging for monitoring |
| Empty bucket returns `Contents: undefined` | Defensive coding: `response.Contents ?? []` in all list operations |
| Keys modified during pagination | Phase 6 GC uses DB state diff — best-effort approach documented |
| `S3_ENDPOINT` not set defaults to AWS | Factory validates required vars; document in `.env.example` |
| `forcePathStyle` misconfiguration | Only enable when `config.endpoint` present; test with MinIO mock |
