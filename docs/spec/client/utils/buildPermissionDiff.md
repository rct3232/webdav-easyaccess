# buildPermissionDiff Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure permission-diff helper for sharing dialogs. Computes which user/folder permission assignments must be revoked vs granted by comparing `initialFolderPermissions` and `folderPermissions` maps. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/buildPermissionDiff.js`
- **Test file:** `client/src/utils/__tests__/buildPermissionDiff.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| buildPermissionDiff | (params) => `{ permissionsToRevoke, permissionsToGrant }` |

**Input parameters**

| Name | Type | Description |
|------|------|-------------|
| initialFolderPermissions | `Map<string, Map<string, string>>` | Path -> (userId -> permission). Baseline at dialog open. |
| folderPermissions | `Map<string, Map<string, string>>` | Path -> (userId -> permission). Current edits in the dialog. |

**Return value**

| Key | Type | Meaning |
|-----|------|---------|
| permissionsToRevoke | `Array<{ userId: string, folderPath: string }>` | Assignments that existed initially but are removed in the current map. |
| permissionsToGrant | `Array<{ userId: string, folderPath: string, permission: string }>` | Assignments that exist in the current map (includes permission-level changes). |

### 2.3 Dependencies

- `pathUtils.normalizePath` (for consistent `folderPath` values)

### 2.4 Verification Scenarios

- When a `userId` existed on a path in `initialFolderPermissions` but is missing from `folderPermissions`, that entry appears in `permissionsToRevoke`.
- When a `userId` remains present on a path but the permission value changes (e.g. `read` -> `write`), it does **not** appear in `permissionsToRevoke`, but it appears in `permissionsToGrant` with the new permission.
- If `initialFolderPermissions` is empty, `permissionsToRevoke` is empty and `permissionsToGrant` mirrors the current map.
- If `folderPermissions` is empty, `permissionsToGrant` is empty and `permissionsToRevoke` contains all userId/path pairs from `initialFolderPermissions`.
- Returned `folderPath` values are normalized (to match how gateways/mutations expect paths).

### 2.5 Edge Cases

- Missing paths in `folderPermissions` for a given `initialFolderPermissions` path => revoke all userIds present on that initial path.
- Extra userIds in `folderPermissions` not present initially => grant them; no revoke entries for them.

