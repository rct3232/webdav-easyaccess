# shareTargetPermissionSaveUseCase Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Use-case for admin save flows inside `ShareTargetDialog`. Persists edited direct-access state for either folders or files while preserving the current dialog's user-visible success/error behavior. Operates on nodeId (BIGINT) — no path strings. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/shareTargetPermissionSaveUseCase.js`
- **Test file:** `client/src/services/__tests__/shareTargetPermissionSaveUseCase.test.js`

### 2.2 Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| targetNodeId | number (BIGINT) | Y | Target node ID referencing `file_nodes.id` |
| isDirectory | boolean | Y | Whether the target is a folder |
| initialAccessList | array | Y | Original access entries |
| accessList | array | Y | Edited access entries |

### 2.3 Output

- `Promise<void>` on success

### 2.4 Dependencies

- `sharePermissionGateway` — all grant/revoke operations use nodeId payloads via this gateway

> **Removed dependency:** `collectSubfolderPaths` was deleted in Wave 4. Server-side closure table inheritance handles permission propagation; the client no longer enumerates subfolder paths for directory grants.

### 2.5 Execution Semantics

- Directory targets:
  1. Grant or revoke permissions on the target nodeId via sharePermissionGateway.
  2. Inheritance to descendants is handled server-side by the closure table — no recursive path traversal required.
- File targets:
  1. Revoke removed or explicitly reverted file-level overrides.
  2. Grant current file-level overrides when needed (target `'file'`).

### 2.6 Error Handling

- Any grant failure rejects the use-case.
- Revoke failures are best-effort only if preserving existing behavior requires it.
- Callers own user-facing error messages and close/retry behavior.

### 2.7 Verification Scenarios

- [ ] Directory save revokes removed users and grants current users on target nodeId (inheritance handled server-side)
- [ ] File save respects `revoke` / same-as-path rules via file-level grant with target 'file'
- [ ] Failure rejects so the dialog can stay open