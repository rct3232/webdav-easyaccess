# Phase 2 Sub-Plan: Core Service Layer

## Design Decisions

| Item | Decision | Rationale |
|------|----------|-----------|
| DI pattern | Factory function + options object | Consistent with existing `createFileService`, `createBlobStore` patterns |
| DB access | Dedicated `fileNodesStore.js` intermediary layer | Separation of concerns: SQL queries vs. business logic |
| Storage scope | S3 mode only. WebDAV deferred to Phase 3 | Task 2.4 removed → scope narrowed; merged during Phase 3 fileService refactoring |
| Transaction ownership | Orchestration layer (uploadService) owns TX boundaries; service methods are TX-agnostic | Avoids nested transactions (PostgreSQL does not support nested BEGIN without savepoints) |
| Version numbering | `version_number` is always 1 in single-version mode | The `UNIQUE(file_node_id, version_number)` constraint exists for future version history expansion |

## Current State (Evidence)

### Completed Components

| Component | Location | Notes |
|-----------|----------|-------|
| DDL schema (13 tables) | `server/store/postgresql/ddl/001_initial_normalized_schema.sql` | Phase 0 complete |
| S3BlobStore (5 methods) | `infrastructure/adapters/blobstore/S3BlobStore.js` | Phase 1 complete |
| NoOpBlobStore | `infrastructure/adapters/blobstore/NoOpBlobStore.js` | WebDAV mode stub |
| BlobStore factory | `infrastructure/adapters/blobstore/index.js` | `createBlobStore()` |
| s3Mock | `server/testing/mocks/s3Mock.js` | in-memory Map-backed, Jest.fn() wrapped |
| storage.js | `server/store/storage.js` | `withTransaction` (PG), `withSqliteTransaction` (SQLite), `sqliteQuery`, `sqliteRun`, `getPgPool` |
| Metadata Adapter factory | `infrastructure/adapters/metadata/index.js` | PostgreSQL/SQLite branching |

### Unimplemented Components (Phase 2 Target)

- [ ] Application code for `file_nodes`, `object_map`, `filecache`, `node_ancestors` tables (none exists)
- [ ] `server/service/` directory (does not exist — current services live under `domains/*/services/`)
- [ ] fileNodes store layer

---

## Phase 2a: Spec & Feature Documentation (Docs-First)

**Mandatory gate:** All 6 documents below must be completed before any Phase 2b implementation begins.

| # | Document | Path | Action |
|---|----------|------|--------|
| S1 | fileNodesStore spec enhancement | `docs/spec/server/store/fileNodesStore.md` | Add object_map methods, verification scenarios |
| S2 | _ancestryHelper spec | `docs/spec/server/services/_ancestryHelper.md` | New file |
| S3 | fileNodeService spec | `docs/spec/server/services/fileNodeService.md` | New file |
| S4 | blobStorageService spec | `docs/spec/server/services/blobStorageService.md` | New file |
| S5 | uploadService spec | `docs/spec/server/services/uploadService.md` | New file |
| S6 | Core service layer feature doc | `docs/features/core-service-layer.md` | New file |

### S1: fileNodesStore Spec Enhancement

Current `fileNodesStore.md` covers file_nodes, node_ancestors, and filecache only. Add:

- **§2.2 Main Methods table** — append object_map methods (6 methods):
  - `upsertObjectMap(fileNodeId, s3Key, status)` → INSERT/UPDATE: if active row exists, mark orphaned then INSERT new pending
  - `insertObject(fileNodeId, s3Key, status)` → INSERT INTO object_map
  - `getActiveObject(fileNodeId)` → SELECT active row for node
  - `getObjectMapByS3Key(s3Key)` → SELECT by s3_key
  - `activateObject(s3Key)` → UPDATE pending→active
  - `orphanObject(s3Key)` → UPDATE active/pending→orphaned
- **§2.5 Verification Scenarios** — add object_map state transition tests:
  - pending→active→orphaned lifecycle
  - upsertObjectMap orphans previous active row before inserting new pending
  - version_number is always 1 (single-version mode)

### S2–S5: Service Spec Documents (New)

Create under `docs/spec/server/services/` following the `_TEMPLATE.md` pattern (or `selectiveDelete.md` as reference). Each document must include:

