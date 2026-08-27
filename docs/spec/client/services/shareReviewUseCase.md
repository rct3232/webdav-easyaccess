# shareReviewUseCase Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Use-case for the “review mode” permission request flow. Revokes assignments the reviewer removed from the dialog (best-effort), then approves the permission request. The requested permission itself is granted atomically by the server on approve, so the client must not pre-grant. |

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

- `buildPermissionDiff` (pure helper, used for the revoke set)
- `sharePermissionGateway` (permission/request IO)

### 2.5 Execution Semantics

1. Compute `permissionsToRevoke` by comparing `initialFolderPermissions` vs `folderPermissions`.
2. Revoke permissions for removed user-path assignments:
   - Revocation failures for individual entries are non-fatal (continue revoking the rest).
3. Approve the permission request (`approvePermissionRequest(permissionRequestId)`).
4. The requested permission is granted by the server atomically on approve; no client-side grant is issued for the request target.

### 2.6 Error Handling

- If approving fails, the use-case throws (caller decides how to display errors and whether to keep the dialog open).
- If individual revokes fail, the use-case continues (matching the current sharing behavior where revocation failures do not block the approve attempt).

### 2.7 Verification Scenarios

- Users removed from a path in `folderPermissions` are included in the computed revoke operations.
- The use-case never issues a client-side grant before approving; the requested permission is granted server-side on approve.
- `approvePermissionRequest(permissionRequestId)` is called exactly once after the best-effort revoke pass.
- An approve failure propagates to the caller.

### 2.8 Edge Cases

- Maps may be empty but should not be null.
- `buildPermissionDiff` normalization guarantees returned `folderPath` values are safe to pass into gateway calls.

