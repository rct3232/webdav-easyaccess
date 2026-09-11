# adminPermissionSaveUseCase Spec

## 1. Overview

| Item | Description                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Use-case for `ShareDialog` admin mode. Diffs initial vs edited nodeId-keyed permissions and applies per-node grant/revoke through `sharePermissionGateway` (the legacy bulk `PUT /users/:id/permissions` route is not used). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/adminPermissionSaveUseCase.js`
- **Test file:** `client/src/services/__tests__/adminPermissionSaveUseCase.test.js`

### 2.2 Inputs

| Name              | Type                               | Required | Description                                           |
| ----------------- | ---------------------------------- | -------- | ----------------------------------------------------- |
| userId            | string                             | Y        | Target user id                                        |
| username          | string                             | Y        | Target username, used to resolve the user base folder |
| folderPermissions | `Map<string, Map<string, string>>` | Y        | Edited permission assignments                         |

### 2.3 Output

- `Promise<void>` on success

### 2.4 Dependencies

- `sharePermissionGateway.grantPermission` / `sharePermissionGateway.revokePermission`
- `buildPermissionDiff`

### 2.5 Execution Semantics

1. Diff `initialFolderPermissions` vs `folderPermissions` (nodeId-keyed maps) into revoke/grant sets.
2. Apply revokes first (best-effort; the target user's home folder node is never revoked).
3. Apply grants sequentially.
4. Guard: ensure the target user keeps at least `write` on their home folder node (grant if not already granted).

### 2.6 Error Handling

- Any persistence failure rejects the use-case.
- Caller owns user-facing error messages and close/retry behavior.

### 2.7 Verification Scenarios

- [ ] Only the target user's assignments are persisted
- [ ] The user base folder is always saved with `write`
- [ ] Persistence failure rejects