| Section | S2 (_ancestryHelper) | S3 (fileNodeService) | S4 (blobStorageService) | S5 (uploadService) |
|---------|---------------------|---------------------|------------------------|-------------------|
| Role | Closure table maintenance | Filesystem tree management | S3 blob lifecycle | Upload orchestration |
| File paths | `server/service/_ancestryHelper.js` + test | `server/service/fileNodeService.js` + test | `server/service/blobStorageService.js` + test | `server/service/uploadService.js` + test |
| Methods | `buildAncestorsForNode`, `rebuildAncestorsAfterMove`, `cleanupAncestorsForDeletion` | `createFile`, `createDirectory`, `renameNode`, `moveNode`, `deleteNode`, `listDirectory`, `getNodePath`, `resolvePath`, `getDescendantIds`, `updateSyncStatus` | `prepareUpload`, `completeUpload`, `downloadBlob`, `overwriteBlob`, `deleteBlob`, `getActiveS3Key` | `uploadFile`, `overwriteFile`, `downloadFile` |
| Dependencies | fileNodesStore | fileNodesStore, _ancestryHelper, storage | blobStore, fileNodesStore | fileNodeService, blobStorageService, blobStore, storage |
| Error cases | Cycle detection on move | Duplicate name constraint, cycle detection | No active object for download | TX failure at any step |
| Verification | Depth 0/1/N consistency after build/rebuild | TX boundary, cycle rejection, path resolution | pending→active→orphaned transitions | 4-step flow, failure recovery at 3 points |

### S6: Core Service Layer Feature Doc

Create `docs/features/core-service-layer.md` following the structure of `files-sharing.md`:

- **Overview**: Layer architecture (uploadService → fileNodeService + blobStorageService → fileNodesStore → DB)
- **Responsibility boundaries**: Which service owns what; TX boundary ownership
- **Flows**: Upload flow (4-step), overwrite flow, download flow, move flow with closure table rebuild
- **Failure recovery**: TX1 fail, S3 PUT fail, TX2 fail — DB/S3 state and recovery path
- **Testing**: Unit vs. integration split, mock strategy (s3Mock for S3, real SQLite for DB)

---

## Task Details

### Task 2.1: `fileNodesStore.js` — DB Query Layer

**Output:** `server/store/fileNodesStore.js`
**Dependencies:** None (highest priority within Phase 2)
**Estimated lines:** ~250 lines

PostgreSQL / SQLite dual-backend SQL query layer for file_nodes, object_map, filecache, node_ancestors. Uses same pattern as Metadata Adapter (`createFileNodesStore()` factory).

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | createNode for file | sync_status='pending_upload', returns { id, parentId, name, type, syncStatus } |
| V2 | createNode for directory | type='directory' |
| V3 | createNode with duplicate name under same parent | UNIQUE constraint error |
| V4 | getChildren on empty directory | Empty array |
| V5 | getChildren with filecache data | Includes size, mime_type via LEFT JOIN |
| V6 | renameNode | name updated, updated_at refreshed |
| V7 | moveNode | parent_id updated |
| V8 | deleteNodeTree with CASCADE | Node + descendants + object_map + filecache + node_ancestors all removed |
| V9 | insertAncestorRows bulk | All rows inserted with correct ancestor_id, descendant_id, depth |
| V10 | deleteAncestorByDescendant | Only target descendant rows removed |
| V11 | getDescendantIds | Returns self + all descendants |
| V12 | getAncestorChain | Returns ordered chain from root (highest depth) to self (depth=0) |
| V13 | upsertObjectMap creates pending entry | status='pending', s3_key set |
| V14 | upsertObjectMap orphans previous active | Previous active row status='orphaned' |
| V15 | activateObject pending→active | Status transition confirmed |
| V16 | orphanObject active→orphaned | Status transition confirmed |
| V17 | upsertCache inserts new row | Row exists with correct size, mime_type |
| V18 | upsertCache updates on conflict | Existing row updated, not duplicated |

#### Implementation

