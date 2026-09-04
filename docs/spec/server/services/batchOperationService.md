# batchOperationService Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role | nodeId-based batch operations replacing path-based bulk workers. Delegates all per-item work to fileService so that subtree traversal, closure-table maintenance, and storage dispatch remain in a single location. Async permission gates via aclService with `PERMISSIONS.READ` / `PERMISSIONS.WRITE` constants replace the former sync checker functions (`buildSyncWriteChecker`, etc.). No direct storage calls — every mutation flows through fileService → blobStorageService. Integrates with the existing job system: `opStore.createJob` + `scheduleBulkWorker` create jobs; worker dispatches to this service per item and writes progress via operation-progress store. Payloads carry nodeId-only data (no path fields). Error entries include a `status` field (`'skipped'` for permission-denied items, `'failed'` for runtime errors). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/batchOperationService.js`
- **Test file:** `server/domains/files/services/__tests__/batchOperationService.test.js`

### 2.2 Factory Function Signature

```js
function createBatchOperationService({ fileNodeService, fileService, aclService }) {
  return {
    batchDelete(nodeIds, userId, user),
    batchMove(moves, userId, user),
    batchCopy(copies, userId, user)
  };
}
```

| Param           | Type   | Required | Description                                                                                                                                |
| --------------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| fileNodeService | object | yes      | Imported but not directly invoked by batch methods; retained for API compatibility and future nodeId resolution — see `fileNodeService.md` |
| fileService     | object | yes      | Per-item operation delegation: deleteNode, moveNode, copyFile — see `fileService.md`                                                       |
| aclService      | object | yes      | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser — see `aclService.js`                                      |

### 2.3 Methods

#### `batchDelete(nodeIds, userId, user)`

Deletes multiple nodes (and their subtrees) in sequence. Each node is independently permission-gated before delegation to fileService.deleteNode.

| Param   | Type     | Required | Description                                                       |
| ------- | -------- | -------- | ----------------------------------------------------------------- |
| nodeIds | number[] | yes      | Array of top-level file_nodes IDs to delete                       |
| userId  | number   | yes      | ID of the requesting user (principal)                             |
| user    | object   | yes      | Full user object with `is_admin` flag for admin bypass resolution |

**Returns:** `{ deletedCount: number, errors: array }` — count of successfully processed items and per-item error entries.

```js
{
  deletedCount: 3,
  errors: [
    { nodeId: 42, status: 'skipped', reason: 'permission_denied' },
    { nodeId: 57, status: 'failed', reason: 'node_not_found' }
  ]
}
```

**Operations (per nodeId):**

1. **Permission gate:** If not `aclService.isAdminUser(user)`, call `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE)` directly on the node itself. If false, push `{ nodeId, status: 'skipped', reason: 'permission_denied' }` to errors and skip to next item.
2. **Delegation:** Call `fileService.deleteNode(nodeId, userId, user)`. This handles descendant enumeration via getDescendantIds, storage deletion (mode-dependent), and DB cleanup through fileNodeService. On success, increment deletedCount.
3. **Error capture:** If fileService.deleteNode throws, push `{ nodeId, status: 'failed', reason: error.message }` to errors and continue with next item (no abort).

**Processing order:** Sequential iteration over nodeIds array. Partial failures are recorded; remaining items still processed.

---

#### `batchMove(moves, userId, user)`

Moves multiple nodes to new parent directories in sequence. Each move is independently permission-gated before delegation to fileService.moveNode.

| Param  | Type   | Required | Description                                                                          |
| ------ | ------ | -------- | ------------------------------------------------------------------------------------ |
| moves  | array  | yes      | Array of `{ sourceNodeId: number, destinationParentNodeId: number \| null }` objects |
| userId | number | yes      | ID of the requesting user (principal)                                                |
| user   | object | yes      | Full user object with `is_admin` flag for admin bypass resolution                    |

**Returns:** `{ movedCount: number, errors: array }` — count of successfully processed moves and per-move error entries.

```js
{
  movedCount: 2,
  errors: [
    { sourceNodeId: 10, destinationParentNodeId: 5, status: 'skipped', reason: 'permission_denied' },
    { sourceNodeId: 12, destinationParentNodeId: 8, status: 'failed', reason: 'cycle_detected' }
  ]
}
```

**Operations (per move item):**

1. **Permission gate — source:** If not admin, call `aclService.checkFilePermission(userId, sourceNodeId, PERMISSIONS.WRITE)` directly on the source node. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item.
2. **Permission gate — destination:** If not admin, call `aclService.checkFolderPermission(userId, move.destinationParentNodeId, PERMISSIONS.WRITE)`. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item. Both source and destination failures produce the same single `'permission_denied'` reason.
3. **Delegation:** Call `fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user)`. On success, increment movedCount.
4. **Error capture:** If fileService.moveNode throws (e.g., cycle detection, node not found), push `{ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, status: 'failed', reason: error.message }` to errors and continue with next item.

