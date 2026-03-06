# storage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Abstraction over metadata backends. Supports `webdav`, `fs`, and `postgresql` selection while preserving store-layer APIs. Provides ensureDir, exists, readFile, writeFile, deletePath, listDir for file-style backends and backend selection/connection helpers for relational mode. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/storage.js`
- **Test file:** `server/store/__tests__/storage.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| getBackend | () => 'webdav' \| 'fs' \| 'postgresql' | Resolved from `WEA_STORAGE_BACKEND`; `NODE_ENV=test` defaults to `fs` unless explicitly overridden |
| getFsBaseDir | () => string | WEA_FS_DIR or WEA_METADATA_DIR or os.tmpdir() |
| getPgPool | () => Pool | Returns PostgreSQL connection pool when backend is `postgresql` |
| withTransaction | (callback) => Promise\<T\> | Executes callback in single SQL transaction (begin/commit/rollback) |
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
- pg (Pool), backend-specific SQL helpers
- metaPaths.normalizeWebdavPath
- errorHandler, SERVER_ERROR_CODES

### 2.5 PostgreSQL v2 Schema Contract

When backend is `postgresql`, storage initialization is responsible for connecting to a schema that includes:

- `users`, `settings`, `permissions_user_paths`, `permissions_user_files`, `permissions_shares`, `share_links`, `recent_files`, `permission_requests`, `locks`
- uniqueness checks (user identity keys and per-user/path keys)
- check constraints for status/permission enums and request target consistency
- indexes for inbox/outbox and recent/share listing patterns

Store modules consume this schema through backend selector functions; route-level signatures remain unchanged.

### 2.6 Verification Scenarios

- [ ] getBackend: test env → fs; WEA_STORAGE_BACKEND=fs → fs
- [ ] getBackend: WEA_STORAGE_BACKEND=postgresql → postgresql
- [ ] withTransaction commits on success and rolls back on error
- [ ] webdavToFsPath: path stays under base; invalid → 400
- [ ] ensureDir creates dirs; WebDAV MKCOL per segment
- [ ] writeFile ifNoneMatchStar → 412 when exists
- [ ] listDir returns { basename, type }[]
- [ ] writeFile throws on ENOSPC
- [ ] listDir throws on EACCES

### 2.7 Error Cases

- writeFile disk full (ENOSPC): throw; upper layer maps to 500
- WebDAV disconnection: adapter throws; upper layer retries or returns 500
- listDir permission denied (EACCES): throw; upper layer maps to 403
- PostgreSQL connection/transaction failure: throw; upper layer maps using shared DB error mapping
