# downloadService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | nodeId-based multi-file ZIP download with async permission checks per file. Replaces path-based `downloadService.js` where paths are resolved to nodeIds before entering service. No direct WebDAV or S3 calls; all blob retrieval goes through `blobStorageService`. Assembles streaming ZIP archive via archiver library, tracks progress through operationProgress store, and returns structured error entries for files that fail permission checks or blob retrieval. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/downloadService.js`
- **Test file:** `server/domains/files/services/__tests__/downloadService.test.js`

### 2.2 Implementation Status

| Component | Status | Wave |
|-----------|--------|------|
| Factory (`createDownloadService`) | Implemented — accepts `{ fileNodeService, blobStorageService, aclService }` | Task W4.1 (Wave 4) |
| `downloadMultiple` | Implemented — uses `aclService.checkFilePermission` per file via `Promise.allSettled` | Wave 4 |
| `getDownloadProgress` | Spec'd — in-memory Map with TTL; Redis upgrade path documented | Future |

### 2.3 Factory Function Signature

```js
function createDownloadService({ fileNodeService, blobStorageService, aclService }) {
  return {
    downloadMultiple(nodeIds, userId, user),
    getDownloadProgress(downloadId)
  };
}
```

### 2.3 Methods

#### `downloadMultiple(nodeIds, userId, user)`

Assembles a ZIP archive from multiple file node IDs with per-file async permission gating. Returns a streaming response — does not buffer the entire archive in memory.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeIds | number[] | yes | Array of file node IDs to include in the ZIP |
| userId | string | yes | ID of the requesting user for permission checks |
| user | object | yes | User context passed through for downstream resolution |

**Returns:** `{ zipStream, totalFiles, downloadId }` — `zipStream` is a readable stream from archiver; `totalFiles` is the count of files that passed permission checks; `downloadId` is a UUID keying progress entries in the operationProgress store.

**Flow:**

1. **Permission pre-check (async per file):** For each nodeId in input, call `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ)` concurrently via `Promise.allSettled`.
2. **Partition results:** Files passing permission checks enter the inclusion list; files failing produce entries in `errors[]` with `{ nodeId, reason: 'permission_denied' }`.
3. **All-fail guard:** If ALL nodeIds fail permission checks, return 403 immediately — no ZIP assembly proceeds.
4. **ZIP initialization:** Create archiver instance (`archiver('zip', { zlib: { level: 6 } })`) and generate `downloadId` (UUID v4). Write initial progress entry via operationProgress store with `{ completed: 0, total: inclusionList.length, percentage: 0 }`.
5. **Streaming assembly:** Iterate inclusion list sequentially — for each nodeId: resolve active object_map row via `fileNodeService`, retrieve display name from `file_nodes.name` column, stream blob content through `blobStorageService.downloadBlob(nodeId)`, append to archiver with the display name as entry path. On success, increment progress counter and write updated progress entry.
6. **Finalize:** Finalize archiver, update progress to `{ completed: totalFiles, total: totalFiles, percentage: 100 }`. Return `{ zipStream, totalFiles, downloadId }` with `errors[]` attached for downstream middleware to include in response metadata.

**Error entries format:** Each skipped file appends to `errors[]`:
```js
{ nodeId: <number>, reason: '<permission_denied | not_found | blob_error>', detail?: string }
```

#### `getDownloadProgress(downloadId)`

Reads progress state for a given download operation from the in-memory Map (or future Redis-backed operationProgress store).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| downloadId | string | yes | UUID returned by `downloadMultiple` |

**Returns:** `{ completed: number, total: number, percentage: number } \| null — returns null for expired or unknown downloadId.

### 2.4 Dependencies

- `fileNodeService` — node resolution (`getNodeById`, display name from `file_nodes.name`)
- `blobStorageService` — blob retrieval (`downloadBlob(fileNodeId)`)
- `aclService` — async permission checks (`checkFilePermission(userId, nodeId, PERMISSIONS.READ)`)

---

## 3. Permission Check Per File

For each nodeId in the input array, `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.READ)` is invoked asynchronously before any blob retrieval occurs. All checks execute concurrently via `Promise.allSettled`. Files failing their permission check are excluded from ZIP assembly and recorded as error entries with `reason: 'permission_denied'`. If every nodeId in the input fails its permission check, the method returns a 403 response immediately without initializing archiver or assembling any archive.

---

## 4. ZIP Assembly Flow

The ZIP is assembled using a streaming approach — no full archive buffer resides in memory at any point.

1. **Iterate nodeIds** — process each nodeId from the inclusion list sequentially to maintain deterministic file ordering in the archive.
2. **Resolve active object_map** — for each nodeId, look up the current active blob mapping via `fileNodeService`.
3. **Stream blob content** — call `blobStorageService.downloadBlob(nodeId)` to retrieve the content buffer, then pipe it into archiver as a file entry using the display name from `file_nodes.name` as the archive entry path.
4. **Pipe to response** — archiver writes directly to the outgoing HTTP response stream via middleware layer; service returns the zipStream for piping.

The streaming approach ensures memory usage remains bounded regardless of total archive size. Each file's blob is downloaded, appended to the ZIP stream, and released before the next file begins processing.

---

## 5. Progress Tracking

Progress entries are written to the operationProgress store keyed by `downloadId`. The store uses an in-memory Map for initial implementation with a path to Redis-backed storage for horizontal scaling.

| Operation | Method | Description |
|-----------|--------|-------------|
| Initialize | `setDownloadProgress(downloadId, { completed: 0, total, percentage: 0 })` | Written before ZIP assembly begins |
| Update per file | `setDownloadProgress(downloadId, { completed: n+1, total, percentage: ((n+1)/total)*100 })` | Written after each successful file append |
| Finalize | `setDownloadProgress(downloadId, { completed: total, total, percentage: 100 })` | Written when archiver finalizes |

The progress is pollable via a separate GET endpoint consuming `getDownloadProgress(downloadId)`. TTL-based cleanup removes expired entries after download completion to prevent unbounded memory growth in the in-memory Map implementation.

---

## 6. Error Cases

| Condition | Behavior |
|-----------|----------|
| nodeId not found in file_nodes table | Skipped with error entry `{ nodeId, reason: 'not_found' }` — does not abort assembly of remaining files |
| blob download fails for a nodeId (blobStorageService returns null or throws) | Recorded as `{ nodeId, reason: 'blob_error', detail: <error message> }` — assembly continues with remaining files |
| Permission denied for all nodeIds | Returns 403 response immediately; no ZIP archive initialized |
| Permission denied for subset of nodeIds | Denied files excluded with error entries; ZIP assembled from permitted files only |
| Unknown downloadId in `getDownloadProgress` | Returns null (no throw) |
| Expired downloadId in progress store | Returns null after TTL expiration |

---

## 7. Verification Scenarios

- [ ] downloadMultiple with all-permitted nodeIds produces ZIP containing all files with correct display names
- [ ] downloadMultiple with mixed permissions includes only permitted files and records errors for denied nodes
- [ ] downloadMultiple with all-denied nodeIds returns 403 without initializing archiver
- [ ] downloadMultiple streams archive incrementally — memory usage does not scale with total ZIP size
- [ ] getDownloadProgress returns correct `{ completed, total, percentage }` at initialization midpoint, and completion stages
- [ ] getDownloadProgress returns null for unknown downloadId
- [ ] getDownloadProgress returns null for expired downloadId after TTL
- [ ] nodeId not found in file_nodes results in error entry with reason 'not_found' — assembly continues
- [ ] blobStorageService.downloadBlob returning null produces error entry with reason 'blob_error'