```javascript
function createFileNodesStore() {
  // backend = getBackend() → postgresql | sqlite

  return {
    // --- file_nodes ---
    createNode(parentId, name, type)
      // INSERT INTO file_nodes (parent_id, name, type, sync_status) VALUES (?, ?, ?, 'pending_upload')
      // PostgreSQL: RETURNING id
      // SQLite: db.lastID
      // → { id, parentId, name, type, syncStatus }

    getNode(id)
      // SELECT * FROM file_nodes WHERE id = ?
      // → row | null

    getChildren(parentId)
      // SELECT fn.*, fc.size, fc.mime_type, fc.content_hash
      //   FROM file_nodes fn
      //   LEFT JOIN filecache fc ON fc.file_node_id = fn.id
      //  WHERE fn.parent_id = ?
      //  ORDER BY fn.name
      // → row[]

    renameNode(id, newName)
      // UPDATE file_nodes SET name = ?, updated_at = NOW() WHERE id = ?
      // → { changes }

    moveNode(id, newParentId)
      // UPDATE file_nodes SET parent_id = ?, updated_at = NOW() WHERE id = ?
      // → { changes }

    deleteNodeTree(nodeIds)
      // DELETE FROM file_nodes WHERE id IN (?, ...)
      // CASCADE removes descendants + object_map + filecache + node_ancestors automatically
      // → { changes }

    updateSyncStatus(id, status)
      // UPDATE file_nodes SET sync_status = ?, updated_at = NOW() WHERE id = ?
      // → { changes }

    resolvePathSegment(parentId, name)
      // SELECT id FROM file_nodes WHERE parent_id = ? AND name = ?
      // → { id } | null

    // --- node_ancestors ---
    insertAncestorRows(rows)
      // bulk INSERT INTO node_ancestors (ancestor_id, descendant_id, depth) VALUES ...
      // rows: [{ ancestorId, descendantId, depth }]
      // → { changes }

    deleteAncestorByDescendant(descendantIds)
      // DELETE FROM node_ancestors WHERE descendant_id IN (?, ...)
      // → { changes }

    deleteAncestorByAncestor(ancestorIds)
      // DELETE FROM node_ancestors WHERE ancestor_id IN (?, ...)
      // → { changes }

    getDescendantIds(ancestorId)
      // SELECT descendant_id FROM node_ancestors WHERE ancestor_id = ?
      // → [ id, ... ]

    getAncestorChain(descendantId)
      // SELECT ancestor_id, depth FROM node_ancestors WHERE descendant_id = ? ORDER BY depth DESC
      // → [{ ancestorId, depth }, ...] — root is last

    // --- object_map ---
    upsertObjectMap(fileNodeId, s3Key, status)
      // If active row exists for fileNodeId: UPDATE SET status='orphaned'
      // INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
      //   VALUES (?, ?, 's3', 1, ?)
      // → { changes }

    insertObject(fileNodeId, s3Key, status)
      // INSERT INTO object_map (file_node_id, s3_key, storage_backend, version_number, status)
      //   VALUES (?, ?, 's3', 1, ?)
      // → { changes }

    getActiveObject(fileNodeId)
      // SELECT * FROM object_map WHERE file_node_id=? AND status='active' LIMIT 1
      // → row | null

    getObjectMapByS3Key(s3Key)
      // SELECT * FROM object_map WHERE s3_key=? AND status IN ('pending', 'active')
      // → row | null

    activateObject(s3Key)
      // UPDATE object_map SET status='active' WHERE s3_key=? AND status='pending'
      // → { changes }

    orphanObject(s3Key)
      // UPDATE object_map SET status='orphaned' WHERE s3_key=? AND status IN ('active', 'pending')
      // → { changes }

    // --- filecache ---
    upsertCache(fileNodeId, size, mimeType, contentHash)
      // INSERT INTO filecache (file_node_id, size, mime_type, content_hash, updated_at)
      //   VALUES (?, ?, ?, ?, NOW())
      // ON CONFLICT (file_node_id) DO UPDATE SET size=EXCLUDED.size, mime_type=EXCLUDED.mime_type, ...
      // → { changes }

    deleteCache(fileNodeId)
      // DELETE FROM filecache WHERE file_node_id = ?
      // → { changes }
  };
}
```

#### PostgreSQL vs SQLite Branching Strategy

| Operation | PostgreSQL | SQLite |
|-----------|-----------|--------|
| INSERT RETURNING id | `INSERT ... RETURNING id` | `INSERT ...` + `db.lastID` |
| NOW() | `NOW()` | `datetime('now')` |
| ON CONFLICT DO UPDATE | Supported | Supported (SQLite 3.24+) |
| Parameter placeholder | `$1, $2, ...` | `?` |

**Implementation pattern:** Branch via `getBackend()` or use `storage.js`'s `sqliteQuery(sql, params)` / `pgPool.query(text, values)` directly.

#### Transaction Handling

- Single-row operations (`createNode`, `renameNode`, `moveNode`): execute without explicit TX
- Batch operations (`deleteNodeTree`, bulk ancestor update): caller (fileNodeService or uploadService) wraps with `withTransaction()` / `withSqliteTransaction()`
- **No self-wrapped transactions** — TX ownership belongs to the orchestration layer only

---

### Task 2.2: `_ancestryHelper.js` — Closure Table Helper

**Output:** `server/service/_ancestryHelper.js`
**Dependencies:** Task 2.1 (`fileNodesStore`)
**Estimated lines:** ~100 lines

Closure table (`node_ancestors`) maintenance module. Called exclusively by fileNodeService, never exposed to routes.

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | buildAncestorsForNode at root (parentId=null) | Self-row only: (id, id, depth=0) |
| V2 | buildAncestorsForNode at depth 1 | Self-row + parent ancestor rows with depth+1 |
| V3 | buildAncestorsForNode at depth N | Correct ancestor chain from root to self |
| V4 | rebuildAncestorsAfterMove leaf node | All ancestor rows updated to reflect new parent chain |
| V5 | rebuildAncestorsAfterMove with subtree | All descendants' ancestor rows recomputed correctly |
| V6 | rebuildAncestorsAfterMove to root (newParentId=null) | Only self-row remains |
| V7 | cleanupAncestorsForDeletion | Descendant ancestor rows removed |

