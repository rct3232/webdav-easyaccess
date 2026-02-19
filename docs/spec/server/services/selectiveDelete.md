# selectiveDelete Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Selectively delete a directory tree (recursive_strict). Uses callbacks to decide which directories to enter and which files to delete. Does not delete a directory if any item in its subtree was skipped or failed. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/services/selectiveDelete.js`
- **Test file:** `server/services/__tests__/selectiveDelete.test.js`

### 2.2 Input

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| rootPath | string | yes | Root directory path |
| canEnterDirectory | (dirPath) => boolean \| Promise\<boolean\> | yes | Whether to enter a directory |
| canDeleteFileByParent | (filePath) => boolean \| Promise\<boolean\> | yes | Whether to delete a file |
| webdav | object | no | Adapter with listDirectory, deleteFile |
| allowMetaPath | boolean | no | Default: false. If true, allow meta paths. |

### 2.3 Return

- `{ deletedPaths, deletedDirPrefixes, skippedPaths }`
- deletedPaths: files and directories successfully deleted
- deletedDirPrefixes: directories fully deleted (for ACL cleanup)
- skippedPaths: paths skipped (no entry/deletion) or failed

### 2.4 Dependencies

- WebDAV utils (listDirectory, deleteFile)
- metaPaths (isMetaPath), asyncUtils (asyncLimit)
- errorHandler (createError), SERVER_ERROR_CODES

### 2.5 Error Cases

- Missing callbacks → 400
- Meta path root (when allowMetaPath false) → 403

### 2.6 Verification Scenarios

- [ ] Deletes only items passing callbacks
- [ ] Does not delete parent dir if subtree had skip/failure
- [ ] deletedDirPrefixes includes fully deleted dirs
- [ ] Meta path throws 403 (unless allowMetaPath)
- [ ] Store/WebDAV mock for unit tests
