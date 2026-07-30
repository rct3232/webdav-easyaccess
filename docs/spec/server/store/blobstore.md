# blobstore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | S3 blob store adapter — flat opaque-key blob storage for file content. Works with `object_map` to map file nodes to physical blobs. Two-tier GC strategy (DB-driven orphan cleanup + S3 bucket reconciliation). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/infrastructure/adapters/blobstore/S3BlobStore.js`
- **NoOp stub:** `server/infrastructure/adapters/blobstore/NoOpBlobStore.js`
- **Factory:** `server/infrastructure/adapters/blobstore/index.js`
- **Test files:** `__tests__/S3BlobStore.test.js`, `__tests__/blobstoreFactory.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| uploadBlob | (key: string, buffer: Buffer) => Promise\<void\> | Upload binary data to S3 with given key |
| downloadBlob | (key: string) => Promise\<Buffer\> | Download blob as Buffer from S3 |
| deleteBlob | (key: string) => Promise\<void\> | Delete blob from S3 (idempotent) |
| headBlob | (key: string) => Promise\<{contentLength, contentType}\> | Get metadata without downloading body |
| listOrphanedKeys | (olderThan: Date) => Promise\<string[]\> | List keys older than threshold (for GC Tier 2) |

NoOpBlobStore implements the same signatures as no-op stubs for WebDAV mode.

### 2.3 Backend Strategy

- `WEA_FILE_STORAGE=s3` → S3BlobStore (real S3 operations via @aws-sdk/client-s3)
- `WEA_FILE_STORAGE=webdav` → NoOpBlobStore (no-op stub, file content stored on WebDAV server)

### 2.4 Configuration

| Variable | Purpose | Values | Required |
|----------|---------|--------|----------|
| WEA_FILE_STORAGE | Blob storage mode | `s3`, `webdav` | No (default: s3) |
| S3_BUCKET | Target S3 bucket name | string | Yes (for s3 mode) |
| AWS_REGION | AWS region | string | Yes (for s3 mode) |
| AWS_ACCESS_KEY_ID | Access key ID | string | Yes (for s3 mode) |
| AWS_SECRET_ACCESS_KEY | Secret access key | string | Yes (for s3 mode) |
| S3_ENDPOINT | Custom endpoint (MinIO, etc.) | URL string | No |

### 2.5 Dependencies

- `@aws-sdk/client-s3` — AWS SDK v3 for S3 operations
- `errorHandler` (`createError`) — standardized error creation
- `shared/SERVER_ERROR_CODES` — error code constants

No DDL duplication — `object_map` table is defined in `server/store/postgresql/ddl/001_initial_normalized_schema.sql`. Do not include code blocks. Reference source files by path only.

### 2.6 Verification Scenarios

- [ ] uploadBlob: stores object in S3 with correct key and body
- [ ] downloadBlob: retrieves object, returns Buffer matching original
- [ ] deleteBlob: removes object from S3 (idempotent on missing key)
- [ ] headBlob: returns {contentLength, contentType} without downloading body
- [ ] headBlob: throws 404 on missing key
- [ ] listOrphanedKeys: returns keys with LastModified < olderThan
- [ ] listOrphanedKeys: handles pagination (IsTruncated)
- [ ] listOrphanedKeys: handles empty bucket (Contents undefined)
- [ ] Factory: WEA_FILE_STORAGE=s3 → S3BlobStore instance
- [ ] Factory: WEA_FILE_STORAGE=webdav → NoOpBlobStore instance
- [ ] Factory: missing required env vars → throws clear error

### 2.7 Error Cases

| AWS SDK Error | HTTP Status | Behavior |
|---------------|-------------|----------|
| NoSuchKey / NotFound | 404 | Propagated as not-found error |
| NetworkingError / TimeoutError | 503 | Retryable — service unavailable |
| AccessDenied | 403 | Permission denied |
| NoSuchBucket | 500 | Configuration error — bucket missing |
| SignatureDoesNotMatch | 403 | Invalid credentials |
| SlowDown | 429 | Rate limited |
