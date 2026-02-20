# permissionRequests routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/permission-requests` |
| Role | Permission request lifecycle: create, inbox, outbox, approve, reject, cancel, check owner. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/permissionRequests.js`
- **Test file:** `server/routes/__tests__/permissionRequests.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | Token | Create request. Body: folderPath or filePath, permission, message? |
| GET | `/inbox` | Token | Incoming requests. Query: status? |
| GET | `/outbox` | Token | Outgoing requests. Query: status? |
| GET | `/check-owner` | Token | Check if path has owner. Query: folderPath or filePath. |
| POST | `/:id/approve` | Token | Approve (owner). |
| POST | `/:id/reject` | Token | Reject (owner). |
| POST | `/:id/cancel` | Token | Cancel (requester). |

### 2.3 Middleware Used

- `authenticateToken`

### 2.4 Request/Response Spec

- Create: body folderPath or filePath (one required), permission, message. 200: `{ id, requester_id, owner_id, requested_permission, status, ... }` (snake_case).
- Inbox/outbox: 200 array (snake_case fields)
- Approve/reject/cancel: 200

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Create requires requester; inbox/outbox return correct lists
- [ ] Approve/reject require owner; cancel requires requester
