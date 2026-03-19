# shareReviewUseCase Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Use-case for the “review mode” permission request flow. Applies permission mutations derived from the sharing dialog’s edited state, then approves the permission request. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/shareReviewUseCase.js`
- **Test file:** `client/src/services/__tests__/shareReviewUseCase.test.js`

### 2.2 Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| permissionRequestId | string | Y | The permission request id to approve. |
| initialFolderPermissions | `Map<string, Map<string, string>>` | Y | Baseline permission assignments at dialog open. |
| folderPermissions | `Map<string, Map<string, string>>` | Y | Current permission assignments after user edits. |

### 2.3 Output

- `Promise<void>` on success (dialog/controller closes or shows success message).

### 2.4 Dependencies

- `buildPermissionDiff` (pure helper)
- `sharePermissionGateway` (permission/request IO)

### 2.5 Execution Semantics

1. Compute `permissionsToRevoke` and `permissionsToGrant` by comparing `initialFolderPermissions` vs `folderPermissions`.
2. Revoke permissions for removed user-path assignments:
   - Revocation failures for individual entries are non-fatal (continue revoking/granting the rest).
3. Grant permissions for all current assignments.
4. Approve the permission request (`approvePermissionRequest(permissionRequestId)`).

### 2.6 Error Handling

- If granting or approving fails, the use-case throws (caller decides how to display errors and whether to keep the dialog open).
- If individual revokes fail, the use-case continues (matching the current sharing behavior where revocation failures do not block later grant/approve attempts).

### 2.7 Verification Scenarios

- Users removed from a path in `folderPermissions` are included in the computed revoke operations.
- Existing users whose permission level changed are included in grant operations, and are not included in revoke operations.
- When `folderPermissions` is empty: grants are empty and revokes cover all `initialFolderPermissions` assignments.
- `approvePermissionRequest(permissionRequestId)` is called only after grant operations succeed.

### 2.8 Edge Cases

- Maps may be empty but should not be null.
- `buildPermissionDiff` normalization guarantees returned `folderPath` values are safe to pass into gateway calls.

