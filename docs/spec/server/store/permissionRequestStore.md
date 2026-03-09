# permissionRequestStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission requests (inbox/outbox) for folder/file ACL workflows. Uses single JSON document in `webdav`/`fs` and normalized `permission_requests` table in `postgresql`. |

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

### 2.5 PostgreSQL v2 Table Mapping

- Table: `permission_requests`
- Key columns: `id`, requester/owner fields, target fields, requested permission, status, message, timestamps, resolver
- Constraint/index source of truth: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.6 Transaction Boundaries

- `createRequest`: single transaction with pending dedupe check and insert.
- `updateStatus`: single transaction with status transition and resolver/timestamp updates.
- `deleteByRequesterId`, `rejectByOwnerId`: single transaction per bulk call.

### 2.7 Dependencies

- storage (ensureDir, exists, readFile, writeFile)
- metaPaths (META_ROOT)
- locks.withLock
- shared pathUtils, constants (PERMISSIONS, PERMISSION_REQUEST_STATUS)
- errorHandler, SERVER_ERROR_CODES

### 2.8 Verification Scenarios

- [ ] createRequest returns request; duplicate pending returns existing
- [ ] listInbox/listOutbox filter by owner/requester and status
- [ ] updateStatus: PENDING → clear resolved_at/resolved_by; approved/rejected → set
- [ ] Corrupt doc → reset to fallback
- [ ] PostgreSQL: partial unique index prevents duplicate pending requests for same tuple
- [ ] PostgreSQL: target consistency check rejects invalid folder/file column combinations