#### Implementation

```javascript
function createAncestryHelper(fileNodesStore) {
  /**
   * Build ancestor rows when inserting a node.
   * Copies all parent's ancestors + adds self (depth=0).
   */
  async function buildAncestorsForNode(nodeId, parentId) {
    if (parentId === null) {
      // Root-level node: self-reference only
      await fileNodesStore.insertAncestorRows([
        { ancestorId: nodeId, descendantId: nodeId, depth: 0 }
      ]);
      return;
    }

    const parentChain = await fileNodesStore.getAncestorChain(parentId);
    // parentChain: [{ ancestorId: X, depth: D }, ...] — includes self (depth=0) for parent

    const rows = [
      { ancestorId: nodeId, descendantId: nodeId, depth: 0 } // self
    ];
    for (const entry of parentChain) {
      rows.push({
        ancestorId: entry.ancestorId,
        descendantId: nodeId,
        depth: entry.depth + 1
      });
    }

    await fileNodesStore.insertAncestorRows(rows);
  }

  /**
   * Rebuild ancestor rows for an entire subtree after a move.
   * Strategy: delete-then-insert (simplest, correct).
   *
   * Algorithm:
   * 1. Collect all descendant IDs of moved node (including self)
   * 2. Delete all existing ancestor rows for those descendants
   * 3. Traverse the subtree via file_nodes (BFS) to compute new depths
   * 4. For each node in subtree, insert new ancestor rows based on new parent chain
   */
  async function rebuildAncestorsAfterMove(movedNodeId, newParentId) {
    // 1. Get all descendants of the moved node (includes self via depth=0 row)
    const descendantIds = await fileNodesStore.getDescendantIds(movedNodeId);

    // 2. Delete all existing ancestor rows for these descendants
    await fileNodesStore.deleteAncestorByDescendant(descendantIds);

    // 3. Get new parent's ancestor chain
    let newParentChain = [];
    if (newParentId !== null) {
      newParentChain = await fileNodesStore.getAncestorChain(newParentId);
    }
    // newParentChain: [{ ancestorId, depth }, ...] from root to newParent (depth=0 is newParent itself)

    // 4. BFS through subtree starting from movedNodeId to recompute depths
    //    For each node: its ancestors = newParentChain + movedNodeId's chain + node's position in subtree
    const allRows = [];
    const queue = [{ nodeId: movedNodeId, parentChainForParent: newParentChain }];

    while (queue.length > 0) {
      const { nodeId, parentChainForParent } = queue.shift();

      // Build ancestor rows for this node
      // self-row
      allRows.push({ ancestorId: nodeId, descendantId: nodeId, depth: 0 });
      // ancestor rows from parentChainForParent (each depth + 1)
      for (const entry of parentChainForParent) {
        allRows.push({
          ancestorId: entry.ancestorId,
          descendantId: nodeId,
          depth: entry.depth + 1
        });
      }

      // Enqueue children: get children of this node from file_nodes
      const children = await fileNodesStore.getChildren(nodeId);
      const childParentChain = [
        { ancestorId: nodeId, depth: 0 }, // self as ancestor
        ...parentChainForParent.map(e => ({ ancestorId: e.ancestorId, depth: e.depth + 1 }))
      ];
      for (const child of children) {
        queue.push({ nodeId: child.id, parentChainForParent: childParentChain });
      }
    }

    await fileNodesStore.insertAncestorRows(allRows);
  }

  /**
   * Explicit ancestor cleanup on deletion.
   * CASCADE DELETE on file_nodes handles this automatically,
   * but explicit removal serves as a safety net.
   */
  async function cleanupAncestorsForDeletion(nodeIds) {
    await fileNodesStore.deleteAncestorByDescendant(nodeIds);
  }

  return {
    buildAncestorsForNode,
    rebuildAncestorsAfterMove,
    cleanupAncestorsForDeletion
  };
}
```

#### Algorithm Detail — Move Rebuild

Move is the most complex operation:

```
Before move:                    After move (node 5 → parent 2):
1(root)                         1(root)
├── 3                          ├── 3
│   └── 4                      │   └── 4
└── 5                          └── 2
    └── 6                      │   └── 5
        └── 7                  │       └── 6
                               │           └── 7
```

**Strategy:** BFS traversal of subtree, delete-then-insert for all descendants.

1. `getDescendantIds(5)` → `[5, 6, 7]` (includes self)
2. `deleteAncestorByDescendant([5, 6, 7])` — remove all existing rows
3. Get new parent's ancestor chain: `getAncestorChain(2)` → `[{ancestorId:1, depth:1}, {ancestorId:2, depth:0}]`
4. BFS from node 5:
   - Node 5: ancestors = parentChain(2) + self → depth 0 (self), depth 1 (node 2), depth 2 (root)
   - Node 6 (child of 5): ancestors = chain(5) + self → depth 0 (self), depth 1 (5), depth 2 (2), depth 3 (root)
   - Node 7 (child of 6): ancestors = chain(6) + self → depth 0 (self), depth 1 (6), depth 2 (5), depth 3 (2), depth 4 (root)
