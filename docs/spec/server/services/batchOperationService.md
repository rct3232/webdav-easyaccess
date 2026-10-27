# batchOperationService Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | nodeId-based batch operations replacing path-based bulk workers. Delegates all per-item work to fileService so that subtree traversal, closure-table maintenance, and storage dispatch remain in a single location. Async permission gates via aclService with `PERMISSIONS.READ` / `PERMISSIONS.WRITE` constants replace the former sync checker functions (`buildSyncWriteChecker`, etc.). No direct storage calls — every mutation flows through fileService → blobStorageService. Integrates with the existing job system: `opStore.createJob` + `scheduleBulkWorker` create jobs; worker dispatches to this service per item and writes progress via operation-progress store. Payloads carry nodeId-only data (no path fields). Error entries include a `status` field (`'skipped'` for permission-denied items, `'failed'` for runtime errors). The worker honors the job's `cancelled` flag at every item boundary and settles the job `cancelled` (§5.2). Every accepted move/copy batch writes ONE command-unit undo journal row — `domain='batch'`, subject `batch:<jobId>`, item-level inverse list in the payload (`store/actionJournalStore.md` binding) — and the terminal poll result carries its `undo: { action_id }` pointer. Delete batches are never journaled: delete-to-trash undo belongs to the trash restore surface (undo-availability matrix), not the journal. This module also registers the `batch` undo executor (§5.5). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/files/services/batchOperationService.js`
- **Test file:** `server/domains/files/services/__tests__/batchOperationService.test.js`

### 2.2 Factory Function Signature

```js
function createBatchOperationService({ fileNodeService, fileService, aclService }) {
  return {
    batchDelete(nodeIds, userId, user, options),
    batchMove(moves, userId, user, options),
    batchCopy(copies, userId, user, options)
  };
}
```

| Param           | Type   | Required | Description                                                                                                                                                                                   |
| --------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fileNodeService | object | yes      | Tree reads used by the batch loops — `getNode` captures each move's previous parent and each copy's created-node name for the journal's item-level inverses (§5.4) — see `fileNodeService.md` |
| fileService     | object | yes      | Per-item operation delegation: deleteNode, moveNode, copyFile — see `fileService.md`                                                                                                          |
| aclService      | object | yes      | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser — see `aclService.js`                                                                                         |

| Options (`options`) | Type          | Required | Description                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| isCancelled         | () => boolean | no       | Synchronous cancellation seam checked BEFORE every item. When it returns true the loop stops; every unprocessed item is recorded as a skip with reason `'cancelled'` and the result carries `cancelled: true`. The bulk worker wires this to the operation-progress job's `cancelled` flag (set by `POST /bulk-operation/:jobId/cancel`). |

### 2.3 Methods

#### `batchDelete(nodeIds, userId, user)`

Deletes multiple nodes (and their subtrees) in sequence. Each node is independently permission-gated before delegation to fileService.deleteNode.

| Param   | Type     | Required | Description                                                       |
| ------- | -------- | -------- | ----------------------------------------------------------------- |
| nodeIds | number[] | yes      | Array of top-level file_nodes IDs to delete                       |
| userId  | number   | yes      | ID of the requesting user (principal)                             |
| user    | object   | yes      | Full user object with `is_admin` flag for admin bypass resolution |

**Returns:** `{ deletedCount: number, succeeded: number[], errors: array, cancelled: boolean }` — count of successfully processed items, the succeeded nodeIds (journal-relevant shape for delete is none — delete batches are not journaled), per-item error entries, and the cancellation marker.

```js
{
  deletedCount: 3,
  succeeded: [42, 43, 44],
  errors: [
    { nodeId: 42, status: 'skipped', reason: 'permission_denied' },
    { nodeId: 57, status: 'failed', reason: 'node_not_found' }
  ],
  cancelled: false
}
```

**Operations (per nodeId):**

1. **Cancellation gate:** If `options.isCancelled()` returns true, stop the loop — the current and all remaining items are appended to `errors` as `{ nodeId, status: 'skipped', reason: 'cancelled' }`, `cancelled` becomes true, and no further permission or delegate calls run.
2. **Permission gate:** If not `aclService.isAdminUser(user)`, call `aclService.checkFilePermission(userId, nodeId, PERMISSIONS.WRITE)` directly on the node itself. If false, push `{ nodeId, status: 'skipped', reason: 'permission_denied' }` to errors and skip to next item.
3. **Delegation:** Call `fileService.deleteNode(nodeId, userId, user)`. This handles descendant enumeration via getDescendantIds, storage deletion (mode-dependent), and DB cleanup through fileNodeService. On success, increment deletedCount and push the nodeId to `succeeded`.
4. **Error capture:** If fileService.deleteNode throws, push `{ nodeId, status: 'failed', reason: error.message }` to errors and continue with next item (no abort).

