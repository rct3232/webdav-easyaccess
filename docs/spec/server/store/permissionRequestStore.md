# permissionRequestStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission requests (inbox/outbox) for folder/file ACL workflows. Uses normalized table in postgresql/sqlite. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/permissions/stores/permissionRequestStore.js`
- **Test file:** `server/domains/permissions/routes/__tests__/permissionRequests.test.js` (route-level integration tests; no dedicated store unit test)

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| createRequest | (payload) => Promise\<object\> | Create request; dedupes pending for same tuple |
| getById | (id) => Promise\<object \| null\> | Fetch by id |
| listInbox | (ownerId, { status }?) => Promise\<Array\> | Owner's inbox, optional status filter |
| listOutbox | (requesterId, { status }?) => Promise\<Array\> | Requester's outbox |
| updateStatus | (id, { status, resolvedBy }) => Promise\<object\> | Resolve/reject |
| deleteByRequesterId | (userId) => Promise\<{ deletedCount }\> | Delete all by requester |
| rejectByOwnerId | (userId, resolvedBy?) => Promise\<{ rejectedCount }\> | Bulk reject by owner |

### 2.3 Request Shape

- id, requester_id, requester_username, owner_id, owner_username, file_node_id, requested_permission, status, message, created_at, resolved_at, resolved_by
- Target type derivable from `file_nodes.type`

### 2.4 PostgreSQL v2 Table Mapping

- Table: `permission_requests`
- Key columns: `id`, requester/owner fields, `file_node_id REFERENCES file_nodes(id) ON DELETE CASCADE`, requested permission, status, message, timestamps, resolver
- Partial unique indexes rewritten for `file_node_id` instead of path-based tuples
- Constraint/index source of truth: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.5 Transaction Boundaries

- `createRequest`: single transaction with pending dedupe check and insert.
- `updateStatus`: single transaction with status transition and resolver/timestamp updates.
- `deleteByRequesterId`, `rejectByOwnerId`: single transaction per bulk call.

### 2.6 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter
- locks.withLock
- shared constants (PERMISSIONS, PERMISSION_REQUEST_STATUS)
- errorHandler, SERVER_ERROR_CODES

### 2.7 Verification Scenarios

- [ ] createRequest returns request; duplicate pending returns existing
- [ ] listInbox/listOutbox filter by owner/requester and status
- [ ] updateStatus: PENDING → clear resolved_at/resolved_by; approved/rejected → set
- [ ] PostgreSQL: partial unique index prevents duplicate pending requests for same (requester_id, owner_id, file_node_id) tuple