**Processing order:** Sequential iteration over moves array. Partial failures are recorded; remaining items still processed.

---

#### `batchCopy(copies, userId, user)`

Copies multiple files to destination directories in sequence. Copy semantics are delegated entirely to fileService.copyFile (S3 mode = copy-on-write with shared-blob detection; WebDAV mode = actual blob download + re-upload). Each copy is independently permission-gated before delegation.

| Param  | Type   | Required | Description                                                                          |
| ------ | ------ | -------- | ------------------------------------------------------------------------------------ |
| copies | array  | yes      | Array of `{ sourceNodeId: number, destinationParentNodeId: number \| null }` objects |
| userId | number | yes      | ID of the requesting user (principal)                                                |
| user   | object | yes      | Full user object with `is_admin` flag for admin bypass resolution                    |

**Returns:** `{ copiedCount: number, errors: array }` — count of successfully processed copies and per-copy error entries.

```js
{
  copiedCount: 1,
  errors: [
    { sourceNodeId: 20, destinationParentNodeId: 6, status: 'skipped', reason: 'permission_denied' },
    { sourceNodeId: 21, destinationParentNodeId: 7, status: 'failed', reason: 'no_active_blob' }
  ]
}
```

**Operations (per copy item):**

1. **Permission gate — source read:** If not admin, call `aclService.checkFilePermission(userId, copy.sourceNodeId, PERMISSIONS.READ)`. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item.
2. **Permission gate — destination write:** If not admin, call `aclService.checkFolderPermission(userId, copy.destinationParentNodeId, PERMISSIONS.WRITE)`. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item. Both source read and destination write failures produce the same single `'permission_denied'` reason.
3. **Delegation:** Call `fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, copy.newName || null, userId, user)`. On success, increment copiedCount.
4. **Error capture:** If fileService.copyFile throws (e.g., no active blob for source, name conflict), push `{ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, status: 'failed', reason: error.message }` to errors and continue with next item.

**Processing order:** Sequential iteration over copies array. Partial failures are recorded; remaining items still processed.

### 2.4 Dependencies

| Dependency      | Purpose                                                                                                                                    |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| fileNodeService | Imported but not directly used by batch methods; available for future nodeId resolution needs — see `fileNodeService.md`                   |
| fileService     | Per-item operation delegation: deleteNode, moveNode, copyFile — carries all closure-table and storage-backend logic — see `fileService.md` |
| aclService      | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser — see `aclService.js`                                      |

---

## 3. Permission Gate Strategy

All permission checks are async calls to `aclService`, replacing the former sync checker functions entirely. No `buildSyncWriteChecker`, `buildSyncReadChecker`, or similar constructs exist in this service.

| Operation                          | Permission Check                  | aclService Call                                                                        |
| ---------------------------------- | --------------------------------- | -------------------------------------------------------------------------------------- |
| batchDelete (per item)             | Write on the node itself          | `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE)`                    |
| batchMove — source (per item)      | Write on the source node directly | `aclService.checkFilePermission(userId, sourceNodeId, PERMISSIONS.WRITE)`              |
| batchMove — destination (per item) | Write on target parent directory  | `aclService.checkFolderPermission(userId, destinationParentNodeId, PERMISSIONS.WRITE)` |
| batchCopy — source (per item)      | Read on source file node          | `aclService.checkFilePermission(userId, sourceNodeId, PERMISSIONS.READ)`               |
| batchCopy — destination (per item) | Write on target parent directory  | `aclService.checkFolderPermission(userId, destinationParentNodeId, PERMISSIONS.WRITE)` |

Admin bypass: `aclService.isAdminUser(user)` returning true skips all permission checks for the item. Each item is checked independently; one denied item does not block processing of remaining items in the batch.

---

## 4. Closure Table Awareness

The batch service does NOT manage node_ancestors or closure-table state directly. All ancestry operations are delegated to fileService, which in turn delegates to fileNodeService:

- **deleteNode:** fileService calls `fileNodeService.getDescendantIds(nodeId)` to enumerate the full subtree from the closure table, then passes IDs to fileNodeService.deleteNode for TX-wrapped cleanup (DELETE node_ancestors + FK CASCADE).
- **moveNode:** fileService delegates to `fileNodeService.moveNode(nodeId, newParentNodeId)`, which handles cycle detection via getDescendantIds and rebuilds the closure table in a transaction through `_ancestryHelper`.
- **copyFile:** Creates a new independent node; no closure-table relationship with source. Children of copied directory are recursively recreated with fresh ancestor rows (handled by fileService/fileNodeService).

The batch service's only interaction with ancestry data is indirect: it receives nodeId inputs and passes them to fileService methods that handle all closure-table concerns internally.

---

## 5. Worker Integration

