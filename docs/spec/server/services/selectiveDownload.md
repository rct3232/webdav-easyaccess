# selectiveDownload (selectiveCollectFiles) Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Selectively collect downloadable file paths under a directory tree (recursive_strict). Uses callbacks to decide which directories to enter and which files to include. Used for ZIP download preparation. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/services/selectiveDownload.js`
- **Test file:** `server/services/__tests__/selectiveDownload.test.js`

### 2.2 Input

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| rootPath | string | yes | Root directory path |
| basePath | string | no | Base for relative paths (default: '') |
| canEnterDirectory | (dirPath) => boolean \| Promise\<boolean\> | yes | Whether to enter a directory |
| canIncludeFile | (filePath) => boolean \| Promise\<boolean\> | yes | Whether to include a file |
| webdav | object | no | Adapter with listDirectory |

### 2.3 Return

- `{ files, skippedPaths }`
- files: `[{ path, relativePath }]`
- skippedPaths: paths skipped (no entry/inclusion)

### 2.4 Dependencies

- WebDAV utils (listDirectory)
- metaPaths (isMetaPath)
- errorHandler (createError), SERVER_ERROR_CODES

### 2.5 Error Cases

- Missing callbacks → 400
- Meta path root → 403

### 2.6 Verification Scenarios

- [ ] Returns files array with path and relativePath
- [ ] canEnterDirectory/canIncludeFile filter correctly
- [ ] Meta path throws 403
- [ ] Store/WebDAV mock for unit tests