5. `insertAncestorRows(allRows)`

**Alternative considered:** Recursive file_nodes traversal for subtree structure. BFS approach is safe even when closure table is corrupted (self-move, cycle detection edge cases).

---

### Task 2.3: `fileNodeService.js` — Tree Operations (Factory)

**Output:** `server/service/fileNodeService.js`
**Dependencies:** Task 2.1 (`fileNodesStore`), Task 2.2 (`_ancestryHelper`), `storage` (transaction helpers)
**Estimated lines:** ~150 lines

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | createFile at root (parent=null) | Node created, ancestor chain = self only (depth=0) |
| V2 | createFile at depth 1 | Ancestor chain includes parent + grandparent |
| V3 | createFile duplicate name under same parent | UNIQUE constraint error thrown |
| V4 | createDirectory | type='directory', same ancestor behavior as file |
| V5 | renameNode | name updated, ancestors unchanged |
| V6 | moveNode to new parent | Subtree ancestors rebuilt correctly |
| V7 | moveNode into own descendant | Error thrown (cycle detection) |
| V8 | moveNode to root (newParentId=null) | Only self-row remains in ancestor chain |
| V9 | deleteNode leaf | Node + ancestor rows removed |
| V10 | deleteNode directory with children | CASCADE removes entire subtree |
| V11 | listDirectory | Returns children ordered by name with filecache data |
| V12 | getNodePath root node | Returns '/' |
| V13 | getNodePath depth N | Returns '/a/b/c/file.txt' |
| V14 | resolvePath valid path | Returns correct node |
| V15 | resolvePath non-existent segment | Returns null |
| V16 | resolvePath "/" | Returns root node |

#### Implementation

```javascript
function createFileNodeService({ fileNodesStore, storage }) {
  const ancestry = createAncestryHelper(fileNodesStore);

  // Helper: select correct TX helper based on backend
  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  async function createFile(parentNodeId, name) {
    return await withTx(async () => {
      const node = await fileNodesStore.createNode(parentNodeId, name, 'file');
      await ancestry.buildAncestorsForNode(node.id, parentNodeId);
      return node;
    });
  }

  async function createDirectory(parentNodeId, name) {
    return await withTx(async () => {
      const node = await fileNodesStore.createNode(parentNodeId, name, 'directory');
      await ancestry.buildAncestorsForNode(node.id, parentNodeId);
      return node;
    });
  }

  async function renameNode(nodeId, newName) {
    // No ancestor change — just name update
    await fileNodesStore.renameNode(nodeId, newName);
  }

  async function moveNode(nodeId, newParentId) {
    // Cycle detection: cannot move a node into its own descendant
    const descendants = await fileNodesStore.getDescendantIds(nodeId);
    if (descendants.includes(newParentId)) {
      throw new Error('Cannot move node into its own descendant');
    }

    return await withTx(async () => {
      await fileNodesStore.moveNode(nodeId, newParentId);
      await ancestry.rebuildAncestorsAfterMove(nodeId, newParentId);
    });
  }

  async function deleteNode(nodeId) {
    const descendantIds = await fileNodesStore.getDescendantIds(nodeId);
    return await withTx(async () => {
      // Explicit cleanup as safety net (CASCADE handles this via FK constraints)
      await ancestry.cleanupAncestorsForDeletion(descendantIds);
      await fileNodesStore.deleteNodeTree(descendantIds);
      // CASCADE handles: object_map, filecache, node_ancestors FK rows
    });
  }

  async function listDirectory(parentNodeId) {
    return await fileNodesStore.getChildren(parentNodeId);
  }

  async function getNodePath(nodeId) {
    const chain = await fileNodesStore.getAncestorChain(nodeId);
    // chain: [{ ancestorId: root, depth: N }, ..., { ancestorId: self, depth: 0 }]
    // Reverse to get root→self order, then fetch names
    const pathParts = [];
    for (const entry of [...chain].reverse()) {
      const node = await fileNodesStore.getNode(entry.ancestorId);
      pathParts.push(node.name);
    }
    return '/' + pathParts.join('/');
  }

  async function resolvePath(pathString) {
    // "/" → root directory lookup (parent_id IS NULL)
    // "/foo/bar" → sequential: find 'foo' under root, then 'bar' under 'foo'
    const segments = pathString.split('/').filter(Boolean);
    let currentParentId = null;

    for (const segment of segments) {
      const result = await fileNodesStore.resolvePathSegment(currentParentId, segment);
      if (!result) return null;
      currentParentId = result.id;
    }

    return await fileNodesStore.getNode(currentParentId);
  }

  async function getDescendantIds(nodeId) {
    return await fileNodesStore.getDescendantIds(nodeId);
  }

  async function updateSyncStatus(nodeId, status) {
    await fileNodesStore.updateSyncStatus(nodeId, status);
  }

  return {
    createFile,
    createDirectory,
    renameNode,
    moveNode,
    deleteNode,
    listDirectory,
    getNodePath,
    resolvePath,
    getDescendantIds,
    updateSyncStatus
  };
}
```