The existing job system is preserved. The batchOperationService produces the same return shapes regardless of whether it is invoked directly or through a worker.

### 5.1 Job Creation

- `opStore.createJob(...)` creates the job record with nodeId-only payload (no path fields).
- `scheduleBulkWorker(jobId)` schedules async execution.

### 5.2 Worker Dispatch

`runBulkJobWorker(jobId)` acts as a thin dispatcher:

1. Reads job from opStore to extract `job.payload` containing `nodeIds`, `moves`, or `copies`.
2. Calls the corresponding batchOperationService method (`batchDelete`, `batchMove`, or `batchCopy`).
3. Writes progress updates via operation-progress store as each item completes (success or error).
4. On finalization, writes aggregate result `{ count, errors }` back to the job record.

### 5.2 Payload Format

All payloads are nodeId-only. No path fields are stored in job payloads.

```js
// Delete job payload
{ type: 'batchDelete', nodeIds: [10, 20, 30] }

// Move job payload
{ type: 'batchMove', moves: [{ sourceNodeId: 10, destinationParentNodeId: 5 }, { sourceNodeId: 20, destinationParentNodeId: 5 }] }

// Copy job payload
{ type: 'batchCopy', copies: [{ sourceNodeId: 10, destinationParentNodeId: 5 }] }
```

---

## 6. Error Cases

### Partial Failures

Operations that pass permission checks but fail at the fileService or storage layer are recorded in `errors[]` with nodeId and reason string. The batch does not abort — remaining items continue processing. Each item is its own transaction boundary inherited from fileService.

| Scenario                                                         | Behavior                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Permission denied on one item                                    | Item skipped, error entry added, remaining items still processed                                                  |
| Node not found during delete/move/copy                           | Error entry with `reason: 'node_not_found'`, remaining items continue                                             |
| Cycle detected during move                                       | Error entry for that specific move, remaining moves process normally                                              |
| Storage failure — S3 mode (e.g., orphaned_node from fileService) | Error propagated per item; batch continues with next nodeId                                                       |
| Storage failure — WebDAV mode (connection refused, timeout)      | fileService sets sync_status='orphaned_node' as fail-safe; error recorded in `errors[]`, remaining items continue |
| All items fail                                                   | Returns `{ deletedCount: 0, errors: [...] }` with one entry per failed item                                       |

### Transaction Semantics

Per-item transactional integrity is maintained by fileService/fileNodeService. The batch service itself performs no transaction wrapping — it relies on the delegated methods to commit or roll back atomically per operation. A failure in item N does not undo successful items 1 through N-1.

---

## 7. Verification Scenarios

### batchDelete

- [ ] Deletes multiple leaf file nodes successfully, returns `{ deletedCount: N, errors: [] }` for N valid items
- [ ] Deletes directory node and all descendants via fileService.deleteNode cascade (closure table enumeration)
- [ ] Skips item when user lacks write permission on the node itself; error entry has `status: 'skipped'`, reason `'permission_denied'`
- [ ] Admin user bypasses permission checks — all items processed regardless of ACL state
- [ ] Partial failure: first nodeId valid, second nodeId non-existent → returns `{ deletedCount: 1, errors: [{ nodeId: X, status: 'failed', reason: 'node_not_found' }] }`
- [ ] Empty nodeIds array → returns `{ deletedCount: 0, errors: [] }` immediately

### batchMove

- [ ] Moves multiple nodes to new parent successfully, updates closure table via fileService.moveNode
- [ ] Checks write permission on source node directly AND destination parent per item
- [ ] Skips item with `status: 'skipped'`, reason `'permission_denied'` when user cannot write to source or destination (same reason for both)
- [ ] Cycle detection: move rejected by fileService.moveNode → error entry with `status: 'failed'` captured, remaining moves proceed
- [ ] destinationParentNodeId as null (move to root) is a valid operation

### batchCopy

- [ ] Copies multiple files successfully, creates new file_nodes with independent blob references
- [ ] S3 mode: zero-copy when source blob exclusively owned; duplicateBlob when shared — delegated to fileService.copyFile
- [ ] WebDAV mode: downloads source content and re-uploads at destination path — delegated to fileService.copyFile
- [ ] Checks read permission on source node per item via `PERMISSIONS.READ`
- [ ] Checks write permission on destination parent per item via `PERMISSIONS.WRITE`
- [ ] Skips item with `status: 'skipped'`, reason `'permission_denied'` when user cannot read source or write to destination (same reason for both)
- [ ] Error captured with `status: 'failed'` when source has no active blob (no storage content to copy)

### Cross-cutting

- [ ] No `buildSync*Checker` calls exist anywhere in the batchOperationService implementation
- [ ] All permission checks route through aclService async methods
- [ ] Job payload contains only nodeId references, no path strings
- [ ] Worker dispatcher reads job.payload and routes to correct batch method based on type field