**Processing order:** Sequential iteration over nodeIds array. Partial failures are recorded; remaining items still processed.

---

#### `batchMove(moves, userId, user)`

Moves multiple nodes to new parent directories in sequence. Each move is independently permission-gated before delegation to fileService.moveNode.

| Param  | Type   | Required | Description                                                                          |
| ------ | ------ | -------- | ------------------------------------------------------------------------------------ |
| moves  | array  | yes      | Array of `{ sourceNodeId: number, destinationParentNodeId: number \| null }` objects |
| userId | number | yes      | ID of the requesting user (principal)                                                |
| user   | object | yes      | Full user object with `is_admin` flag for admin bypass resolution                    |

**Returns:** `{ movedCount: number, succeeded: array, errors: array, cancelled: boolean }` — count of successfully processed moves, per-move succeeded entries (the journal item source, §5.4), per-move error entries, and the cancellation marker.

```js
{
  movedCount: 2,
  succeeded: [
    { sourceNodeId: 10, destinationParentNodeId: 5, previousParentNodeId: 3 },
    { sourceNodeId: 11, destinationParentNodeId: 5, previousParentNodeId: 7 }
  ],
  errors: [
    { sourceNodeId: 10, destinationParentNodeId: 5, status: 'skipped', reason: 'permission_denied' },
    { sourceNodeId: 12, destinationParentNodeId: 8, status: 'failed', reason: 'cycle_detected' }
  ],
  cancelled: false
}
```

**Operations (per move item):**

1. **Cancellation gate:** If `options.isCancelled()` returns true, stop the loop — the current and all remaining moves are appended to `errors` as `{ sourceNodeId, destinationParentNodeId, status: 'skipped', reason: 'cancelled' }`, `cancelled` becomes true, and no further work runs.
2. **Permission gate — source:** If not admin, call `aclService.checkFilePermission(userId, sourceNodeId, PERMISSIONS.WRITE)` directly on the source node. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item.
3. **Permission gate — destination:** If not admin, call `aclService.checkFolderPermission(userId, move.destinationParentNodeId, PERMISSIONS.WRITE)`. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item. Both source and destination failures produce the same single `'permission_denied'` reason.
4. **Inverse capture:** Read `fileNodeService.getNode(sourceNodeId)` and keep its `parentId` as the entry's `previousParentNodeId` BEFORE delegating — this is the move-back target the journal records (§5.4). A node whose pre-move parent cannot be read (the row is gone) is still attempted; the fileService gate below fails it.
5. **Delegation:** Call `fileService.moveNode(move.sourceNodeId, move.destinationParentNodeId, userId, user)`. On success, increment movedCount and push the succeeded entry `{ sourceNodeId, destinationParentNodeId, previousParentNodeId }`.
6. **Error capture:** If fileService.moveNode throws (e.g., cycle detection, node not found), push `{ sourceNodeId: move.sourceNodeId, destinationParentNodeId: move.destinationParentNodeId, status: 'failed', reason: error.message }` to errors and continue with next item.

**Processing order:** Sequential iteration over moves array. Partial failures are recorded; remaining items still processed.

---

#### `batchCopy(copies, userId, user)`

Copies multiple files to destination directories in sequence. Copy semantics are delegated entirely to fileService.copyFile (S3 mode = copy-on-write with shared-blob detection; WebDAV mode = actual blob download + re-upload). Each copy is independently permission-gated before delegation.

| Param  | Type   | Required | Description                                                                          |
| ------ | ------ | -------- | ------------------------------------------------------------------------------------ |
| copies | array  | yes      | Array of `{ sourceNodeId: number, destinationParentNodeId: number \| null }` objects |
| userId | number | yes      | ID of the requesting user (principal)                                                |
| user   | object | yes      | Full user object with `is_admin` flag for admin bypass resolution                    |

