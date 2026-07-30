# permissionStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User and share-token permissions. Folder/file-level grants with cache support. Uses normalized permission tables in postgresql/sqlite. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/permissions/stores/permissionStore.js`
- **Test file:** `server/domains/permissions/stores/__tests__/permissionStore.test.js`

### 2.2 Main Methods

#### Folder Permissions

| Method | Signature | Description |
|--------|-----------|-------------|
| grant | (userId, folderPath, permission, options?) => Promise\<object\> | Grant folder permission |
| revoke | (userId, folderPath, options?) => Promise\<{ success }\> | Revoke all permissions for user on folder |
| getUserPermissions | (userId) => Promise\<Array\<{ folder_path, permission }\>\> | List folder permissions for user |
| checkPermission | (userId, folderPath, requiredPermission) => Promise\<boolean\> | Check folder permission |
| checkPermissionSync | (doc, folderPath, requiredPermission) => boolean | Synchronous folder permission check against loaded doc |
| getPermissionDoc | (userId) => Promise\<object\> | Get raw permission document |
| checkPermissions | (userId, paths, requiredPermission) => Promise\<boolean\> | Batch permission check across multiple paths |
| getFolderPermissions | (folderPath, filePath?) => Promise\<Array\> | List users with access to folder |
| hasPermissionsInPath | (folderPath) => Promise\<Array\> | Permissions under path |

#### File Permissions

| Method | Signature | Description |
|--------|-----------|-------------|
| getFilePermission | (userId, filePath) => Promise\<object\> | Get file-specific permission |
| getEffectivePermission | (userId, path) => Promise\<string \| null\> | File or parent path effective permission |
| grantFilePermission | (userId, filePath, permission) => Promise\<object\> | File-only permission |
| revokeFilePermission | (userId, filePath) => Promise\<{ success }\> | Remove file permission |
| getUserFilePermissions | (userId) => Promise\<Array\> | List file permissions for user |
| checkFilePermissionSync | (doc, filePath, requiredPermission) => boolean | Synchronous file permission check |
| getPathEffectivePermission | (userId, folderPath) => Promise\<string \| null\> | Effective permission for folder path |

#### Share Token Permissions

| Method | Signature | Description |
|--------|-----------|-------------|
| grantSharePermission | (token, rootPath, isDirectory) => Promise\<object\> | Share-token grant |
| revokeSharePermission | (token) => Promise\<{ success }\> | Revoke share token |
| getSharePermissionDoc | (token, opts?) => Promise\<object \| null\> | Share doc (cached) |
| checkSharePermission | (token, path, requiredPermission) => Promise\<boolean\> | Share token check |

#### Admin / Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| revokeAllUserPermissions | (userId) => Promise\<{ success }\> | Revoke all permissions for user |
| deleteUserPermissionsFile | (userId) => Promise\<{ success }\> | Delete user permission file |
| rewritePermissionsForAllUsers | (mapping) => Promise\<void\> | Bulk rewrite paths in permission docs |
| revokePermissionsPrefixForAllUsers | (prefixes) => Promise\<void\> | Bulk revoke by path prefix |

### 2.3 Transaction Boundaries

- `grant`, `revoke`, `grantFilePermission`, `revokeFilePermission`: per-call transaction to keep each ACL mutation atomic.
- Share permission grant/revoke: single-row transactional updates/deletes.

### 2.4 PostgreSQL v2 Table Mapping

- `permissions_user_paths(user_id, file_node_id, permission, updated_at)` — unique on `(user_id, file_node_id)`
- `permissions_user_files(user_id, file_node_id, permission, updated_at)` — unique on `(user_id, file_node_id)`
- `permissions_shares(token, file_node_id, permission, updated_at)`

> **Note:** The current implementation still uses legacy path-based columns (`folder_path`, `file_path`, `root_path`, `is_directory`) in SQL queries. Migration to `file_node_id` is scoped to Phase 4 Tasks 4.1–4.2, 4.6.

Constraint/index details are canonical in:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.5 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter
- locks, userStore
- shared pathUtils, constants (PERMISSIONS)
- errorHandler, SERVER_ERROR_CODES
- metaPaths (legacy import for path normalization)

### 2.6 Verification Scenarios

- [ ] grant/revoke folder; checkPermission returns correct boolean
- [ ] grantFilePermission validates parent and rank; revokeFilePermission removes entry
- [ ] getEffectivePermission: file perm overrides path perm
- [ ] checkSharePermission for directory vs file root
- [ ] Cache bypass and TTL (PERMISSION_CACHE_TTL_MS, NODE_ENV=test disables)
- [ ] PostgreSQL: duplicate grant upserts/replaces permission without duplicate rows
- [ ] PostgreSQL: permission check constraint rejects invalid values
- [ ] PostgreSQL: `grant(..., 'admin')` is preserved on read and `checkPermission(..., 'admin')` returns true
