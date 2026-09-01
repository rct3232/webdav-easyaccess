# fileService Spec

## 1. Overview

| Item | Description                                                                                                                                                      |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | File and folder CRUD, bulk operations (move, copy, delete, download), upload, conflict check, metadata, thumbnails. Supports share token for public share links. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/fileService.js`
- **Test file:** `client/src/services/__tests__/fileService.test.js`

### 2.2 Main Functions

| Function                 | Input                                                            | Return                                                | API called                                                                                                          |
| ------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| listFiles                | (nodeId, options?)                                               | Promise\<Array\>                                      | GET /api/files/list. `nodeId` may be `null`/omitted to list the root level; sends only `nodeId` (and `shareToken`). |
| getFilesMetadata         | (nodeIds, options?)                                              | Promise\<Array\>                                      | POST /api/files/metadata                                                                                            |
| getFileBlob              | (nodeId, options?)                                               | Promise\<Blob\>                                       | GET /api/files/download. `options.signal` (AbortSignal) forwarded to request for cancellation.                      |
| getVideoPreviewStreamUrl | (nodeId, options?)                                               | Promise\<string\>                                     | POST /api/files/preview-ticket + GET /api/files/preview-stream (as URL)                                             |
| downloadFile             | (nodeId, options?)                                               | Promise\<void\>                                       | GET /api/files/download; behavior depends on options and platform (see § 2.3 Download behavior)                     |
| uploadFileWithPath       | (file, parentNodeId, relativePath, onConflict, signal?)          | Promise\<Object\>                                     | POST /api/files/upload                                                                                              |
| uploadMultipleFiles      | (files, parentNodeId, onProgress, onConflict, options?)          | Promise\<{ results, errors }\>                        | POST /api/files/upload (per file)                                                                                   |
| renameFile               | (nodeId, newName)                                                | Promise\<Object\>                                     | PUT /api/files/rename                                                                                               |
| createFolder             | (parentNodeId, name)                                             | Promise\<Object\>                                     | POST /api/folders/create. NodeId-only: sends `{ parentNodeId, name }`.                                              |
| checkConflicts           | (operations with sourceNodeId/destinationParentNodeId, options?) | Promise\<Array\>                                      | POST /api/files/check-conflicts                                                                                     |
| downloadMultipleFiles    | (nodeIds, onProgress, options?)                                  | Promise\<Object\>                                     | POST /api/files/download-multiple                                                                                   |
| getDownloadProgress      | (downloadId, options?)                                           | Promise\<Object\>                                     | GET /api/files/download-progress/:id                                                                                |
| batchDeleteFiles         | (nodeIds)                                                        | Promise\<{ jobId }\>                                  | POST /api/files/batch-delete                                                                                        |
| batchMoveFiles           | (moves with sourceNodeId/destinationParentNodeId, onConflict?)   | Promise\<{ jobId }\>                                  | POST /api/files/batch-move                                                                                          |
| batchCopyFiles           | (copies with sourceNodeId/destinationParentNodeId, onConflict?)  | Promise\<{ jobId }\>                                  | POST /api/files/batch-copy                                                                                          |
| getBulkOperationStatus   | (jobId)                                                          | Promise\<Object\>                                     | GET /api/files/bulk-operation/:jobId                                                                                |
| cancelBulkOperation      | (jobId)                                                          | Promise\<Object\>                                     | POST /api/files/bulk-operation/:jobId/cancel                                                                        |
| requestThumbnailsBatch   | (nodeIds, options?)                                              | Promise\<{ thumbnails: [{ nodeId, thumbnailUrl }] }\> | POST /api/thumbnails/batch `{ nodeIds }`                                                                            |
| getWebDAVInfo            | ()                                                               | Promise\<Object\>                                     | GET /api/webdav/info                                                                                                |
| getFolderStats           | (nodeId)                                                         | Promise\<object\>                                     | GET /api/folders/stats (params: nodeId)                                                                             |

> **Note (pending implementation):** The 5 legacy permission helpers (`checkPermission`, `checkFilePermission`, `grantFilePermission`, `revokeFilePermission`, `updateFilePermission`) are **removed** from this service contract. They are legacy permission helpers that belong to `permissionService`; `fileService` exposes only nodeId-based file/folder operations. The current source still exports nodeId-based wrappers over `permissionService`; those exports will be dropped in the end-state cleanup.

- `shareToken` in options: listFiles, getFilesMetadata, getFileBlob, uploadFileWithPath, uploadMultipleFiles, checkConflicts, downloadMultipleFiles, getDownloadProgress, requestThumbnailsBatch. When set, uses `X-Share-Token` header and query params.
- `downloadFile` is **authenticated user only** (no share token support). It accepts an optional `options` object for platform- and file-type–specific behavior (see § 2.3).
- `getVideoPreviewStreamUrl` is used by **video preview only** (FilePreviewDialog). It returns a URL string suitable for `<video src>` without requiring custom headers. It must not embed JWT in query params; it uses a short-lived ticket from the server.

### 2.3 Download behavior (single-file)

- **Default (non-iOS):** Fetch blob via GET /api/files/download, then trigger download via `<a download>` (existing behavior). No options required.
- **iOS + single file (all types):** When the client detects iOS (e.g. UA or capability), use a share-sheet-friendly path for single-file downloads:
  1. **First:** Create a `File` from the blob, then call `navigator.canShare({ files: [file] })` with the actual `File` instance (file-type support varies; e.g. zip may return `false`). If `canShare` returns true, call `navigator.share({ files: [file], title })` so the system share sheet appears. The user can choose "Save to Files" or similar. On success or `AbortError`, return. No `options` required; the service derives filename/extension from `filePath` or optional `options.fileName` / `options.mimeType`.
  2. **Fallback:** If `navigator.canShare({ files: [file] })` returns false or `navigator.share` fails with a non-AbortError, use `typedBlob` + `<a download>` + `visibilitychange` revoke (same as existing iOS fallback).
- **All other cases:** Use the default blob + `<a download>` behavior. Folder and multi-file (zip) downloads are unchanged.

Helpers (internal or in a shared util): **isIOS** (platform). No `isImageFile` or `canShareFiles` helper; use `navigator.canShare({ files: [file] })` with the actual `File` to check share support per file type.

### 2.4 downloadFile options (optional)

| Option   | Type    | Description                                                                                                                 |
| -------- | ------- | --------------------------------------------------------------------------------------------------------------------------- |
| fileName | string  | Display name for the file (e.g. for share sheet). If omitted, derived from `filePath`.                                      |
| mimeType | string  | MIME type for the file (e.g. for creating a `File` for `navigator.share`). If omitted, inferred from extension or response. |
| isMobile | boolean | Hint that the client is on a mobile device; can be used together with platform detection for iOS + single-file share path.  |

### 2.5 Error Handling

- Uses getServerErrorDisplay, errorUtils for client display
- Upload: CONFLICT (409) returned as duplicate; errors array in uploadMultipleFiles
- Bulk ops: error via getBulkOperationStatus or thrown
- listFiles(nodeId): nodeId가 null/undefined면 루트 레벨 목록 요청 (nodeId 파라미터 없이)
- uploadMultipleFiles: 결과는 { results: Array, errors: Array }; results는 성공 항목, errors는 { path, error } 등. 부분 성공 허용
- cancelBulkOperation: 404(존재하지 않는 jobId) 또는 이미 완료된 job → 구현체별 (에러 throw 또는 200)
- 타임아웃: apiClient 5분; 개별 요청 실패 시 getServerErrorDisplay로 표시

### 2.6 Verification scenarios

- [ ] listFiles returns array; nodeId sent when provided; shareToken passed when provided
- [ ] getFilesMetadata with empty nodeIds returns []
- [ ] getFileBlob with inline option; shareToken in options passed
- [ ] getVideoPreviewStreamUrl returns a URL (not a Blob URL) and includes the server-issued ticket; shareToken is supported when provided
- [ ] downloadFile is auth-only; with no options uses blob + &lt;a download&gt;
- [ ] On iOS + single file: when `navigator.canShare({ files: [file] })` returns true, share path is used (share sheet); otherwise fallback (typedBlob + &lt;a download&gt;) is used
- [ ] Non-iOS: download uses default blob + &lt;a download&gt;; folder/multi-file download unchanged
- [ ] createFolder calls POST /api/folders/create with parentNodeId and name
- [ ] requestThumbnailsBatch posts `{ nodeIds }` to POST /api/thumbnails/batch and maps the response `{ thumbnails: [{ nodeId, thumbnailUrl }] }` by nodeId
- [ ] uploadMultipleFiles calls onProgress, returns results/errors
- [ ] batchMove/batchCopy return jobId; status polled via getBulkOperationStatus
- [ ] downloadMultipleFiles triggers download, onProgress called
- [ ] checkConflicts returns conflicts array
- [ ] listFiles() 또는 nodeId 없음 시 root 동작
- [ ] uploadMultipleFiles 부분 성공 시 results/errors 구조
- [ ] cancelBulkOperation 404 또는 완료된 job
- [ ] batchMove/batchCopy onConflict 옵션별 동작
