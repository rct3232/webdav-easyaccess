# buildPendingRequestState Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that maps raw outbox permission requests into the `pendingRequest` shape consumed by `useSharedManage`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/buildPendingRequestState.js`
- **Test file:** `client/src/utils/__tests__/buildPendingRequestState.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| buildPendingRequestState | `(params) => pendingRequestState` |

### 2.3 Inputs

| Name | Type | Required | Description |
|------|------|----------|-------------|
| requests | array | N | Raw outbox list |
| targetNodeId | number | Y | Current target nodeId |
| isDirectory | boolean | Y | Whether the target is a folder |

### 2.4 Output

- `{ read: { pending: boolean, id: string|null }, write: { pending: boolean, id: string|null } }`

### 2.5 Dependencies

- `PERMISSIONS`

### 2.6 Verification Scenarios

- [ ] Requests are matched by `request.node_id === targetNodeId` (same matching for folder and file targets)
- [ ] Missing `targetNodeId` or non-array `requests` returns an empty pending state
- [ ] Read and write requests are tracked independently
- [ ] Request shape: `{ node_id, requested_permission, id }`
