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

| Function | Signature | Description |
|----------|-----------|-------------|
| getWebDAVClient | (baseUrlOverride?) => Promise | Get/create WebDAV client |
| resetWebDAVClient | () => void | Reset client cache |
| listDirectory | (path) => Promise\<Array\> | List folder |
| getFileContents | (path, options?) => Promise\<Buffer\> | Get file content |
| putFileContents | (path, buffer) => Promise | Put file |
| putFileContentsAdvanced | (path, buffer, options?) => Promise | Put file with options |
| customRequest | (options) => Promise | Custom WebDAV request |
| deleteFile | (path) => Promise | Delete file/folder |
| moveFile | (source, dest) => Promise | Move |
| copyFile | (source, dest) => Promise | Copy |
| createDirectory | (path) => Promise | Create dir |
| pathExists | (path) => Promise\<boolean\> | Check path exists |
| getFileMetadata | (path) => Promise\<object\> | Get file metadata |
| getRequestPath | (path, baseUrl?, options?) => string | Request path |
| buildDestinationAbsoluteUrl | (base, dest, options?) => string | Destination URL |
| isImageFile | (file) => boolean | Image check |
| isVideoFile | (file) => boolean | Video check |
| testConnection | () => Promise | Test WebDAV connection |
| getRecursiveFolderStats | (path) => Promise\<object\> | Recursive folder statistics (fileCount, totalSize). Used by GET /api/folders/stats. |

### 2.3 Input / Output

- Paths normalized via shared pathUtils
- Errors via createError

### 2.4 Dependencies

- webdav (createClient), asyncUtils, errorHandler
- WEBDAV_URL env

### 2.5 Mock Targets

- webdav.createClient
- process.env.WEBDAV_URL

### 2.6 Verification Scenarios

- [ ] listDirectory, getFileContents, putFileContents
- [ ] moveFile, copyFile, deleteFile
- [ ] buildDestinationAbsoluteUrl encoding
- [ ] pathExists, getFileMetadata
- [ ] Error handling
