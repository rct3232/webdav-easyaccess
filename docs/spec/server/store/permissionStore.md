# permissionStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User and share-token permissions. Folder and file-level grants. Cached per-user and per-share-token. Supports path rewriting (rename/move) and prefix revocation. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/permissionStore.js`
- **Test file:** `server/store/__tests__/permissionStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| grant | (userId, folderPath, permission, options?) => Promise\<object\> | Grant folder or file permission (target: 'folder' \| 'file') |
| revoke | (userId, folderPath, options?) => Promise\<{ success }\> | Revoke (scope: includeDescendants \| pathOnly) |
| getUserPermissions | (userId) => Promise\<Array\<{ folder_path, permission }\>\> | List folder permissions |
| checkPermission | (userId, folderPath, requiredPermission) => Promise\<boolean\> | Check folder permission |
| checkPermissionSync | (doc, folderPath, requiredPermission) => boolean | Sync check with preloaded doc |
| getPermissionDoc | (userId) => Promise\<object\> | Get full doc (cached) |
| checkPermissions | (userId, paths, requiredPermission) => Promise\<Map\<string,boolean\>\> | Bulk check |
| getPathEffectivePermission | (userId, folderPath) => Promise\<string \| null\> | Direct path permission |
| getEffectivePermission | (userId, path) => Promise\<string \| null\> | File or parent path permission |
| grantFilePermission | (userId, filePath, permission) => Promise\<object\> | File-only permission |
| revokeFilePermission | (userId, filePath) => Promise\<{ success }\> | Remove file permission |
| getFolderPermissions | (folderPath, filePath?) => Promise\<Array\> | List users with access |
| hasPermissionsInPath | (folderPath) => Promise\<Array\> | Permissions under path |
| grantSharePermission | (token, rootPath, isDirectory) => Promise\<object\> | Share-token grant |
| revokeSharePermission | (token) => Promise\<{ success }\> | Revoke share token |
| getSharePermissionDoc | (token, opts?) => Promise\<object \| null\> | Share doc (cached) |
| checkSharePermission | (token, path, requiredPermission) => Promise\<boolean\> | Share token check |
| rewritePermissionsForAllUsers | (mappings, opts?) => Promise\<object\> | Rename/move paths |
| revokePermissionsPrefixForAllUsers | (prefixes) => Promise\<object\> | Revoke by prefix |

### 2.3 Storage Paths

- User: `/.wea/permissions/users/{userId}.json` (permissions, file_permissions)
- Share: `/.wea/permissions/shares/{token}.json`

### 2.4 Dependencies

- storage, metaPaths, locks, userStore
- shared pathUtils, constants (PERMISSIONS)
- errorHandler, SERVER_ERROR_CODES

### 2.5 Verification Scenarios

- [ ] grant/revoke folder; checkPermission returns correct boolean
- [ ] grantFilePermission validates parent and rank; revokeFilePermission removes entry
- [ ] getEffectivePermission: file perm overrides path perm
- [ ] checkSharePermission for directory vs file root
- [ ] rewritePermissionsForAllUsers updates paths; revokePermissionsPrefixForAllUsers removes matching
- [ ] Cache bypass and TTL (PERMISSION_CACHE_TTL_MS, NODE_ENV=test disables)
