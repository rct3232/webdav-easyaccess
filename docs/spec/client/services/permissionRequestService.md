# permissionRequestService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission request API: create, inbox, outbox, approve, reject, cancel, check owner. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/permissionRequestService.js`
- **Test file:** `client/src/services/__tests__/permissionRequestService.test.js`

### 2.2 Main Functions

All request targets are nodeId-based (`nodeId` is a BIGINT `file_nodes.id`; no `folderPath` / `filePath` payloads).

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| createPermissionRequest | ({ nodeId, permission, message? }) | Promise\<Object\> | POST /api/permission-requests |
| listInboxPermissionRequests | ({ status? }) | Promise\<Array\> | GET /api/permission-requests/inbox |
| listOutboxPermissionRequests | ({ status? }) | Promise\<Array\> | GET /api/permission-requests/outbox |
| approvePermissionRequest | (id) | Promise\<Object\> | POST /api/permission-requests/:id/approve |
| rejectPermissionRequest | (id) | Promise\<Object\> | POST /api/permission-requests/:id/reject |
| cancelPermissionRequest | (id) | Promise\<Object\> | POST /api/permission-requests/:id/cancel |
| checkOwnerExists | (nodeId) | Promise\<Object\> | GET /api/permission-requests/check-owner?nodeId=... |

- Create: `nodeId` required; target type (file/directory) is derived server-side from `file_nodes.type`

### 2.3 Error Handling

- Errors propagated; MyPage uses getServerErrorDisplay

### 2.4 Verification Scenarios

- [ ] createPermissionRequest sends `{ nodeId, permission, message }`
- [ ] listInbox, listOutbox return arrays
- [ ] approve, reject, cancel call correct endpoints
- [ ] checkOwnerExists uses nodeId query param