**Returns:** `{ copiedCount: number, succeeded: array, errors: array, cancelled: boolean }` — count of successfully processed copies, per-copy succeeded entries (the journal item source, §5.4), per-copy error entries, and the cancellation marker.

```js
{
  copiedCount: 1,
  succeeded: [
    { sourceNodeId: 20, destinationParentNodeId: 6, copiedNodeId: 88, name: 'report.pdf' }
  ],
  errors: [
    { sourceNodeId: 21, destinationParentNodeId: 7, status: 'skipped', reason: 'permission_denied' },
    { sourceNodeId: 22, destinationParentNodeId: 8, status: 'failed', reason: 'no_active_blob' }
  ],
  cancelled: false
}
```

**Operations (per copy item):**

1. **Cancellation gate:** If `options.isCancelled()` returns true, stop the loop — the current and all remaining copies are appended to `errors` as `{ sourceNodeId, destinationParentNodeId, status: 'skipped', reason: 'cancelled' }`, `cancelled` becomes true, and no further work runs.
2. **Permission gate — source read:** If not admin, call `aclService.checkFilePermission(userId, copy.sourceNodeId, PERMISSIONS.READ)`. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item.
3. **Permission gate — destination write:** If not admin, call `aclService.checkFolderPermission(userId, copy.destinationParentNodeId, PERMISSIONS.WRITE)`. If false, push error with `status: 'skipped'` and reason `'permission_denied'` and skip to next item. Both source read and destination write failures produce the same single `'permission_denied'` reason.
4. **Delegation:** Call `fileService.copyFile(copy.sourceNodeId, copy.destinationParentNodeId, copy.newName || null, userId, user)`. On success, increment copiedCount and push the succeeded entry `{ sourceNodeId, destinationParentNodeId, copiedNodeId, name }` — `copiedNodeId` is taken from the `copyFile` return value, `name` from `fileNodeService.getNode(copiedNodeId)` (the created node's row name; a lost read yields `name: null` and the item is excluded from journaling, §5.4).
5. **Error capture:** If fileService.copyFile throws (e.g., no active blob for source, name conflict), push `{ sourceNodeId: copy.sourceNodeId, destinationParentNodeId: copy.destinationParentNodeId, status: 'failed', reason: error.message }` to errors and continue with next item.

**Processing order:** Sequential iteration over copies array. Partial failures are recorded; remaining items still processed.

### 2.4 Dependencies

| Dependency      | Purpose                                                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fileNodeService | Per-item reads feeding the journal capture: `getNode` before each move (previous parent) and after each copy (created-node name) — see `fileNodeService.md` |
| fileService     | Per-item operation delegation: deleteNode, moveNode, copyFile — carries all closure-table and storage-backend logic — see `fileService.md`                  |
| aclService      | Async permission gates: checkFolderPermission, checkFilePermission, isAdminUser — see `aclService.js`                                                       |

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

The exported `scheduleBulkWorker(jobId)` schedules the internal worker
(`_processBulkJob(jobId)`, `batchOperationService.js`) for asynchronous execution via
`setImmediate` (respecting the `WEA_SKIP_BULK_WORKER` test seam). `_processBulkJob` acts as the
dispatcher:

1. Reads the job from `opStore.getJob(jobId)` and extracts `job.operation`
   (`'delete'` | `'move'` | `'copy'`) plus `job.payload`.
2. Resolves the requesting principal: `user = await aclService.getCachedUser(job.userId)`
   (composition-injected aclService). If the user no longer exists, the job is marked `failed`
   with `errorMessage` = `serverErrors.auth.userNotFound` — a queued job must never execute
   under a synthesized identity.
3. Builds the cancellation seam `isCancelled` — returns true when the job's `cancelled` flag is
   set (re-read from `opStore.getJob(jobId)` per call; a vanished job reads as cancelled) — and
   dispatches on `job.operation` to the corresponding batchOperationService method **with the
   real user object**: `batchDelete(job.payload.nodeIds, job.userId, user, { isCancelled })`,
   `batchMove(job.payload.moves, job.userId, user, { isCancelled })`,
   `batchCopy(job.payload.copies, job.userId, user, { isCancelled })`.
   The per-item ACL gates and `fileService`'s own gates (including the ownership-transfer
   cleanup) therefore behave exactly as they do for a direct, non-admin call. Admin creators keep
   their bypass because the real user row carries `is_admin` (a synthesized `{ is_admin: true }`
   for move/copy would silently grant every user admin semantics inside the batch channel —
   forbidden).
