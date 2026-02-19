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

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| createPermissionRequest | ({ folderPath?, filePath?, permission, message? }) | Promise\<Object\> | POST /api/permission-requests |
| listInboxPermissionRequests | ({ status? }) | Promise\<Array\> | GET /api/permission-requests/inbox |
| listOutboxPermissionRequests | ({ status? }) | Promise\<Array\> | GET /api/permission-requests/outbox |
| approvePermissionRequest | (id) | Promise\<Object\> | POST /api/permission-requests/:id/approve |
| rejectPermissionRequest | (id) | Promise\<Object\> | POST /api/permission-requests/:id/reject |
| cancelPermissionRequest | (id) | Promise\<Object\> | POST /api/permission-requests/:id/cancel |
| checkOwnerExists | (folderPathOrFilePath, { forFile? }) | Promise\<Object\> | GET /api/permission-requests/check-owner |

- Create: either folderPath or filePath required

### 2.3 Error Handling

- Errors propagated; MyPage uses getServerErrorDisplay

### 2.4 Verification Scenarios

- [ ] createPermissionRequest sends folderPath or filePath
- [ ] listInbox, listOutbox return arrays
- [ ] approve, reject, cancel call correct endpoints
- [ ] checkOwnerExists uses filePath param when forFile true
