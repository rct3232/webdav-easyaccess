# buildPermissionDiff Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure permission-diff helper for sharing dialogs. Computes which user/nodeId permission assignments must be revoked vs granted by comparing `initialNodePermissions` and `nodePermissions` nodeId-keyed maps. |

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
| initialNodePermissions | `Map<number, Map<string, string>>` | nodeId -> (userId -> permission). Baseline at dialog open. |
| nodePermissions | `Map<number, Map<string, string>>` | nodeId -> (userId -> permission). Current edits in the dialog. |

**Return value**

| Key | Type | Meaning |
|-----|------|---------|
| permissionsToRevoke | `Array<{ userId: string, nodeId: number }>` | Assignments that existed initially but are removed in the current map. |
| permissionsToGrant | `Array<{ userId: string, nodeId: number, permission: string }>` | Assignments that exist in the current map (includes permission-level changes). |

### 2.3 Dependencies

- No external dependencies. The function operates on nodeId numbers, so it no longer depends on `pathUtils` or any path-normalization utilities.

### 2.4 Verification Scenarios

- When a `userId` existed on a nodeId in `initialNodePermissions` but is missing from `nodePermissions`, that entry appears in `permissionsToRevoke`.
- When a `userId` remains present on a nodeId but the permission value changes (e.g. `read` -> `write`), it does **not** appear in `permissionsToRevoke`, but it appears in `permissionsToGrant` with the new permission.
- If `initialNodePermissions` is empty, `permissionsToRevoke` is empty and `permissionsToGrant` mirrors the current map.
- If `nodePermissions` is empty, `permissionsToGrant` is empty and `permissionsToRevoke` contains all userId/nodeId pairs from `initialNodePermissions`.
- No normalization scenario applies: nodeIds are numeric identifiers that require no transformation.
- `collectSubfolderPaths()` is eliminated; permission inheritance across the tree is handled server-side via the closure table.

### 2.5 Edge Cases

- Missing nodeIds in `nodePermissions` for a given `initialNodePermissions` nodeId => revoke all userIds present on that initial nodeId.
- Extra userIds in `nodePermissions` not present initially => grant them; no revoke entries for them.

