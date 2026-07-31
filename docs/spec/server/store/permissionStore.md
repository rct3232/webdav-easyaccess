# permissionStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User and share-token permissions. Node-level grants with cache support. Uses normalized permission tables in postgresql/sqlite; all references use `file_node_id` BIGINT foreign keys instead of path strings. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/permissions/stores/permissionStore.js`
- **Test file:** `server/domains/permissions/stores/__tests__/permissionStore.test.js`

### 2.2 Main Methods

#### Directory Permissions (Folder-Level)

| Method | Signature | Description |
|--------|-----------|-------------|
| grant | (userId, nodeId, permission, options?) => Promise\<object\> | Grant directory permission; `nodeId` is BIGINT referencing `file_nodes.id` where `type='directory'` |
| revoke | (userId, nodeId, options?) => Promise\<{ success }\> | Revoke all permissions for user on directory node |
| getUserPermissions | (userId) => Promise\<Array\<{ file_node_id, permission }\>\> | List directory permissions for user |
| checkPermission | (userId, nodeId, requiredPermission) => Promise\<boolean\> | Check directory permission via ancestor traversal (§2.7) |
| checkPermissionSync | (doc, nodeId, requiredPermission) => boolean | Synchronous directory permission check against loaded doc |
| getPermissionDoc | (userId) => Promise\<object\> | Get raw permission document |
| checkPermissions | (userId, nodeIds, requiredPermission) => Promise\<boolean\> | Batch permission check across multiple nodes |
| getFolderPermissions | (nodeId, fileNodeId?) => Promise\<Array\> | List users with access to directory; optional `fileNodeId` for file-scoped results |
| hasPermissionsInPath | (nodeId) => Promise\<Array\> | Permissions on ancestors of node |

#### File Permissions

| Method | Signature | Description |
|--------|-----------|-------------|
| getFilePermission | (userId, fileNodeId) => Promise\<object\> | Get file-specific permission; `fileNodeId` is BIGINT referencing `file_nodes.id` where `type='file'` |
| getEffectivePermission | (userId, fileNodeId) => Promise\<string \| null\> | File or ancestor directory effective permission for a file node |
| grantFilePermission | (userId, fileNodeId, permission) => Promise\<object\> | File-only permission; `fileNodeId` is BIGINT |
| revokeFilePermission | (userId, fileNodeId) => Promise\<{ success }\> | Remove file permission |
| getUserFilePermissions | (userId) => Promise\<Array\> | List file permissions for user |
| checkFilePermissionSync | (doc, fileNodeId, requiredPermission) => boolean | Synchronous file permission check |

#### Share Token Permissions

| Method | Signature | Description |
|--------|-----------|-------------|
| grantSharePermission | (token, nodeId) => Promise\<object\> | Share-token grant; `nodeId` is BIGINT referencing `file_nodes.id`; node type (`file`/`directory`) derivable from `file_nodes.type` |
| revokeSharePermission | (token) => Promise\<{ success }\> | Revoke share token |
| getSharePermissionDoc | (token, opts?) => Promise\<object \| null\> | Share doc (cached) |
| checkSharePermission | (token, nodeId, requiredPermission) => Promise\<boolean\> | Share token permission check against node; ancestor inheritance via closure table (§2.7) |

#### Admin / Lifecycle

| Method | Signature | Description |
|--------|-----------|-------------|
| revokeAllUserPermissions | (userId) => Promise\<{ success }\> | Revoke all permissions for user |
| deleteUserPermissionsFile | (userId) => Promise\<{ success }\> | Delete user permission file |

> **Removed:** `rewritePermissionsForAllUsers` and `revokePermissionsPrefixForAllUsers` — path-based bulk operations are unnecessary with nodeId references; CASCADE delete on `file_nodes` handles bulk cleanup.

### 2.3 Transaction Boundaries

- `grant`, `revoke`, `grantFilePermission`, `revokeFilePermission`: per-call transaction to keep each ACL mutation atomic.
- Share permission grant/revoke: single-row transactional updates/deletes.

### 2.4 PostgreSQL v2 Table Mapping

- `permissions_user_paths(user_id, file_node_id, permission, updated_at)` — unique on `(user_id, file_node_id)`
- `permissions_user_files(user_id, file_node_id, permission, updated_at)` — unique on `(user_id, file_node_id)`
- `permissions_shares(token, file_node_id, permission, updated_at)`

All tables use `file_node_id BIGINT NOT NULL REFERENCES file_nodes(id) ON DELETE CASCADE`. No path-based columns remain.

Constraint/index details are canonical in:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.5 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter
- locks, userStore
- shared constants (PERMISSIONS)
- errorHandler, SERVER_ERROR_CODES
- fileNodeService (for node existence validation, ancestor queries via closure table)

> **Removed:** `metaPaths` legacy import — path normalization is unnecessary for opaque integer identifiers.

### 2.6 Verification Scenarios

- [ ] grant/revoke directory; checkPermission returns correct boolean
- [ ] grantFilePermission validates parent and rank; revokeFilePermission removes entry
- [ ] getEffectivePermission: file perm overrides ancestor directory perm
- [ ] checkSharePermission for directory vs file node
- [ ] Cache bypass and TTL (PERMISSION_CACHE_TTL_MS, NODE_ENV=test disables)
- [ ] PostgreSQL: duplicate grant upserts/replaces permission without duplicate rows
- [ ] PostgreSQL: permission check constraint rejects invalid values
- [ ] PostgreSQL: `grant(..., 'admin')` is preserved on read and `checkPermission(..., 'admin')` returns true
- [ ] Ancestor inheritance (§2.7): granting on ancestor nodeId propagates to descendants via closure table traversal

### 2.7 Ancestor Inheritance

Directory permissions propagate to descendants through the `node_ancestors` closure table rather than fan-out INSERTs. Granting a permission on a directory node is O(1); checking permission for any descendant resolves by walking ancestors at query time.

**Resolution algorithm:** To determine if `userId` has access to `targetNodeId`, traverse all ancestors of the target (including self) and find the closest ancestor with an explicit grant:

```sql
SELECT p.permission
FROM permissions_user_paths p
JOIN node_ancestors a ON a.ancestor_id = p.file_node_id
WHERE a.descendant_id = ? AND p.user_id = ?
ORDER BY a.depth ASC
LIMIT 1
```

- `depth=0` match means the permission was granted directly on the target node itself.
- Higher `depth` values mean the permission was inherited from a more distant ancestor.
- If no row matches, the user has no explicit directory-level permission (subject to owner/admin bypass rules in middleware).

**File permissions:** A file-specific grant (`permissions_user_files`) always takes precedence over any ancestor directory grant. The effective permission for a file is resolved by first checking `permissions_user_files` directly, then falling back to the ancestor traversal above.