#### Cycle Detection

`moveNode` requires cycle detection:
- `getDescendantIds(nodeId)` returns all descendants; if `newParentId` is in that set, reject the move
- Performance: closure table lookup is O(1) via index scan

---

### Task 2.4: `blobStorageService.js` — Blob Lifecycle (S3 Only)

**Output:** `server/service/blobStorageService.js`
**Dependencies:** Phase 1 (`createBlobStore()`), Task 2.1 (`fileNodesStore`)
**Estimated lines:** ~120 lines

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | prepareUpload creates pending entry | object_map row with status='pending', valid UUID s3Key |
| V2 | prepareUpload orphans previous active | Previous active row marked orphaned |
| V3 | completeUpload transitions pending→active | Status updated to 'active' |
| V4 | completeUpload creates filecache row | filecache row with correct size and mime_type |
| V5 | downloadBlob with active object | Returns buffer matching uploaded content |
| V6 | downloadBlob with no active object | Returns null |
| V7 | overwriteBlob orphans old key | Old s3_key marked orphaned |
| V8 | overwriteBlob creates new active mapping | New s3_key active, file_node_id preserved |
| V9 | deleteBlob marks orphaned | Active object marked orphaned (S3 deletion deferred to GC) |
| V10 | deleteBlob no active object | No-op, no error |

#### Implementation

```javascript
function createBlobStorageService({ blobStore, fileNodesStore }) {
  const crypto = require('crypto');

  async function prepareUpload(fileNodeId) {
    const s3Key = crypto.randomUUID();
    // Upsert: orphan existing active row, then INSERT new pending
    await fileNodesStore.upsertObjectMap(fileNodeId, s3Key, 'pending');
    return s3Key;
  }

  async function completeUpload(s3Key, size, mimeType) {
    const row = await fileNodesStore.getObjectMapByS3Key(s3Key);
    if (!row) throw new Error(`No object_map entry found for s3Key: ${s3Key}`);
    await fileNodesStore.activateObject(s3Key);
    await fileNodesStore.upsertCache(row.file_node_id, size, mimeType, null);
  }

  async function downloadBlob(fileNodeId) {
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    if (!row || !row.s3_key) return null;
    return await blobStore.downloadBlob(row.s3_key);
  }

  async function overwriteBlob(fileNodeId, buffer) {
    // 1. Mark current active s3_key as orphaned
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
    }

    // 2. Upload new blob to S3
    const newS3Key = crypto.randomUUID();
    await blobStore.uploadBlob(newS3Key, buffer);

    // 3. Create new object_map entry → active
    await fileNodesStore.insertObject(fileNodeId, newS3Key, 'active');

    return newS3Key;
  }

  async function deleteBlob(fileNodeId) {
    const current = await fileNodesStore.getActiveObject(fileNodeId);
    if (current && current.s3_key) {
      await fileNodesStore.orphanObject(current.s3_key);
      // Actual S3 deletion deferred to GC service (Phase 6)
    }
  }

  async function getActiveS3Key(fileNodeId) {
    const row = await fileNodesStore.getActiveObject(fileNodeId);
    return row ? row.s3_key : null;
  }

  return {
    prepareUpload,
    completeUpload,
    downloadBlob,
    overwriteBlob,
    deleteBlob,
    getActiveS3Key
  };
}
```

#### Version Number Policy

Single-version mode: `version_number` is always 1. The `UNIQUE(file_node_id, version_number)` constraint in the DDL exists for future version history expansion. `upsertObjectMap` orphans the previous active row and inserts a new row with `version_number=1`.

---

### Task 2.5: `uploadService.js` — Orchestration

**Output:** `server/service/uploadService.js`
**Dependencies:** Task 2.3 (`fileNodeService`), Task 2.4 (`blobStorageService`)
**Estimated lines:** ~100 lines

#### Verification Scenarios (write tests first)

