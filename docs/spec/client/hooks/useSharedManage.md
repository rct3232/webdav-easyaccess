# useSharedManage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Controller hook for shared-item management dialogs. Loads raw permission/request state, derives UI-ready access fields, and exposes public actions for request, cancel, and revoke flows. |
| Used by components/pages | `SharedManageDialog`, non-admin branch inside `ShareTargetDialog` |
| Does not own | JSX rendering, pure access derivation rules, low-level permission/request transport, or reusable transient-message timing/composition policy |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useSharedManage.js`
- **Test file:** `client/src/hooks/__tests__/useSharedManage.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open state |
| targetNodeId | number | Y | Target file/folder node ID (`file_nodes.id`) |
| parentNodeId | number \| null | N | Parent directory node ID; used for file targets to load parent-node permission state |
| displayName | string | Y | Display name used in success messaging |
| isDirectory | boolean | Y | Whether the target is a directory |
| user | object | Y | Current user |
| directHasReadPermission | boolean | N | Optional caller-known read override |
| onMessage | function | N | User-visible message dispatcher |
| onActionComplete | function | N | Success callback after revoke |
| onClose | function | N | Close callback |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| loading | boolean | Action-in-progress state |
| initialLoading | boolean | Initial permission/request load state |
| confirmDialogOpen | boolean | Revoke-confirm dialog state |
| setConfirmDialogOpen | function | Confirm-dialog setter |
| hasReadPermission | boolean | Effective read access |
| hasWritePermission | boolean | Effective write access |
| pathPermission | `'none' \| 'read' \| 'write' \| null` | Parent-node permission state for file targets |
| filePermissionLevel | `'read' \| 'write' \| null` | Direct file-level permission state |
| pendingRequest | object | Pending request view state keyed by permission level |
| ownerExists | boolean \| null | Whether a share owner still exists |
| handlePermissionRequest | `(permission) => Promise<void>` | Request read/write access |
| handleCancelPendingRequest | `(permission) => Promise<void>` | Cancel a pending request |
| handleRevokePermission | `() => Promise<void>` | Revoke existing access |

### 2.4 Dependencies

- `sharePermissionGateway` for permission checks, owner checks, outbox request reads, and request/revoke mutations
- `deriveSharedAccessState` for pure derivation of `hasReadPermission`, `hasWritePermission`, `pathPermission`, and `filePermissionLevel`
- `buildPendingRequestState` for mapping outbox request results into `pendingRequest` state
- `shareManageMessageUtils` for reusable success/error message composition and hide-duration policy

### 2.5 Side Effects

- On open, loads raw permission state via `sharePermissionGateway.checkPermission(targetNodeId)`
- For file targets, also loads parent-node permission state via `sharePermissionGateway.checkPermission(parentNodeId)`
- On open, loads `ownerExists` via `sharePermissionGateway.checkOwnerExists(targetNodeId)`
- On open, loads pending outbox requests via `sharePermissionGateway.listOutboxPermissionRequests`
- Sends create/cancel/revoke mutations through `sharePermissionGateway`
- May dispatch transient success/error messages via `onMessage`, but message text shaping and hide-after timing must stay behind the shared `shareManageMessageUtils` helper rather than hook-local branching

### 2.6 Error Handling

- Uses `getServerErrorDisplay` for server-originated messages
- **On request/cancel/revoke failure:** do **not** call `onClose`; keep the dialog open and surface an error
- Owner-check and pending-request read failures fall back to safe UI state rather than throwing

### 2.7 Verification Scenarios

- [ ] Admin user skips API reads and gets read/write access immediately
- [ ] Directory target derives read/write access with `pathPermission === null`
- [ ] File target derives `pathPermission` from the parent node (`parentNodeId`) and `filePermissionLevel` from file-level access
- [ ] `directHasReadPermission` overrides computed read access, including explicit `false`
- [ ] Request success updates `pendingRequest` and shows success feedback
- [ ] Cancel success clears the matching pending request and shows success feedback
- [ ] Revoke success calls `onActionComplete`, closes, and shows success feedback
- [ ] Any action failure keeps the dialog open and shows an error message
- [ ] Success and error messages keep the same observable text/type/timing after reusable message-helper extraction

### 2.8 Edge Cases

- `permissionCheck` or `parentPermissionCheck` missing fields should degrade to no access
- Admin user should not issue unnecessary permission/request reads
- File targets with no parent permission should expose `pathPermission: 'none'`
- Missing/invalid outbox data should map to an empty `pendingRequest` state
