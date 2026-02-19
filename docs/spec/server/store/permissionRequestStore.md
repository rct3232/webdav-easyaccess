# permissionRequestStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission requests (inbox/outbox). Single JSON file with nextId and requests array. Supports folder and file-level requests. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/permissionRequestStore.js`
- **Test file:** `server/store/__tests__/permissionRequestStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| ensurePermissionRequestsFile | () => Promise\<void\> | Bootstrap file |
| createRequest | (payload) => Promise\<object\> | Create request; dedupes pending for same tuple |
| getById | (id) => Promise\<object \| null\> | Fetch by id |
| listInbox | (ownerId, { status }?) => Promise\<Array\> | Owner's inbox, optional status filter |
| listOutbox | (requesterId, { status }?) => Promise\<Array\> | Requester's outbox |
| updateStatus | (id, { status, resolvedBy }) => Promise\<object\> | Resolve/reject |
| deleteByRequesterId | (userId) => Promise\<{ deletedCount }\> | Delete all by requester |
| rejectByOwnerId | (userId, resolvedBy?) => Promise\<{ rejectedCount }\> | Bulk reject by owner |

### 2.3 Storage Paths

- `/.wea/permission_requests.json` (nextId, requests[])

### 2.4 Request Shape

- id, requester_id, requester_username, owner_id, owner_username, folder_path, file_path, target_type ('folder'|'file'), requested_permission, status, message, created_at, resolved_at, resolved_by

### 2.5 Dependencies

- storage (ensureDir, exists, readFile, writeFile)
- metaPaths (META_ROOT)
- locks.withLock
- shared pathUtils, constants (PERMISSIONS, PERMISSION_REQUEST_STATUS)
- errorHandler, SERVER_ERROR_CODES

### 2.6 Verification Scenarios

- [ ] createRequest returns request; duplicate pending returns existing
- [ ] listInbox/listOutbox filter by owner/requester and status
- [ ] updateStatus: PENDING → clear resolved_at/resolved_by; approved/rejected → set
- [ ] Corrupt doc → reset to fallback
