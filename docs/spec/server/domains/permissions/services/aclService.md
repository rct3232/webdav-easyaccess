# aclService Spec

## 1. Overview

| Item | Description                                                                                                                                                                             |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Core permission-checking service. nodeId-based interface using the closure table for inheritance resolution. No Express coupling; consumed by middleware, routes, and the policy layer. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/permissions/services/aclService.js`
- **Test file:** `server/domains/permissions/services/__tests__/aclService.test.js` (if present)

### 2.2 Core Permission Checks

#### `checkFilePermission(principalId, fileNodeId, requiredPermission)`

Checks whether a principal has the required permission on a **file** node. Resolution order:

1. **Share principal:** If `principalId` starts with `share:`, extract token and delegate to `permissionStore.checkSharePermission(token, fileNodeId, requiredPermission)`.
2. **Admin bypass:** Fetch user via cache; if `user.is_admin`, return `true`.
3. **Direct file permission:** Query `permissionStore.getFilePermission(userId, fileNodeId)` — a file-specific grant always takes precedence. If found and meets rank requirement, return `true`.
4. **Ancestor inheritance:** Fall back to `permissionStore.checkPermission(userId, fileNodeId, requiredPermission)` which traverses the closure table for directory-level grants on ancestor nodes.

**Key distinction from `checkFolderPermission`:** Step 3 (direct file permission lookup) is unique to this function. File-level grants in `permissions_user_files` override any inherited directory permission.

| Param              | Type             | Required | Description                                                  |
| ------------------ | ---------------- | -------- | ------------------------------------------------------------ |
| principalId        | number \| string | yes      | User ID or `"share:<token>"`                                 |
| fileNodeId         | number (BIGINT)  | yes      | File node ID referencing `file_nodes.id` where `type='file'` |
| requiredPermission | string           | no       | Defaults to `PERMISSIONS.READ`                               |

**Returns:** `Promise<boolean>`

#### `checkFolderPermission(principalId, dirNodeId, requiredPermission)`

Checks whether a principal has the required permission on a **directory** node. Resolution order:

1. **Share principal:** If `principalId` starts with `share:`, extract token and delegate to `permissionStore.checkSharePermission(token, dirNodeId, requiredPermission)`.
2. **Admin bypass:** Fetch user via cache; if `user.is_admin`, return `true`.
3. **Closure table lookup:** Delegate directly to `permissionStore.checkPermission(userId, dirNodeId, requiredPermission)` — traverses ancestors including self via the closure table.

**Key distinction from `checkFilePermission`:** No direct file-level permission check (Step 3 above). Directory permissions are stored only in `permissions_user_paths` and resolved through ancestor traversal.

| Param              | Type             | Required | Description                                                            |
| ------------------ | ---------------- | -------- | ---------------------------------------------------------------------- |
| principalId        | number \| string | yes      | User ID or `"share:<token>"`                                           |
| dirNodeId          | number (BIGINT)  | yes      | Directory node ID referencing `file_nodes.id` where `type='directory'` |
| requiredPermission | string           | no       | Defaults to `PERMISSIONS.READ`                                         |

**Returns:** `Promise<boolean>`

#### `checkPermission(nodeId, principalId, action, isDirectory)`

Unified entry point that delegates to the appropriate checker based on the `isDirectory` flag. Admin users bypass all checks; non-admins are routed to `checkFilePermission` or `checkFolderPermission` accordingly. Share principals are resolved before delegation.

| Param       | Type             | Required | Description                    |
| ----------- | ---------------- | -------- | ------------------------------ |
| nodeId      | number (BIGINT)  | yes      | Node ID                        |
| principalId | number \| string | yes      | User ID or `"share:<token>"`   |
| action      | string           | no       | Defaults to `PERMISSIONS.READ` |
| isDirectory | boolean          | no       | Defaults to `false`            |

**Returns:** `Promise<boolean>`

### 2.3 Write Convenience Methods

#### `canWriteFolder(user, dirNodeId)`

Admin bypass + delegates to `checkFolderPermission(user.id, dirNodeId, PERMISSIONS.WRITE)`. Returns `false` if user is null.

#### `canWriteFile(user, fileNodeId)`

Admin bypass + delegates to `checkFilePermission(user.id, fileNodeId, PERMISSIONS.WRITE)`. Returns `false` if user is null.

### 2.4 Identity Helpers

| Function                         | Signature                         | Description                                                            |
| -------------------------------- | --------------------------------- | ---------------------------------------------------------------------- |
| `isSharePrincipal(principalId)`  | `(principalId) => boolean`        | Returns true if string starts with `"share:"`                          |
| `extractShareToken(principalId)` | `(principalId) => string \| null` | Strips `"share:"` prefix; returns null for non-share principals        |
| `isAdminUser(userOrId)`          | `(userOrId) => boolean`           | Returns true if object has `is_admin: true`; false for everything else |

### 2.5 Cache Utilities

#### User Cache (`getCachedUser`)

Internal helper that fetches users from the database with TTL-based caching (default 3000ms, disabled in test environment). Cache key is stringified user ID. Exposed as `getCachedUser` for downstream callers.

#### Test Helper

- `__clearUserCacheForTests()` — clears the internal user cache map; intended only for test setup/teardown.

### 2.6 Batch Permission Checks (W4.0 Decision)

The service does **not** expose a `checkPermissionsBatch` method. Callers needing concurrent checks across multiple nodes use per-item `Promise.all` or `Promise.allSettled`:

```js
// Pattern used by downloadService.downloadMultiple:
const results = await Promise.allSettled(
  nodeIds.map((id) => aclService.checkFilePermission(userId, id, PERMISSIONS.READ))
);
```

This decision was made in Wave 4 (Task W4.0) — a dedicated batch method provides no meaningful performance benefit over `Promise.allSettled` for the current use cases and adds unnecessary surface area.

### 2.7 Dependencies

- `permissionStore` — all persistence operations
- `User` model — user lookup (via cache)
- `@webdav-easyaccess/shared/constants` (PERMISSIONS)
- `permissionRank.meetsRank` — permission level comparison

### 2.8 Verification Scenarios

- [ ] checkFilePermission returns true for admin users regardless of grants
- [ ] checkFilePermission checks direct file permission before ancestor inheritance
- [ ] checkFilePermission falls back to closure table when no direct file grant exists
- [ ] checkFolderPermission skips direct file-level lookup; uses only closure table
- [ ] Share principal resolves via token extraction and store delegation
- [ ] Non-existent user returns false (not an error)
- [ ] canWriteFolder/canWriteFile delegate to correct checker with WRITE permission
- [ ] User cache TTL respects NODE_ENV=test (disabled)
