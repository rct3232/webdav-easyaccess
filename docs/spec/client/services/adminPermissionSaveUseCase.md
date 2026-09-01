# adminPermissionSaveUseCase Spec

## 1. Overview

| Item | Description                                                                                                                                                                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Use-case for `ShareDialog` admin mode. Builds the target user's final permission list from the dialog state and persists it through `sharePermissionGateway.updateUserPermissions`. |

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

- `sharePermissionGateway.updateUserPermissions`
- `getUserBaseFolder`

### 2.5 Execution Semantics

1. Walk the dialog's `folderPermissions`.
2. Keep only assignments for the target `userId`.
3. Force the user base folder permission to `write`.
4. Persist the resulting permission list via `sharePermissionGateway.updateUserPermissions`.

### 2.6 Error Handling

- Any persistence failure rejects the use-case.
- Caller owns user-facing error messages and close/retry behavior.

### 2.7 Verification Scenarios

- [ ] Only the target user's assignments are persisted
- [ ] The user base folder is always saved with `write`
- [ ] Persistence failure rejects
