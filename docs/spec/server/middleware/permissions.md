# permissions Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission check utilities and middleware: checkFilePermission, checkFolderPermission, canAccessPath, requirePermission, requireFolderPermission, isSharePrincipal, extractShareToken. Principal: userId or share:token. Owner detection via closure table ancestor check, admin bypass. All operations use `nodeId` (BIGINT) instead of path strings. |
| Pipeline position | requirePermission/requireFolderPermission used in routes; check* used by permissionPolicy |
| Preceding middleware | requireAuth (req.principalId) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/permissions.js`
- **Test file:** `server/middleware/__tests__/permissions.test.js`

### 2.2 Input Conditions

- principalId: number (userId) or string ("share:token")
- nodeId: BIGINT referencing `file_nodes.id` — opaque integer, no normalization required

> **Removed:** Path normalization section — not needed for opaque integer identifiers. Previous path-based inputs (`filePath`, `folderPath`) are replaced by `nodeId`.

### 2.3 Owner Detection

Owner detection uses the `node_ancestors` closure table rather than string prefix matching:

1. Resolve the owner's root directory node ID (from user profile or file_nodes where the node is a user-root).
2. Check if `ownerRootNodeId` appears in the ancestor chain of the target `nodeId`:
   ```sql
   SELECT 1 FROM node_ancestors WHERE ancestor_id = ? AND descendant_id = ?
   ```
3. If a row exists, the principal is the owner of the target node (or its subtree).

> **Removed:** `/alice/...` prefix matching — replaced by closure table ancestor check above.

### 2.4 Side Effects

- User cache (USER_CACHE_TTL_MS)
- requirePermission, requireFolderPermission: res.status(400/401/403/500).json() on error

### 2.5 Error Cases

- Returns false when no permission
- Share: read-only, node must be under share root (verified via closure table ancestor check)
- Admin bypass applies regardless of nodeId

### 2.6 Mock Targets

- User.findById (getCachedUser)
- Permission.checkPermission, Permission.checkSharePermission
- Permission.getPermissionDoc

### 2.7 Verification Scenarios

- [ ] checkFilePermission, checkFolderPermission resolve via nodeId
- [ ] requirePermission, requireFolderPermission middleware
- [ ] Admin bypass
- [ ] Owner detection via node_ancestors (closure table ancestor check)
- [ ] Share principal: read-only scope enforced through closure table
- [ ] isSharePrincipal, extractShareToken