4. Sets the job `running` at start; an unknown operation marks the job `failed`.
5. Journals the command when applicable (§5.4) — move/copy results with at least one succeeded
   item produce the single `batch:<jobId>` command row and its `undo` pointer.
6. On success, writes the aggregate result back to the job record: `status` = `cancelled` when
   the batch result carries `cancelled: true`, else `completed`; `progress` = the result's count
   (`deletedCount`/`movedCount`/`copiedCount`), `total` = `job.total`, `results` = `succeeded`
   entries first, then the `failed`/`skipped` entries (client contract; internal capture fields —
   `previousParentNodeId`, `copiedNodeId`, `name` — are journal payload data and are NOT
   serialized into `results`), `undo` = `{ actionId }` when journaled (§5.4). Failures set
   `failed` with `errorMessage`.

### 5.3 Payload Format

All payloads are nodeId-only. No path fields are stored in job payloads.

```js
// Delete job payload
{ type: 'batchDelete', nodeIds: [10, 20, 30] }

// Move job payload
{ type: 'batchMove', moves: [{ sourceNodeId: 10, destinationParentNodeId: 5 }, { sourceNodeId: 20, destinationParentNodeId: 5 }] }

// Copy job payload
{ type: 'batchCopy', copies: [{ sourceNodeId: 10, destinationParentNodeId: 5 }] }
```

### 5.4 Command-unit journal write

One accepted batch produces **ONE** `action_journal` command row — never per-item rows:

| Field           | Value                                                               |
| --------------- | ------------------------------------------------------------------- |
| `domain`        | `batch`                                                             |
| `subject`       | `batch:<jobId>`                                                     |
| `subject_label` | `null` (the feed renders the action label; the subject is per-job)  |
| `actor`         | `String(job.userId)` — the requesting principal                     |
| `action`        | `move` \| `copy` (the job operation)                                |
| `payload`       | `{ inverse: { op: 'undo-batch', operation, jobId }, items: [...] }` |

Item entries (`payload.items`, journal-internal camelCase field names):

```js
// move item — inverse returns the node to its pre-move parent
{ nodeId: 10, kind: 'move',
  fingerprint: { parentId: 5 },                      // post-batch parent — the "state unchanged" guard
  inverse: { op: 'move-back', nodeId: 10, parentId: 3 } } // pre-move parent captured at §2.3 step 4

// copy item — inverse trashes the created node
{ nodeId: 88, kind: 'copy',
  fingerprint: { parentId: 6, name: 'report.pdf' },  // created node's position + name at commit time
  inverse: { op: 'trash-node', nodeId: 88 } }
```

Rules:

- **When:** written by `_processBulkJob` after the batch loop, only for `move`/`copy` results
  with at least one succeeded item. Zero-succeeded and cancelled-before-any-item jobs produce no
  row (nothing to undo). Delete batches produce no row — the trash restore surface owns delete
  recovery (undo-availability matrix; the batch-cancel completion row of that matrix means the
  cancellation itself is never undoable — a cancelled move/copy batch still journals its
  succeeded prefix and stays undoable).
- **How:** `actionJournalStore.commitChange('batch', subject, meta, payload, mutation)` with a
  no-op mutation — the per-item work already committed under its own transaction boundaries
  (§6 Transaction Semantics); the row records the inverse list, not a new change.
- **Not journaled items:** succeeded entries missing capture data (move without a readable
  previous parent; copy without a readable created-node name) are excluded from `items`.
- **Terminal pointer:** the commit's `id` is stored on the job as `undo: { actionId }` and
  surfaces on `GET /bulk-operation/:jobId` as `undo: { action_id }` — the batch variant of the
  toast contract (one toast per command).
- **Tolerance:** a journal-write failure (including lock timeout) is logged and swallowed; the
  job still settles `completed`/`cancelled` with its results and `undo: null`. Losing undo is
  acceptable; losing the completion report is not.

### 5.5 Batch-domain undo executor

This module registers the executor at load time via
`actionJournalStore.registerUndoExecutor('batch', handler)`; the handler applies `payload.items`
fingerprint-guarded, one outcome per item (mixed results allowed — `store/actionJournalStore.md`
§2.4). Mechanics:

