# shareTargetPermissionSaveUseCase Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Use-case for admin save flows inside `ShareTargetDialog`. Persists edited direct-access state for either folders or files while preserving the current dialog's user-visible success/error behavior. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/shareTargetPermissionSaveUseCase.js`
- **Test file:** `client/src/services/__tests__/shareTargetPermissionSaveUseCase.test.js`

### 2.2 Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| targetPath | string | Y | Target path |
| isDirectory | boolean | Y | Whether the target is a folder |
| initialAccessList | array | Y | Original access entries |
| accessList | array | Y | Edited access entries |

### 2.3 Output

- `Promise<void>` on success

### 2.4 Dependencies

- `sharePermissionGateway`
- `collectSubfolderPaths` for directory targets
- file-specific permission rules already expressed in the dialog state

### 2.5 Execution Semantics

- Directory targets:
  1. Collect root + subfolder paths.
  2. Revoke removed users from the target subtree.
  3. Grant current permissions across the target subtree.
- File targets:
  1. Revoke removed or explicitly reverted path-only overrides.
  2. Grant current file-level overrides when needed.

### 2.6 Error Handling

- Any grant failure rejects the use-case.
- Revoke failures are best-effort only if preserving existing behavior requires it.
- Callers own user-facing error messages and close/retry behavior.

### 2.7 Verification Scenarios

- [ ] Directory save revokes removed users and grants current users across subfolders
- [ ] File save respects `revoke` / same-as-path rules
- [ ] Failure rejects so the dialog can stay open
