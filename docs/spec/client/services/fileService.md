# fileService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | File and folder CRUD, bulk operations (move, copy, delete, download), upload, conflict check, metadata, thumbnails. Supports share token for public share links. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/fileService.js`
- **Test file:** `client/src/services/__tests__/fileService.test.js`

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| listFiles | (path, options?) | Promise\<Array\> | GET /api/files/list |
| getFilesMetadata | (paths, options?) | Promise\<Array\> | POST /api/files/metadata |
| getFileBlob | (filePath, options?) | Promise\<Blob\> | GET /api/files/download |
| downloadFile | (filePath) | Promise\<void\> | GET /api/files/download (blob, triggers download) |
| uploadFileWithPath | (file, targetPath, relativePath, onConflict, signal?) | Promise\<Object\> | POST /api/files/upload |
| uploadMultipleFiles | (files, targetPath, onProgress, onConflict, options?) | Promise\<{ results, errors }\> | POST /api/files/upload (per file) |
| renameFile | (oldPath, newName) | Promise\<Object\> | PUT /api/files/rename |
| createFolder | (folderPath) | Promise\<Object\> | POST /api/folders/create |
| checkConflicts | (operations, options?) | Promise\<Array\> | POST /api/files/check-conflicts |
| downloadMultipleFiles | (paths, onProgress, options?) | Promise\<Object\> | POST /api/files/download-multiple |
| getDownloadProgress | (downloadId, options?) | Promise\<Object\> | GET /api/files/download-progress/:id |
| batchDeleteFiles | (paths) | Promise\<{ jobId }\> | POST /api/files/batch-delete |
| batchMoveFiles | (moves, onConflict?) | Promise\<{ jobId }\> | POST /api/files/batch-move |
| batchCopyFiles | (copies, onConflict?) | Promise\<{ jobId }\> | POST /api/files/batch-copy |
| getBulkOperationStatus | (jobId) | Promise\<Object\> | GET /api/files/bulk-operation/:jobId |
| cancelBulkOperation | (jobId) | Promise\<Object\> | POST /api/files/bulk-operation/:jobId/cancel |
| requestThumbnailsBatch | (paths, options?) | Promise\<Object\> | POST /api/files/thumbnails/batch |
| checkPermission | (path) | Promise\<Object\> | delegates to permissionService |
| getWebDAVInfo | () | Promise\<Object\> | GET /api/webdav/info |

- `shareToken` in options: listFiles, getFilesMetadata, getFileBlob, uploadFileWithPath, uploadMultipleFiles, checkConflicts, downloadMultipleFiles, getDownloadProgress, requestThumbnailsBatch. When set, uses `X-Share-Token` header and query params.
- `downloadFile` does **not** accept options (authenticated user only; no share token support).

### 2.3 Error Handling

- Uses getServerErrorDisplay, errorUtils for client display
- Upload: CONFLICT (409) returned as duplicate; errors array in uploadMultipleFiles
- Bulk ops: error via getBulkOperationStatus or thrown

### 2.4 Verification Scenarios

- [ ] listFiles returns array; shareToken passed when provided
- [ ] uploadMultipleFiles calls onProgress, returns results/errors
- [ ] batchMove/batchCopy return jobId; status polled via getBulkOperationStatus
- [ ] downloadMultipleFiles triggers download, onProgress called
- [ ] checkConflicts returns conflicts array
