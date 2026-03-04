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
| getFolderStats | (folderPath) | Promise\<object\> | GET /api/folders/stats (params: path) |

- `shareToken` in options: listFiles, getFilesMetadata, getFileBlob, uploadFileWithPath, uploadMultipleFiles, checkConflicts, downloadMultipleFiles, getDownloadProgress, requestThumbnailsBatch. When set, uses `X-Share-Token` header and query params.
- `downloadFile` does **not** accept options (authenticated user only; no share token support).

### 2.3 Error Handling

- Uses getServerErrorDisplay, errorUtils for client display
- Upload: CONFLICT (409) returned as duplicate; errors array in uploadMultipleFiles
- Bulk ops: error via getBulkOperationStatus or thrown
- listFiles(path): path 빈 문자열/undefined 시 normalizePath 결과 사용; root는 '/'
- uploadMultipleFiles: 결과는 { results: Array, errors: Array }; results는 성공 항목, errors는 { path, error } 등. 부분 성공 허용
- cancelBulkOperation: 404(존재하지 않는 jobId) 또는 이미 완료된 job → 구현체별 (에러 throw 또는 200)
- 타임아웃: apiClient 5분; 개별 요청 실패 시 getServerErrorDisplay로 표시

### 2.4 Verification Scenarios

- [ ] listFiles returns array; shareToken passed when provided
- [ ] getFilesMetadata with empty paths returns []
- [ ] getFileBlob with inline option; shareToken in options passed
- [ ] downloadFile does not accept options (auth-only)
- [ ] createFolder calls POST /api/folders/create
- [ ] uploadMultipleFiles calls onProgress, returns results/errors
- [ ] batchMove/batchCopy return jobId; status polled via getBulkOperationStatus
- [ ] downloadMultipleFiles triggers download, onProgress called
- [ ] checkConflicts returns conflicts array
- [ ] listFiles('') 또는 path 없음 시 동작
- [ ] uploadMultipleFiles 부분 성공 시 results/errors 구조
- [ ] cancelBulkOperation 404 또는 완료된 job
- [ ] batchMove/batchCopy onConflict 옵션별 동작
