# sharePermissionGateway Spec

## 1. Overview

| Item     | Description                                                                                                                                                                                                                    |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role     | Gateway adapter for sharing/permission flows. Isolates permission/request/user permission API calls behind a stable interface so controller hooks and use-cases can remain thin and replaceable.                               |
| Boundary | This module owns request/response mapping and low-level side effects for permission mutations and permission/request reads. It does not own UI state or permission-diff algorithms (those belong to pure helpers / use-cases). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/sharePermissionGateway.js`
- **Test file:** `client/src/services/__tests__/sharePermissionGateway.test.js`

### 2.2 Main Functions

All identifiers are nodeId-based (`nodeId` / `fileNodeId` are BIGINT `file_nodes.id` values, not path strings).

| Function                     | Input                                       | Return                                                                      | Backing source                                          |
| ---------------------------- | ------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------- |
| getUserPermissions           | `(userId, options?)`                        | `Promise<Array>`                                                            | `permissionService.getUserPermissions`                  |
| getFolderPermissions         | `(nodeId, fileNodeId?)`                     | `Promise<Array>`                                                            | `permissionService.getFolderPermissions`                |
| checkPermission              | `(nodeId)`                                  | `Promise<{ hasRead: boolean, hasWrite: boolean, source?: 'file'\|'path' }>` | `permissionService.checkPermission`                     |
| checkOwnerExists             | `(nodeId)`                                  | `Promise<{ ownerExists: boolean }>`                                         | `permissionRequestService.checkOwnerExists`             |
| listOutboxPermissionRequests | `(params)`                                  | `Promise<Array>`                                                            | `permissionRequestService.listOutboxPermissionRequests` |
| createPermissionRequest      | `(payload)`                                 | `Promise<{ id?: string }>`                                                  | `permissionRequestService.createPermissionRequest`      |
| cancelPermissionRequest      | `(id)`                                      | `Promise<void>`                                                             | `permissionRequestService.cancelPermissionRequest`      |
| grantPermission              | `({ userId, nodeId, permission, target? })` | `Promise<void>`                                                             | `permissionService.grantPermission`                     |
| revokePermission             | `({ userId, nodeId, scope? })`              | `Promise<void>`                                                             | `permissionService.revokePermission`                    |
| approvePermissionRequest     | `(id)`                                      | `Promise<any>`                                                              | `permissionRequestService.approvePermissionRequest`     |
| updateUserPermissions        | `(userId, permissions)`                     | `Promise<any>`                                                              | `userService.updateUserPermissions`                     |

Notes:

- `getFolderPermissions(nodeId, fileNodeId?)` lists users with access to a directory node; the optional `fileNodeId` restricts results to file-scoped permissions.
- `grantPermission` with `target: 'file'` grants file-level permission; `revokePermission` with `scope: 'pathOnly'` revokes file-level permission only.
- `checkOwnerExists(nodeId)` and `createPermissionRequest({ nodeId, permission })` send `nodeId` as the request identifier — no `folderPath` / `filePath` payloads.

### 2.3 Error Handling

- Errors are propagated to callers.
- Callers are responsible for mapping errors to user-facing messages (e.g. via `getServerErrorDisplay`), and for deciding whether the dialog remains open/retriable.

### 2.4 Verification Scenarios

- Each gateway function forwards success responses and preserves the response payload needed by the caller.
- For mutation endpoints (grant/revoke/request create/cancel/approve), gateway errors propagate so callers can render error messages without closing UI by default.

### 2.5 Edge Cases

- `listOutboxPermissionRequests` may return non-array values (caller treats as empty).
- `checkOwnerExists` should be interpreted as `ownerExists === true` meaning owner exists; any other shape means owner not confirmed.
