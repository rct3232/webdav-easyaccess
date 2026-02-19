# metaPaths Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | WebDAV path constants and helpers for metadata storage. All paths are POSIX-style remote WebDAV paths, not local filesystem. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/metaPaths.js`
- **Test file:** `server/store/__tests__/metaPaths.test.js`

### 2.2 Constants

| Constant | Value |
|----------|-------|
| META_ROOT | /.wea |
| SETTINGS_PATH | /.wea/settings.json |
| USERS_DIR | /.wea/users |
| USERS_INDEX_PATH | /.wea/users/_index.json |
| EMAIL_INDEX_DIR | /.wea/index/email |
| LOCKS_DIR | /.wea/locks |
| PERMISSIONS_DIR | /.wea/permissions |
| PERMISSIONS_USERS_DIR | /.wea/permissions/users |
| PERMISSIONS_SHARES_DIR | /.wea/permissions/shares |

### 2.3 Functions

| Function | Signature | Description |
|----------|-----------|-------------|
| userPathByUsername | (username) => string | /.wea/users/{username}.json |
| emailIndexPathByEmailHash | (emailHash) => string | /.wea/index/email/{hash}.txt |
| lockPathByKey | (lockKey) => string | /.wea/locks/{key}.lock |
| userPermissionsPathByUserId | (userId) => string | /.wea/permissions/users/{userId}.json |
| sharePermissionsPathByToken | (token) => string | /.wea/permissions/shares/{token}.json |
| sha256HexLower | (input) => string | SHA-256 hex digest (lowercase) |
| normalizeWebdavPath | (p) => string | shared pathUtils.normalizePath |
| isMetaPath | (webdavPath) => boolean | Path is /.wea or under /.wea/ |
| basename | (webdavPath) => string | path.posix.basename |

### 2.4 Dependencies

- path (posix), crypto
- shared pathUtils.normalizePath

### 2.5 Verification Scenarios

- [ ] sha256HexLower returns hex string
- [ ] isMetaPath true for /.wea and /.wea/foo; false for /users
- [ ] Path builders return correct strings
