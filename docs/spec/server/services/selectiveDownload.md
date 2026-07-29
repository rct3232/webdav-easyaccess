# selectiveDownload (selectiveCollectFiles) Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Selectively collect downloadable file paths under a directory tree (recursive_strict). Uses callbacks to decide which directories to enter and which files to include. Used for ZIP download preparation. Default adapter is FileStoreAdapter. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/selectiveDownload.js`
- **Test file:** `server/domains/files/services/__tests__/selectiveDownload.test.js`

### 2.2 Function Signature

```js
async function selectiveCollectFiles({ rootPath, basePath, canEnterDirectory, canIncludeFile, webdav })
```

### 2.3 Input

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| rootPath | string | yes | Root directory path |
| basePath | string | no | Base for relative paths (default: '') |
| canEnterDirectory | (dirPath) => boolean \| Promise\<boolean\> | yes | Whether to enter a directory |
| canIncludeFile | (filePath) => boolean \| Promise\<boolean\> | yes | Whether to include a file |
| webdav | object | no | Adapter with listDirectory; defaults to `createFileStoreAdapter()` |

### 2.4 Return

- `{ files, skippedPaths }`
- files: `[{ path, relativePath }]`
- skippedPaths: paths skipped (no entry/inclusion)

### 2.5 Dependencies

- FileStoreAdapter (`createFileStoreAdapter` from `../../../infrastructure/adapters/filestore`)
- metaPaths (isMetaPath), errorHandler (createError), SERVER_ERROR_CODES
- `@webdav-easyaccess/shared/pathUtils` (normalizePath)

### 2.6 Error Cases

- Missing callbacks → 400
- Meta path root → 403

### 2.7 Verification Scenarios

- [ ] Returns files array with path and relativePath
- [ ] canEnterDirectory/canIncludeFile filter correctly
- [ ] Meta path throws 403
- [ ] FileStoreAdapter mock for unit tests (replacing direct WebDAV calls)
