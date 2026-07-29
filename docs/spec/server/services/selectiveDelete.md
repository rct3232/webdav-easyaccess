# selectiveDelete Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Selectively delete a directory tree (recursive_strict). Uses callbacks to decide which directories to enter and which files to delete. Does not delete a directory if any item in its subtree was skipped or failed. Default adapter is FileStoreAdapter. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/selectiveDelete.js`
- **Test file:** `server/domains/files/services/__tests__/selectiveDelete.test.js`

### 2.2 Function Signature

```js
async function selectiveDelete({ rootPath, canEnterDirectory, canDeleteFileByParent, webdav, allowMetaPath })
```

### 2.3 Input

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| rootPath | string | yes | Root directory path |
| canEnterDirectory | (dirPath) => boolean \| Promise\<boolean\> | yes | Whether to enter a directory |
| canDeleteFileByParent | (filePath) => boolean \| Promise\<boolean\> | yes | Whether to delete a file |
| webdav | object | no | Adapter with listDirectory, deleteFile; defaults to `createFileStoreAdapter()` |
| allowMetaPath | boolean | no | Default: false. If true, allow meta paths and .wea directories. |

### 2.4 Return

- `{ deletedPaths, deletedDirPrefixes, skippedPaths }`
- deletedPaths: files and directories successfully deleted
- deletedDirPrefixes: directories fully deleted (for ACL cleanup)
- skippedPaths: paths skipped (no entry/deletion) or failed

### 2.5 Dependencies

- FileStoreAdapter (`createFileStoreAdapter` from `../../../infrastructure/adapters/filestore`)
- metaPaths (isMetaPath), asyncUtils (asyncLimit)
- errorHandler (createError), SERVER_ERROR_CODES
- `@webdav-easyaccess/shared/pathUtils` (normalizePath)

### 2.6 Error Cases

- Missing callbacks → 400
- Meta path root (when allowMetaPath false) → 403

### 2.7 Verification Scenarios

- [ ] Deletes only items passing callbacks
- [ ] Does not delete parent dir if subtree had skip/failure
- [ ] deletedDirPrefixes includes fully deleted dirs
- [ ] Meta path throws 403 (unless allowMetaPath)
- [ ] FileStoreAdapter mock for unit tests (replacing direct WebDAV calls)
