# permissionRequests routes Spec

## 1. Overview

| Item       | Description                                                                                |
| ---------- | ------------------------------------------------------------------------------------------ |
| Mount path | `/api/permission-requests`                                                                 |
| Role       | Permission request lifecycle: create, inbox, outbox, approve, reject, cancel, check owner. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/permissions/routes/permissionRequests.js`
- **Test file:** `server/domains/permissions/routes/__tests__/permissionRequests.test.js`

### 2.2 Route List

| Method | Path           | Auth  | Description                                                                                                                                                                                                                                                                     |
| ------ | -------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/`            | Token | Create request. Body: `nodeId` or `fileNodeId`, `permission`, `message?`                                                                                                                                                                                                        |
| GET    | `/inbox`       | Token | Incoming requests. Query: `status?`                                                                                                                                                                                                                                             |
| GET    | `/outbox`      | Token | Outgoing requests. Query: `status?`                                                                                                                                                                                                                                             |
| GET    | `/check-owner` | Token | Check if node has owner. Query: `nodeId` (or `folderNodeId`/`fileNodeId`).                                                                                                                                                                                                      |
| POST   | `/:id/approve` | Token | Approve (owner): atomically grants `requested_permission` on `file_node_id` (file-level grants via `grantFilePermission` when the target node is a file), then sets status `approved`. 404 when the target node no longer exists; a grant failure propagates without approving. |
| POST   | `/:id/reject`  | Token | Reject (owner).                                                                                                                                                                                                                                                                 |
| POST   | `/:id/cancel`  | Token | Cancel (requester).                                                                                                                                                                                                                                                             |

### 2.3 Middleware Used

- `authenticateToken`

### 2.4 Request/Response Spec

- Create: body `nodeId` or `fileNodeId` (one required), `permission`, `message?`. 200: `{ id, requester_id, owner_id, requested_permission, status, ... }` (snake_case).
- Inbox/outbox: 200 array (snake_case fields)
- Approve/reject/cancel: 200
- **Approve atomicity:** `POST /:id/approve` grants exactly `requested_permission` to `requester_id` on `file_node_id` (directory grant via `permissionStore.grant`, file grant via `grantFilePermission`) before transitioning the request to `approved`. If the grant throws, the error propagates and the request stays `pending`. If the target node no longer resolves, approve returns 404 and grants nothing.
- **Enriched target fields:** every permission request row returned by POST `/` (create), GET `/inbox`, and GET `/outbox` is enriched with:
  - `display_path` (string | null): absolute path of the target node (e.g. `/alice/docs/file.txt`), resolved via `fileNodeService.getNodePath(file_node_id)`. `null` when the target node no longer resolves.
  - `target_name` (string | null): the target node's `name` (from `file_nodes`). `null` when the target node no longer resolves.
  - All existing fields (`id`, `requester_id`, `requester_username`, `owner_id`, `owner_username`, `file_node_id`, `requested_permission`, `status`, `message`, `created_at`, `resolved_at`, `resolved_by`, `targetType`) are unchanged.

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Create requires requester; inbox/outbox return correct lists
- [ ] Approve/reject require owner; cancel requires requester
- [ ] Approve alone grants exactly the requested permission (read/write, directory and file targets) without a client-side grant
- [ ] Approve on a deleted target node returns 404 and grants nothing