- **Transaction binding:** the DB-side writes run on `FileNodeRepository` constructed over the
  journal undo transaction client (and `service/_ancestryHelper` over the same) — closure-table
  maintenance stays SQL-inside-the-repository and commits atomically with the `status='undone'`
  flip on BOTH dialects. Service methods that open their own transaction (`fileNodeService`) are
  never called inside the undo transaction (the sqlite transaction queue would self-deadlock).
- **Fingerprint guard (per item):** the current live row is re-read through the transaction
  client. `move` — node missing, trashed, or `parent_id != fingerprint.parentId` ⇒ skip
  (`reason: 'changed'`); a restore target that lies inside the moved node's own subtree (ancestry
  rebuilt underneath the batch) ⇒ skip. `copy` — created node missing/trashed, or its
  `parent_id`/`name` diverged from the fingerprint ⇒ skip. A skipped item is not an error: the
  pass proceeds and the counts surface as `items_undone`/`items_skipped`.
- **`move-back` application:** parent flip + `rebuildAncestorsAfterMove` through the transaction
  client. WebDAV mode additionally performs ONE remote `moveBlob` from the post-batch display path
  to the restored display path (paths resolved through the same transaction client), mirroring the
  `fileService.moveNode` policy: MOVE failure ⇒ THROW — the whole undo transaction aborts, no row
  flips, the operation stays tip-eligible and retryable; MOVE failure with
  `webdav.sourceNotFound` (the node was already an orphan — there is nothing to move) ⇒ the DB
  restore stands and `sync_status='orphaned_node'` is written through the transaction client.
- **`trash-node` application:** the created copy is trashed through the forward delete channel —
  `fileService.deleteNode(copiedNodeId, actor, user)` with `user` resolved from `row.actor` via
  `aclService.getCachedUser` (soft mark of node + descendants, WebDAV remote MOVE to
  `/.wea-trash/<nodeId>` with the destination-exists guard). A missing actor user, a failed
  permission gate, or a storage failure ⇒ THROW (abort, retryable). Undo does NOT restore remote
  content for delete-batch items — delete was never journaled.
- **Throw vs skip:** only state-change conditions skip. Any application failure THROWs, aborting
  the whole cascade transaction so nothing half-applies and the row stays `applied` (store §2.6).

---

## 6. Error Cases

### Partial Failures

Operations that pass permission checks but fail at the fileService or storage layer are recorded in `errors[]` with nodeId and reason string. The batch does not abort — remaining items continue processing. Each item is its own transaction boundary inherited from fileService.

| Scenario                                                         | Behavior                                                                                                                                                         |
| ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Permission denied on one item                                    | Item skipped, error entry added, remaining items still processed                                                                                                 |
| Node not found during delete/move/copy                           | Error entry with `reason: 'node_not_found'`, remaining items continue                                                                                            |
| Cycle detected during move                                       | Error entry for that specific move, remaining moves process normally                                                                                             |
| Storage failure — S3 mode (e.g., orphaned_node from fileService) | Error propagated per item; batch continues with next nodeId                                                                                                      |
| Storage failure — WebDAV mode (connection refused, timeout)      | fileService sets sync_status='orphaned_node' as fail-safe; error recorded in `errors[]`, remaining items continue                                                |
| All items fail                                                   | Returns `{ deletedCount: 0, errors: [...] }` with one entry per failed item                                                                                      |
| `isCancelled()` true at an item boundary                         | Loop stops there; current + remaining items get `status: 'skipped'`, `reason: 'cancelled'` entries; result carries `cancelled: true`; succeeded prefix is intact |
| Job cancelled before the first item                              | No item executes; every payload item is reported skipped/cancelled; no journal row is written                                                                    |

### Transaction Semantics

Per-item transactional integrity is maintained by fileService/fileNodeService. The batch service itself performs no transaction wrapping — it relies on the delegated methods to commit or roll back atomically per operation. A failure in item N does not undo successful items 1 through N-1. The undo journal does not change this: the command row records the per-item inverses after the fact, and undo re-applies them item-by-item through the §5.5 executor (skipping items whose fingerprint no longer matches).

---

## 7. Verification Scenarios

### batchDelete