| # | Scenario | Expected Result |
|---|----------|-----------------|
| V1 | uploadFile success | Node created → pending → active; S3 blob uploaded; filecache populated |
| V2 | uploadFile TX1 failure | ROLLBACK; nothing persisted in DB or S3 |
| V3 | uploadFile S3 PUT failure | object_map='pending' in DB; no blob in S3; recoverable |
| V4 | uploadFile TX2 failure | object_map='pending'; sync_status='pending_upload'; blob in S3; GC Tier 2 recoverable |
| V5 | overwriteFile success | Old key orphaned, new key active, filecache updated |
| V6 | overwriteFile TX1 failure | ROLLBACK; original state preserved |
| V7 | downloadFile success | Returns buffer matching uploaded content |
| V8 | downloadFile non-existent node | Returns null |

#### Implementation

```javascript
function createUploadService({ fileNodeService, blobStorageService, blobStore, storage }) {
  // Helper: select correct TX helper based on backend
  function withTx(callback) {
    const backend = storage.getBackend();
    if (backend === 'sqlite') {
      return storage.withSqliteTransaction(callback);
    }
    return storage.withTransaction(callback);
  }

  /**
   * Upload flow (synchronous, 4-step):
   *
   * TX1: DB INSERT (file_nodes + object_map)
   * S3 PUT: external call (outside TX)
   * TX2: DB UPDATE (object_map active + filecache + sync_status active)
   */
  async function uploadFile(parentNodeId, name, buffer, mimeType) {
    // === TX1: Create node + prepare blob mapping ===
    let nodeId, s3Key;
    await withTx(async () => {
      const node = await fileNodeService.createFile(parentNodeId, name);
      nodeId = node.id;
      s3Key = await blobStorageService.prepareUpload(nodeId);
    });

    // === S3 PUT: Outside transaction ===
    await blobStore.uploadBlob(s3Key, buffer);

    // === TX2: Finalize ===
    await withTx(async () => {
      const contentLength = buffer.length;
      await blobStorageService.completeUpload(s3Key, contentLength, mimeType);
      await fileNodeService.updateSyncStatus(nodeId, 'active');
    });

    return { nodeId, s3Key, size: buffer.length, mimeType };
  }

  /**
   * Overwrite existing file's content.
   */
  async function overwriteFile(fileNodeId, buffer, mimeType) {
    // === TX1: Prepare new version ===
    let s3Key;
    await withTx(async () => {
      s3Key = await blobStorageService.prepareUpload(fileNodeId);
      await fileNodeService.updateSyncStatus(fileNodeId, 'pending_upload');
    });

    // === S3 PUT ===
    await blobStore.uploadBlob(s3Key, buffer);

    // === TX2: Finalize ===
    await withTx(async () => {
      const contentLength = buffer.length;
      await blobStorageService.completeUpload(s3Key, contentLength, mimeType);
      await fileNodeService.updateSyncStatus(fileNodeId, 'active');
    });

    return { nodeId: fileNodeId, s3Key, size: buffer.length, mimeType };
  }

  /**
   * Download file content.
   */
  async function downloadFile(fileNodeId) {
    return await blobStorageService.downloadBlob(fileNodeId);
  }

  return {
    uploadFile,
    overwriteFile,
    downloadFile
  };
}
```

#### Failure Scenarios and Recovery States

| Failure Point | DB State | S3 State | Recovery |
|---------------|----------|----------|----------|
| TX1 fails | ROLLBACK → nothing | Nothing | Idempotent retry |
| S3 PUT fails | object_map='pending' | Nothing | Retry endpoint or GC Tier 1 |
| TX2 fails | object_map='pending'; sync_status='pending_upload' | Blob uploaded | Tier 2 GC (listOrphanedKeys) cleans untracked blob |

---

## Task Execution Order and Parallelization

### Execution Graph

```
Phase 2a (Docs-First):
  [S1 fileNodesStore spec] ──▶ [S2 _ancestryHelper spec] ──┐
                                                             ├─▶ [S6 feature doc]
  [S3 fileNodeService spec] ──▶ [S4 blobStorageService spec] ┘
  [S5 uploadService spec] ──────────────────────────────────┘

Phase 2b (Implementation):
  [2.1 fileNodesStore] ──▶ [2.2 _ancestryHelper] ──▶ [2.3 fileNodeService] ─┐
                                                                             ├─▶ [2.5 uploadService]
  [2.4 blobStorageService] (independent, starts after Phase 1) ──────────────┘

Phase 2c (Tests — TDD: test files created alongside or immediately after each implementation task):
  [2.6 fileNodesStore.test] [2.7 fileNodeService.test] [2.8 blobStorageService.test] [2.9 uploadService.test]
```

### Parallelization Strategy

| Batch | Tasks | Notes |
|-------|-------|-------|
| **Phase 2a** | S1–S5 (spec docs) | Can be written in parallel; S6 (feature doc) depends on S1–S5 |
| **Phase 2a Gate** | All spec docs complete | **Mandatory checkpoint before Phase 2b** |
| **Batch A** | 2.1 (fileNodesStore) + 2.4 (blobStorageService) | Independent, start simultaneously |
| **Batch B** | 2.2 (_ancestryHelper) | After 2.1 completes |
| **Batch C** | 2.3 (fileNodeService) | After 2.2 completes |
| **Batch D** | 2.5 (uploadService) | After both 2.3 and 2.4 complete |
| **Batch E** | Tests 2.6–2.9 | Written alongside each implementation task (TDD) |

