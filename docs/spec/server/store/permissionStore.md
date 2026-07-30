# permissionStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User and share-token permissions. Folder/file-level grants with cache support. Uses normalized permission tables in postgresql/sqlite. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/permissionStore.js`
- **Test file:** `server/store/__tests__/permissionStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| grant | (userId, fileNodeId, permission) => Promise\<object\> | Grant folder or file permission via node_id |
| revoke | (userId, fileNodeId) => Promise\<{ success }\> | Revoke all permissions for user on node |
| getUserPermissions | (userId) => Promise\<Array\<{ file_node_id, permission }\>\> | List folder permissions |
| checkPermission | (userId, fileNodeId, requiredPermission) => Promise\<boolean\> | Check folder permission |
| getEffectivePermission | (userId, nodeId) => Promise\<string \| null\> | File or parent path permission |
| grantFilePermission | (userId, fileNodeId, permission) => Promise\<object\> | File-only permission |
| revokeFilePermission | (userId, fileNodeId) => Promise\<{ success }\> | Remove file permission |
| getFolderPermissions | (fileNodeId) => Promise\<Array\> | List users with access |
| hasPermissionsInPath | (fileNodeId) => Promise\<Array\> | Permissions under path |
| grantSharePermission | (token, fileNodeId) => Promise\<object\> | Share-token grant |
| revokeSharePermission | (token) => Promise\<{ success }\> | Revoke share token |
| getSharePermissionDoc | (token, opts?) => Promise\<object \| null\> | Share doc (cached) |
| checkSharePermission | (token, nodeId, requiredPermission) => Promise\<boolean\> | Share token check |

**REMOVED methods:** `rewritePermissionsForAllUsers`, `revokePermissionsPrefixForAllUsers` — node_ids are stable; rename/move does not change node_id.

Permission enum contract:

- Allowed values: `read`, `write`, `admin`
- Ordering for effective checks: `read < write < admin`
- Canonical runtime source: `shared/constants.js` (`PERMISSIONS.ALL`)
- Canonical DB enforcement: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.3 Transaction Boundaries

- `grant`, `revoke`, `grantFilePermission`, `revokeFilePermission`: per-call transaction to keep each ACL mutation atomic.
- Share permission grant/revoke: single-row transactional updates/deletes.

### 2.4 PostgreSQL v2 Table Mapping

- `permissions_user_paths(user_id, file_node_id, permission, updated_at)` — unique on `(user_id, file_node_id)`
- `permissions_user_files(user_id, file_node_id, permission, updated_at)` — unique on `(user_id, file_node_id)`
- `permissions_shares(token, file_node_id, permission, updated_at)`

Constraint/index details are canonical in:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.5 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter
- locks, userStore
- shared pathUtils, constants (PERMISSIONS)
- errorHandler, SERVER_ERROR_CODES

### 2.6 Verification Scenarios

- [ ] grant/revoke folder; checkPermission returns correct boolean using node_ids
- [ ] grantFilePermission validates parent and rank; revokeFilePermission removes entry
- [ ] getEffectivePermission: file perm overrides path perm
- [ ] checkSharePermission for directory vs file root
- [ ] Cache bypass and TTL (PERMISSION_CACHE_TTL_MS, NODE_ENV=test disables)
- [ ] PostgreSQL: duplicate node grant upserts/replaces permission without duplicate rows
- [ ] PostgreSQL: permission check constraint rejects invalid values
- [ ] PostgreSQL: `grant(..., 'admin')` is preserved on read and `checkPermission(..., 'admin')` returns true