- [ ] Deletes multiple leaf file nodes successfully, returns `{ deletedCount: N, succeeded: [ids], errors: [], cancelled: false }` for N valid items
- [ ] Deletes directory node and all descendants via fileService.deleteNode cascade (closure table enumeration)
- [ ] Skips item when user lacks write permission on the node itself; error entry has `status: 'skipped'`, reason `'permission_denied'`
- [ ] Admin user bypasses permission checks — all items processed regardless of ACL state
- [ ] Partial failure: first nodeId valid, second nodeId non-existent → returns `{ deletedCount: 1, errors: [{ nodeId: X, status: 'failed', reason: 'node_not_found' }] }`
- [ ] Empty nodeIds array → returns `{ deletedCount: 0, succeeded: [], errors: [], cancelled: false }` immediately
- [ ] `isCancelled` flipping true mid-loop: processing stops at that item, remaining items are reported `{ status: 'skipped', reason: 'cancelled' }`, `cancelled: true`, already-succeeded entries intact

### batchMove

- [ ] Moves multiple nodes to new parent successfully, updates closure table via fileService.moveNode
- [ ] Checks write permission on source node directly AND destination parent per item
- [ ] Skips item with `status: 'skipped'`, reason `'permission_denied'` when user cannot write to source or destination (same reason for both)
- [ ] Cycle detection: move rejected by fileService.moveNode → error entry with `status: 'failed'` captured, remaining moves proceed
- [ ] destinationParentNodeId as null (move to root) is a valid operation
- [ ] Succeeded entries carry `{ sourceNodeId, destinationParentNodeId, previousParentNodeId }` — the previous parent read BEFORE the item's move; the move's `fileService.moveNode` call still receives `(sourceNodeId, destinationParentNodeId, userId, user)` unchanged
- [ ] `isCancelled` flipping true mid-loop: same per-item stop semantics as batchDelete

### batchCopy

- [ ] Copies multiple files successfully, creates new file_nodes with independent blob references
- [ ] S3 mode: zero-copy when source blob exclusively owned; duplicateBlob when shared — delegated to fileService.copyFile
- [ ] WebDAV mode: downloads source content and re-uploads at destination path — delegated to fileService.copyFile
- [ ] Checks read permission on source node per item via `PERMISSIONS.READ`
- [ ] Checks write permission on destination parent per item via `PERMISSIONS.WRITE`
- [ ] Skips item with `status: 'skipped'`, reason `'permission_denied'` when user cannot read source or write to destination (same reason for both)
- [ ] Error captured with `status: 'failed'` when source has no active blob (no storage content to copy)
- [ ] Succeeded entries carry `{ sourceNodeId, destinationParentNodeId, copiedNodeId, name }` — `copiedNodeId` from the `copyFile` return value
- [ ] `isCancelled` flipping true mid-loop: same per-item stop semantics as batchDelete

### Command-unit journal & undo (worker)

- [ ] Completed move batch: exactly ONE `action_journal` row — `domain='batch'`, `subject='batch:<jobId>'`, `action='move'`, `actor=String(userId)` — with `payload.items` one move entry per succeeded item (fingerprint + move-back inverse); terminal `GET /bulk-operation/:jobId` returns `undo: { action_id }`
- [ ] Completed copy batch: one row, `action='copy'`, items carry the created node ids with position+name fingerprints
- [ ] Delete batch: no journal row, terminal `undo` is null
- [ ] Cancelled batch with a succeeded move prefix: job settles `cancelled`, the prefix is journaled and undoable
- [ ] Zero-succeeded job: no journal row, `undo: null`
- [ ] Journal-write failure (e.g., forced `commitChange` throw): job still settles with results, `undo: null`, no error state
- [ ] Undo of a clean batch: every item moved back / trashed, `items_undone = N`, `items_skipped = 0`, row `status='undone'`
- [ ] Undo after one item was moved elsewhere by hand: mixed results — `items_undone: 1, items_skipped: 1`, TX commits, changed item untouched
- [ ] Undo of a copy batch trashes the created nodes (soft delete, WebDAV remote MOVE to the trash root included); the sources are untouched
- [ ] Second undo → 409 `actions.alreadyUndone` (`routes/actions.md` semantics; executed through the `POST /api/actions/:id/undo` route)

### Cross-cutting

- [ ] No `buildSync*Checker` calls exist anywhere in the batchOperationService implementation
- [ ] All permission checks route through aclService async methods
- [ ] Job payload contains only nodeId references, no path strings
- [ ] Worker dispatcher reads job.payload and routes to correct batch method based on type field