### Recommended Execution Order

1. **S1–S5** Write all spec documents (Phase 2a)
2. **S6** Write feature doc (Phase 2a)
3. **2.1** fileNodesStore — DB query layer (foundation for all tasks)
4. **2.6** fileNodesStore.test.js — Store layer verification (early feedback)
5. **2.4** blobStorageService — S3 lifecycle (independent of 2.2/2.3)
6. **2.8** blobStorageService.test.js — S3 lifecycle verification
7. **2.2** _ancestryHelper — closure table maintenance
8. **2.3** fileNodeService — tree operations
9. **2.7** fileNodeService.test.js — closure table consistency verification
10. **2.5** uploadService — orchestration
11. **2.9** uploadService.test.js — integration test + failure scenarios

---

## File Creation List

| File | Type | Estimated Lines |
|------|------|-----------------|
| `docs/spec/server/store/fileNodesStore.md` | Spec (update) | — |
| `docs/spec/server/services/_ancestryHelper.md` | Spec (new) | ~60 |
| `docs/spec/server/services/fileNodeService.md` | Spec (new) | ~60 |
| `docs/spec/server/services/blobStorageService.md` | Spec (new) | ~60 |
| `docs/spec/server/services/uploadService.md` | Spec (new) | ~60 |
| `docs/features/core-service-layer.md` | Feature doc (new) | ~120 |
| `server/store/fileNodesStore.js` | Implementation | ~250 |
| `server/service/_ancestryHelper.js` | Implementation | ~100 |
| `server/service/fileNodeService.js` | Implementation | ~150 |
| `server/service/blobStorageService.js` | Implementation | ~120 |
| `server/service/uploadService.js` | Implementation | ~100 |
| `server/store/__tests__/fileNodesStore.test.js` | Test | ~150 |
| `server/service/__tests__/fileNodeService.test.js` | Test | ~200 |
| `server/service/__tests__/blobStorageService.test.js` | Test | ~150 |
| `server/service/__tests__/uploadService.test.js` | Test | ~180 |
| **Total** | | **~1,660 lines** |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Closure table inconsistency (ancestor rows missing after move) | High | BFS-based delete-then-insert strategy; tests verify depth 0/1/N |
| TX1 success + S3 failure leaves pending state | Medium | status='pending' row is Phase 6 GC Tier 1 target |
| TX2 failure: blob in S3 but DB not updated | Low | Tier 2 GC (listOrphanedKeys) cleans untracked blob |
| SQLite does not support RETURNING clause | High | Branch on `db.lastID` after INSERT |
| Cycle detection missing (infinite recursion on move) | Critical | getDescendantIds → newParentId membership check in moveNode |
| Nested transactions | High | TX ownership at orchestration layer only; service methods use withTx helper that dispatches to correct backend TX function |

---

## Items Deferred to Phase 3

The following tasks are excluded from Phase 2 and deferred to Phase 3 (Files Domain Integration):

- **WebDAV mode in services** — `blobStorageService` WebDAV storage support
- **fileService.js refactoring** — Replace direct WebDAV calls with service layer
- **Route updates** (`crud.js`, `batch.js`, etc.) — Accept nodeId-based payloads

---

## Success Criteria

| Verification Item | Command | Expected Result |
|-------------------|---------|-----------------|
| Spec documents exist | `ls docs/spec/server/services/{_ancestryHelper,fileNodeService,blobStorageService,uploadService}.md` | All 4 files exist |
| fileNodesStore spec enhanced | `grep "object_map" docs/spec/server/store/fileNodesStore.md` | object_map methods listed (6 methods) |
| Feature doc exists | `ls docs/features/core-service-layer.md` | File exists |
| Verification scenarios precede implementation | Structural check: each task section has "Verification Scenarios" before "Implementation" | Consistent across all tasks |
| fileNodesStore unit tests | `npm run test -w server -- --testPathPattern="fileNodesStore"` | All pass |
| fileNodeService tests (closure table) | `npm run test -w server -- --testPathPattern="fileNodeService"` | depth 0/1/N consistency verified |
| blobStorageService tests | `npm run test -w server -- --testPathPattern="blobStorageService"` | pending→active→orphaned transitions verified |
| uploadService integration tests | `npm run test -w server -- --testPathPattern="uploadService"` | 4-step flow + failure scenarios all pass |
| Full Phase 2 tests | `npm run test -w server -- --testPathPattern="service/__tests__\|store/__tests__/fileNodesStore"` | All pass, no regression |
