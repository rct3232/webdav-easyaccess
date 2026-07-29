# selectiveTransfer Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Selectively move or copy a directory tree (recursive_strict). Uses callbacks to decide which directories to enter and which files to transfer. Integrates with permission policy via canEnterDirectory and canTransferFile. Default adapter is FileStoreAdapter. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/selectiveTransfer.js`
- **Test file:** `server/domains/files/services/__tests__/selectiveTransfer.test.js`

### 2.2 Function Signature

```js
async function selectiveTransfer({ sourceRoot, destRoot, mode, canEnterDirectory, canTransferFile, onConflict, webdav })
```

### 2.3 Input

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| sourceRoot | string | yes | Source directory path |
| destRoot | string | yes | Destination directory path |
| mode | 'move' \| 'copy' | yes | Operation mode |
| canEnterDirectory | (dirPath) => boolean \| Promise\<boolean\> | yes | Whether to enter a directory |
| canTransferFile | (filePath) => boolean \| Promise\<boolean\> | yes | Whether to transfer a file |
| onConflict | 'error' \| 'overwrite' \| 'skip' | no | Default: 'error' |
| webdav | object | no | Adapter with listDirectory, createDirectory, moveFile, copyFile, deleteFile, pathExists; defaults to `createFileStoreAdapter()` |

### 2.4 Return

- `{ movedDirMappings, createdDirs, skippedPaths }`
- movedDirMappings: `[{ fromPrefix, toPrefix }]` (directories fully moved)
- createdDirs: destination directories created
- skippedPaths: skipped paths (no transfer/entry)

### 2.5 Dependencies

- FileStoreAdapter (`createFileStoreAdapter` from `../../../infrastructure/adapters/filestore`)
- metaPaths (isMetaPath), asyncUtils (asyncLimit)
- errorHandler (createError), SERVER_ERROR_CODES
- `@webdav-easyaccess/shared/pathUtils` (normalizePath)

### 2.6 Error Cases

- Invalid mode → 400
- Missing callbacks → 400
- Meta path in source/dest → 403
- Destination exists + onConflict 'error' → 409
- move 중 source 삭제: 각 파일/디렉터리 작업 시 not found → throw 또는 skippedPaths
- copy 중 dest disk full: writeFile ENOSPC → throw

### 2.7 Verification Scenarios

- [ ] Move/copy with permission callbacks returns correct movedDirMappings, createdDirs, skippedPaths
- [ ] onConflict skip: skippedPaths include conflicting items
- [ ] Meta path throws 403
- [ ] FileStoreAdapter mock for unit tests (replacing direct WebDAV calls)
- [ ] move 중 source 없음 시 동작
- [ ] copy 중 disk full 시 throw
