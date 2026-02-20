# storage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Abstraction over WebDAV and local filesystem. Backend: WebDAV (prod) or fs (test, or WEA_STORAGE_BACKEND=fs). Provides ensureDir, exists, readFile, writeFile, deletePath, listDir. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storage.js`
- **Test file:** `server/store/__tests__/storage.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| getBackend | () => 'webdav' \| 'fs' | WEA_STORAGE_BACKEND, NODE_ENV=test → fs |
| getFsBaseDir | () => string | WEA_FS_DIR or WEA_METADATA_DIR or os.tmpdir() |
| ensureDir | (dirPath) => Promise\<void\> | Create dir (recursive for fs; step-by-step for WebDAV) |
| ensureDirSafe | (dirPath) => Promise\<void\> | Exists check, create, retry on error |
| exists | (p) => Promise\<boolean\> | Path exists |
| readFile | (p) => Promise\<Buffer\> | Read file contents |
| writeFile | (p, data, options?) => Promise\<void\> | Write; overwrite, ifNoneMatchStar, contentType |
| deletePath | (p) => Promise\<void\> | Remove (recursive for fs) |
| listDir | (dirPath) => Promise\<Array\<{ basename, type }\>\> | List directory entries |

### 2.3 writeFile Options

- overwrite (default true), ifNoneMatchStar (412/409 on exists)
- contentType (default application/octet-stream)

### 2.4 Dependencies

- fs, fs/promises, os, path
- utils/webdav (createDirectory, deleteFile, getFileContents, listDirectory, pathExists, putFileContentsAdvanced)
- metaPaths.normalizeWebdavPath
- errorHandler, SERVER_ERROR_CODES

### 2.5 Verification Scenarios

- [ ] getBackend: test env → fs; WEA_STORAGE_BACKEND=fs → fs
- [ ] webdavToFsPath: path stays under base; invalid → 400
- [ ] ensureDir creates dirs; WebDAV MKCOL per segment
- [ ] writeFile ifNoneMatchStar → 412 when exists
- [ ] listDir returns { basename, type }[]
- [ ] writeFile ENOSPC 시 throw
- [ ] listDir EACCES 시 throw

### 2.6 Error Cases

- writeFile 디스크 풀(ENOSPC): throw; 상위에서 500 처리
- WebDAV 연결 끊김: adapter에서 throw; 상위 retry 또는 500
- listDir 권한 없음: EACCES 등 throw; 상위 403
