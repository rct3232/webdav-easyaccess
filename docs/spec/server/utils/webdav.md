# webdav Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | WebDAV client wrapper: getFileContents, listDirectory, createDirectory, move, copy, delete, etc. Path normalization, buildDestinationAbsoluteUrl. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/webdav.js`
- **Test file:** `server/utils/__tests__/webdav.test.js`

### 2.2 Functions / Exports

#### Native functions (defined in `server/utils/webdav.js`)

| Function | Signature | Description |
|----------|-----------|-------------|
| getWebDAVClient | (baseUrlOverride?) => Promise | Get/create WebDAV client with caching via InMemoryCacheAdapter |
| resetWebDAVClient | () => void | Reset client cache |
| listDirectory | (path) => Promise\<Array\> | List folder contents, normalizing item shape |
| getFileContents | (path, options?) => Promise\<Buffer\> | Get file content as Buffer |
| putFileContents | (path, buffer) => Promise | Write file via PUT |
| putFileContentsAdvanced | (path, buffer, options?) => Promise | Put file with advanced headers (e.g. If-None-Match: \*) |
| customRequest | (options) => Promise | Custom WebDAV request (MOVE, COPY, PROPFIND, etc.) |
| deleteFile | (path, options?) => Promise | Delete file/folder |
| moveFile | (source, dest, progressCallback?, overwrite?, options?) => Promise | Move with fallback to streamed copy+delete |
| copyFile | (source, dest, progressCallback?, overwrite?, options?) => Promise | Copy with fallback to streamed download+upload |
| createDirectory | (path) => Promise | Create directory — recursive and idempotent (see §2.2.2) |
| ensureDirectoryExists | (path) => Promise | Ensure a directory exists via recursive MKCOL root → deepest; tolerant of already-existing collections |
| pathExists | (path) => Promise\<boolean\> | Check path exists (direct PROPFIND + directory-list fallback) |
| getFileMetadata | (path) => Promise\<object\> | Get file metadata via parent directory listing |
| getRequestPath | (path, baseUrl?, options?) => string | Build request path from normalized path |
| buildDestinationAbsoluteUrl | (base, dest, options?) => string | Destination URL for MOVE/COPY headers |
| getRecursiveFolderStats | (path) => Promise\<object\> | Recursive folder statistics (fileCount, totalSize). Used by GET /api/folders/stats. |

#### Re-exported functions (defined elsewhere, re-exported from webdav.js for backward compatibility)

| Function | Actual location | Description |
|----------|----------------|-------------|
| testConnection | `server/infrastructure/webdavTest.js` | Test WebDAV connectivity (creates ephemeral client, probes root directory) |
| isImageFile | `server/utils/fileTypes.js` | Check if filename has an image extension via shared `getFileType()` |
| isVideoFile | `server/utils/fileTypes.js` | Check if filename has a video extension via shared `getFileType()` |

### 2.2.1 FileStoreAdapter Abstraction Layer

WebDAV file operations are abstracted behind the **FileStoreAdapter** interface (`server/infrastructure/adapters/filestore/FileStoreAdapter.js`). The default implementation, `WebdavFileStoreAdapter`, delegates all calls to this module via the factory `createFileStoreAdapter()` in `server/infrastructure/adapters/filestore/index.js`.

This adapter layer enables:
- Swapping file storage backends without touching domain code
- Test injection of mock adapters
- Consistent method signatures across implementations

The adapter exposes the following interface methods: `listDirectory`, `getFileContents`, `putFileContents`, `moveFile`, `copyFile`, `deleteFile`, `createDirectory`, `ensureDirectoryExists`, `pathExists`, `getFileMetadata`.

### 2.2.2 MKCOL-on-create semantics (`createDirectory` / `ensureDirectoryExists`)

Both functions delegate to the same recursive implementation: MKCOL each missing path
segment from root to deepest, tolerating already-existing collections.

- **Why recursion:** many WebDAV servers (bytemark included) reject MKCOL with `409 Conflict`
  when the parent collection is missing. Creating root → deepest segments guarantees parents
  exist before children.
- **Already-exists tolerance:** `405 Method Not Allowed`, `301/302/303` redirects, or error
  messages matching `already exists`/`method not allowed` are treated as success. A `409`
  is disambiguated with a `client.exists()` probe before being treated as a real failure.
- **Callers:** `WebdavFileStoreAdapter.createDirectory` (and thus `WebdavBlobStore.createDirectory`,
  used by `blobStorageService.createDirectoryWebdav`), `selectiveTransfer`, and the
  streamed move/copy fallbacks. The tolerance makes these callers' existing
  "already exists" error swallowing redundant but harmless.

### 2.3 Input / Output

- Paths normalized via shared pathUtils
- Errors via createError

### 2.3.1 `pathExists` Usage Policy

- `pathExists` is retained for correctness-sensitive checks and reconciliation workers.
- `pathExists` must not be used as an unbounded per-item synchronous operation in `GET /api/permissions/user/:userId`.
- Bulk existence validation must use bounded concurrency (`asyncLimit`-style control) and run outside latency-critical request handling when possible.

### 2.3.2 Existence Reconciliation Contract

- Reconciliation workers call `pathExists` to refresh existence index entries.
- Refresh writes `checkedAt` metadata and state (`exists` / `missing`) for later fast-path reads.
- On transient WebDAV failures, reconciliation should defer hard exclusion and allow route-layer `unknown` semantics.

### 2.4 Dependencies

- `webdav` npm package (`createClient`)
- `asyncUtils` (for `asyncLimit` concurrency control)
- `errorHandler` (for `createError`)
- `shared/pathUtils` (for path normalization)
- `infrastructure/adapters/cache` — InMemoryCacheAdapter for client caching
- Environment: `WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`, `WEBDAV_AUTH_TYPE`, `WEBDAV_UPSTREAM_URL`

### 2.5 Mock Targets

- `webdav.createClient` (dynamic import)
- `process.env.WEBDAV_URL`, `WEBDAV_USERNAME`, `WEBDAV_PASSWORD`
- For adapter-level tests, mock via `createFileStoreAdapter()` factory instead of this module directly

### 2.6 Verification Scenarios

- [ ] listDirectory, getFileContents, putFileContents
- [ ] moveFile, copyFile, deleteFile
- [ ] buildDestinationAbsoluteUrl encoding
- [ ] pathExists, getFileMetadata
- [ ] Error handling
- [ ] `pathExists` fallback behavior (direct exists check + directory-list fallback) remains correct
- [ ] bounded reconciliation usage avoids unbounded parallel WebDAV calls
- [ ] reconciliation failures are handled without leaking credentials or blocking permission-list API responses
