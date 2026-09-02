# sharePermissionSaveUseCase Spec

## 1. Overview

| Item | Description                                                                                                                                                                 |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Use-case for `ShareDialog` share mode. Applies the edited folder-permission state by computing revoke/grant operations and executing them through `sharePermissionGateway`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/sharePermissionSaveUseCase.js`
- **Test file:** `client/src/services/__tests__/sharePermissionSaveUseCase.test.js`

### 2.2 Inputs

| Name                     | Type                               | Required | Description                               |
| ------------------------ | ---------------------------------- | -------- | ----------------------------------------- |
| initialNodePermissions   | `Map<number, Map<string, string>>` | Y        | NodeId-keyed permission assignments at dialog open |
| nodePermissions          | `Map<number, Map<string, string>>` | Y        | NodeId-keyed edited permission assignments |

### 2.3 Output

- `Promise<void>` on success

### 2.4 Dependencies

- `buildPermissionDiff`
- `sharePermissionGateway`

### 2.5 Execution Semantics

1. Compute `permissionsToRevoke` and `permissionsToGrant` using `buildPermissionDiff`.
2. Revoke removed assignments through `sharePermissionGateway.revokePermission`.
3. Grant current assignments through `sharePermissionGateway.grantPermission`.

### 2.6 Error Handling

- Grant failures are fatal and reject the use-case.
- Revoke failures are best-effort (non-fatal) and are ignored.
- Caller owns user-facing error messages and close/retry behavior.

### 2.7 Verification Scenarios

- [ ] Removed assignments are revoked
- [ ] Current assignments are granted
- [ ] Grant failure rejects and prevents success completion
- [ ] `buildPermissionDiff` computes revoke/grant sets from nodeId-keyed maps
