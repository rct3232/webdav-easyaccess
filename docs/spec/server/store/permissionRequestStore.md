# permissionRequestStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Permission requests (inbox/outbox) for folder/file ACL workflows. Uses normalized table in postgresql/sqlite; all references use `file_node_id` BIGINT foreign keys instead of path strings. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/permissions/stores/permissionRequestStore.js`
- **Test file:** `server/domains/permissions/routes/__tests__/permissionRequests.test.js` (route-level integration tests; no dedicated store unit test)

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| createRequest | ({ requesterId, ownerId, fileNodeId, requestedPermission }) => Promise\<object\> | Create request; dedupes pending for same tuple |
| getById | (id) => Promise\<object \| null\> | Fetch by id |
| listInbox | (ownerId, { status }?) => Promise\<Array\> | Owner's inbox, optional status filter |
| listOutbox | (requesterId, { status }?) => Promise\<Array\> | Requester's outbox |
| updateStatus | (id, { status, resolvedBy }) => Promise\<object\> | Resolve/reject |
| deleteByRequesterId | (userId) => Promise\<{ deletedCount }\> | Delete all by requester |
| rejectByOwnerId | (userId, resolvedBy?) => Promise\<{ rejectedCount }\> | Bulk reject by owner |

### 2.3 Request Shape

- id, requester_id, requester_username, owner_id, owner_username, file_node_id, requested_permission, status, message, created_at, resolved_at, resolved_by
- Target type (`file`/`directory`) derivable from `file_nodes.type` via JOIN; not stored redundantly in the requests table

### 2.4 PostgreSQL v2 Table Mapping

- Table: `permission_requests`
- Key columns: `id`, requester/owner fields, `file_node_id REFERENCES file_nodes(id) ON DELETE CASCADE`, requested_permission, status, message, timestamps, resolver
- **Removed columns:** `folder_path TEXT`, `file_path TEXT`, `target_type TEXT` — replaced by single `file_node_id BIGINT NOT NULL`
- Partial unique index: `(requester_id, owner_id, requested_permission, file_node_id) WHERE status = 'pending'` prevents duplicate pending requests for the same target node
- Constraint/index source of truth: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.5 Deduplication

A new request is considered a duplicate if there already exists a row with matching `(requester_id, owner_id, requested_permission, file_node_id)` and `status = 'pending'`. The partial unique index enforces this at the database level; application code must catch the duplicate-key error and return the existing pending request.

### 2.6 Transaction Boundaries

- `createRequest`: single transaction with pending dedupe check and insert.
- `updateStatus`: single transaction with status transition and resolver/timestamp updates.
- `deleteByRequesterId`, `rejectByOwnerId`: single transaction per bulk call.

### 2.7 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter
- locks.withLock
- shared constants (PERMISSIONS, PERMISSION_REQUEST_STATUS)
- errorHandler, SERVER_ERROR_CODES

### 2.8 Verification Scenarios

- [ ] createRequest returns request; duplicate pending for same `(requester_id, owner_id, requested_permission, file_node_id)` returns existing
- [ ] listInbox/listOutbox filter by owner/requester and status
- [ ] updateStatus: PENDING → clear resolved_at/resolved_by; approved/rejected → set
- [ ] PostgreSQL: partial unique index prevents duplicate pending requests for same tuple
- [ ] ON DELETE CASCADE removes request when target `file_nodes` row is deleted
