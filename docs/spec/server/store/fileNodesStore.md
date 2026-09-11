# fileNodesStore Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                                                                                                                                                                                           |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Filesystem tree management via `file_nodes`, `object_map`, `filecache`, `node_ancestors`. Provides inode-equivalent filesystem hierarchy with node_id-based references, multi-backend blob mapping, and closure-table ancestry tracking. Node rows are domain-shaped (`{ id, parentId, name, type, syncStatus, createdAt, updatedAt, deletedAt }` — `deletedAt` mirrors `file_nodes.deleted_at`, NULL for live rows). Filecache-joined reads (`getNode`, `getChildren`, `getTrashChildren`, `getTopmostTrashedNodes`) additionally carry `size` (number, coerced) and `mimeType` when the joined `filecache` columns are present. |

---

## 2. Implementation Spec

> **Layering:** `server/store/fileNodesStore.js` is a facade — it contains no SQL and forwards
> each method unchanged (facade parity) to `server/store/repositories/FileNodeRepository.js`,
> built over `storage.getExecutor()`. The dialect SQL lives in the repository twins
> (`server/store/repositories/sqlite/FileNodeRepository.sqlite.js` /
> `server/store/repositories/postgres/FileNodeRepository.postgres.js`); the SQL patterns listed
> throughout this spec are the ones those implementations execute. Conformance:
> `server/store/repositories/__tests__/FileNodeRepository.conformance.test.js` (real sqlite in
> `test:ci`, real PostgreSQL on the `test:ci:pg:adapters` leg).

### 2.1 Tables

| Table            | Purpose                                                                                                                                                                                                                                                                      |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_nodes`     | Inode equivalent — self-referencing FK tree for filesystem hierarchy. Directories exist only as DB rows; S3 remains flat. Carries `deleted_at TIMESTAMPTZ NULL` (trash marker; NULL = live).                                                                                 |
| `object_map`     | Node-to-blob mapping with managed per-node version history (`version_number` + `status IN ('pending','active','history','orphaned')`; DEF-11).                                                                                                                               |
| `filecache`      | Metadata cache — size, mime_type, content_hash. Written on upload completion. PK is FK to file_nodes.                                                                                                                                                                        |
| `node_ancestors` | Closure table for permission inheritance and bulk descendant queries. Maintained at application level via the `_ancestryHelper` module (`server/service/_ancestryHelper.js`). No DB triggers (SQLite compatibility). Self-referential `depth=0` row included for every node. |

### 2.2 DDL Source of Truth

Canonical table definitions, constraints, and indexes are in the ordered DDL chain:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql` (the single DDL file — carries the
  whole normalized schema including `file_nodes.deleted_at` and the partial unique indexes over
  `deleted_at IS NULL`)

This spec does not duplicate full DDL text.

**Name-uniqueness contract (`file_nodes`):**

- Live nodes (`deleted_at IS NULL`) enforce unique names per parent: a partial unique index over
  `(parent_id, name) WHERE deleted_at IS NULL` (and the root variant over
  `(name) WHERE parent_id IS NULL AND deleted_at IS NULL`). Violations surface as unique-violation
  errors (PG `23505` / sqlite constraint failure) on `createNode`/`renameNode`/`moveNode`.
- Trashed nodes (`deleted_at` set) are **exempt from live uniqueness**: multiple trashed siblings
  may share a name, and a trashed row may share a name with a live sibling. Uniqueness is carried
  by the partial unique indexes alone — there is no table-level `UNIQUE (parent_id, name)`
  constraint.
- `deleted_at` defaults to NULL; soft-delete marking is `markSubtreeDeleted` (P2), the restore
  cycle (clearing `deleted_at`) and purge (`deleteNodeTree`) belong to the orchestration layer.

### 2.3 Maintenance Strategy

- **Closure table (`node_ancestors`)**: Maintained by the `_ancestryHelper` module — `server/service/_ancestryHelper.js`, `createAncestryHelper(fileNodesStore)` → `buildAncestorsForNode(nodeId, parentId)` / `rebuildAncestorsAfterMove(nodeId, newParentId)` / `cleanupAncestorsForDeletion(nodeIds)` (consumed only by `fileNodeService`). These call the store methods `insertAncestorRows`, `deleteAncestorByDescendant`. No DB triggers for SQLite compatibility.
- **Self-referential row**: Every node has a `(ancestor_id = id, descendant_id = id, depth = 0)` entry.
- **CASCADE semantics**: `ON DELETE CASCADE` on all FK references to `file_nodes(id)`. When a file*node is deleted, corresponding rows in object_map, filecache, permissions*\*, share_links, recent_files are auto-removed.

### 2.4 Main Methods

#### file_nodes Methods

**Trash gating (DEF-16 P4):** `getNode`, `getChildren` and `resolvePathSegment` are
**live-row reads** — every one carries `AND deleted_at IS NULL`, so a trashed row is
invisible to every caller of these methods (listings, metadata, ancestors, stats,
thumbnails, share-public download, zip/download-multiple, conflict checks, upload/rename/
create sibling checks, resolve-path). `getNodeIncludingTrashed` is the explicit
trash-aware read for the channels that must still see trashed rows (path resolution for
the trash listing, restore/purge and permanent delete).
`getDescendantIds` / `getDescendants` / `getAncestorChain` stay **UNFILTERED** — the full
trashed subtree remains visible to trash/purge/restore logic.

| Method                                   | SQL Pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Returns                                    |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `createNode(parentId, name, type)`       | INSERT with sync_status='pending_upload'; RETURNING id (PG) or lastID (SQLite)                                                                                                                                                                                                                                                                                                                                                                                                                 | `{ id, parentId, name, type, syncStatus }` |
| `getNode(id)`                            | SELECT fn.\*, fc.size, fc.mime_type FROM file_nodes fn LEFT JOIN filecache fc ON fc.file_node_id = fn.id WHERE fn.id=? **AND fn.deleted_at IS NULL** (live rows only — trashed → null; carries `size`/`mimeType` when a cache row exists)                                                                                                                                                                                            | row \| null                                |
| `getNodeIncludingTrashed(id)`            | SELECT \* FROM file_nodes WHERE id=? (no trash filter; trash-aware read)                                                                                                                                                                                                                                                                                                                                                                                                                       | row \| null                                |
| `getChildren(parentId)`                  | LEFT JOIN with filecache for size/mime_type/content_hash; **AND fn.deleted_at IS NULL**; ORDER BY name (trashed children excluded)                                                                                                                                                                                                                                                                                                                                                             | `row[]`                                    |
| `getTrashChildren(parentId)`             | SELECT fn.\*, fc.size, fc.mime_type FROM file_nodes fn LEFT JOIN filecache fc ... WHERE fn.parent_id=? **AND fn.deleted_at IS NOT NULL** ORDER BY name (the trashed children of a live-or-trashed parent; hierarchical trash view — carries `size`/`mimeType`)                                                                                                                                                                                                                             | `row[]` (mapped rows incl. `deletedAt`)    |
| `getTopmostTrashedNodes(olderThanDays?)` | SELECT fn.\*, fc.size, fc.mime_type FROM file_nodes fn LEFT JOIN file_nodes p ON p.id = fn.parent_id LEFT JOIN filecache fc ON fc.file_node_id = fn.id WHERE fn.deleted_at IS NOT NULL AND (fn.parent_id IS NULL OR p.deleted_at IS NULL) — and when `olderThanDays` is given `AND fn.deleted_at < cutoff` — ORDER BY fn.deleted_at DESC, fn.name. TOPMOST trashed rows only (parent live-or-NULL): the trash listing's root level and the GC Tier 3 / empty-trash enumeration; trashed children of a trashed parent are NOT returned (they die with their root's subtree). Carries `size`/`mimeType` | `row[]` (mapped rows incl. `deletedAt`)    |
| `markSubtreeDeleted(nodeIds)`            | UPDATE file_nodes SET deleted_at=NOW()/datetime('now') WHERE id IN (...) (every-row soft delete over the subtree; idempotent in effect — re-running re-marks matched rows, `changes` reports MATCHED rows; no updated_at touch)                                                                                                                                                                                                                                                                | `{ changes }` (rows marked)                |
| `untrashSubtree(nodeIds)`                | UPDATE file_nodes SET deleted_at=NULL WHERE id IN (...) (restore primitive: clears the mark on every given row — chain nodes + target subtree; the partial `(parent_id,name)` unique index re-enrolls each live row)                                                                                                                                                                                                                                                                           | `{ changes }` (rows untrashed)             |
| `renameNode(id, newName)`                | UPDATE SET name=?, updated_at=NOW()                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `{ changes }`                              |
| `moveNode(id, newParentId)`              | UPDATE SET parent_id=?, updated_at=NOW()                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `{ changes }`                              |
| `deleteNodeTree(nodeIds)`                | DELETE WHERE id IN (...); CASCADE handles descendants + object_map + filecache + node_ancestors                                                                                                                                                                                                                                                                                                                                                                                                | `{ changes }`                              |
| `updateSyncStatus(id, status)`           | UPDATE SET sync_status=?, updated_at=NOW()                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `{ changes }`                              |
| `resolvePathSegment(parentId, name)`     | SELECT id WHERE parent_id=? AND name=? **AND deleted_at IS NULL** (trashed names do not resolve)                                                                                                                                                                                                                                                                                                                                                                                               | `{ id }` \| null                           |
| `getUserRootNode(userId)`                | Look up user by id (userStore), then SELECT \* WHERE parent_id IS NULL AND name=<username> LIMIT 1                                                                                                                                                                                                                                                                                                                                                                                             | node row \| null (the user's home node)    |

#### node_ancestors Methods

| Method                                      | SQL Pattern                                                                                       | Returns                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `insertAncestorRows(rows)`                  | Bulk INSERT INTO node_ancestors; rows: `[{ ancestorId, descendantId, depth }]`                    | `{ changes }`                                        |
| `deleteAncestorByDescendant(descendantIds)` | DELETE WHERE descendant_id IN (...)                                                               | `{ changes }`                                        |
| `getDescendantIds(ancestorId)`              | SELECT descendant_id WHERE ancestor_id=?                                                          | `[id, ...]`                                          |
| `getDescendants(ancestorId)`                | SELECT n.\* FROM file_nodes n JOIN node_ancestors a ON a.descendant_id=n.id WHERE a.ancestor_id=? | descendant node rows `row[]` (mapped like `getNode`) |
| `isAncestor(ancestorId, descendantId)`      | SELECT 1 FROM node_ancestors WHERE ancestor_id=? AND descendant_id=? LIMIT 1                      | boolean (true if a closure row exists)               |
| `getAncestorChain(descendantId)`            | SELECT ancestor_id, depth WHERE descendant_id=? ORDER BY depth DESC                               | `[{ ancestorId, depth }, ...]` — root is last entry  |

#### object_map Methods

| Method                                       | SQL Pattern                                                                                                                                                                                                                                                                                                                    | Returns       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| `upsertObjectMap(fileNodeId, s3Key, status)` | If active row exists for fileNodeId: UPDATE SET status='history' (managed prior version, DEF-11). Then INSERT INTO object_map (file_node_id, s3_key, storage_backend='s3', version_number=COALESCE(MAX(version_number),0)+1, status) — version_number increments per node on every upsert (prior versions become history rows) | `{ changes }` |
| `insertObject(fileNodeId, s3Key, status)`    | INSERT INTO object_map                                                                                                                                                                                                                                                                                                         | `{ changes }` |
| `getActiveObject(fileNodeId)`                | SELECT \* WHERE file_node_id=? AND status='active' LIMIT 1                                                                                                                                                                                                                                                                     | row \| null   |
| `getObjectMapByNode(fileNodeId)`             | SELECT \* WHERE file_node_id=? ORDER BY version_number DESC, id DESC (all statuses; no age filter — safe for freshly seeded rows). Note: the **browse** read model is `getVersionsByNode` (active+history only) — this method stays the repair/scan surface that also returns `pending`/`orphaned` rows                        | rows[]        |
| `getObjectMapBySubtree(ancestorId)`          | SELECT om.\* FROM object_map om JOIN node_ancestors a ON a.descendant_id = om.file_node_id WHERE a.ancestor_id=? (every object_map row of a subtree — active + history + orphaned + pending; purge core enumerates all blob keys of a trashed subtree in one query)                                                            | rows[]        |
| `getVersionsByNode(fileNodeId)`              | SELECT \* WHERE file_node_id=? AND status IN ('active','history') ORDER BY version_number DESC (excludes `pending` + `orphaned`)                                                                                                                                                                                               | rows[]        |
| `getObjectMapByS3Key(s3Key)`                 | SELECT \* WHERE s3_key=? AND status IN ('pending', 'active')                                                                                                                                                                                                                                                                   | row \| null   |
| `activateObject(s3Key)`                      | UPDATE SET status='active' WHERE s3_key=? AND status='pending'                                                                                                                                                                                                                                                                 | `{ changes }` |
| `orphanObject(s3Key)`                        | UPDATE SET status='orphaned' WHERE s3_key=? AND status IN ('active', 'pending')                                                                                                                                                                                                                                                | `{ changes }` |
| `demoteActiveToHistory(s3Key)`               | UPDATE SET status='history' WHERE s3_key=? AND status='active' (restore TX primitive: the demoted current version becomes `history`, not `orphaned`)                                                                                                                                                                           | `{ changes }` |
| `reactivateObjectMapRow(id)`                 | UPDATE object_map SET status='active' WHERE id=? AND status IN ('history','orphaned') (guard widened by DEF-11 — a `history` row reactivates in place on restore/rollback)                                                                                                                                                     | `{ changes }` |
| `evictVersionsBeyondCap(fileNodeId, cap)`    | While `active + history > cap` (single UPDATE, oldest-first by `version_number` ASC): demote oldest `history` rows to `'orphaned'`. `cap <= 0` = unbounded → no-op. The `active` row is never touched                                                                                                                          | `{ changes }` |
| `countActiveObjectsByS3Key(s3Key)`           | SELECT COUNT(\*) WHERE s3_key=? AND status='active'                                                                                                                                                                                                                                                                            | `number`      |
| `setObjectMapBackendWebdav(fileNodeId)`      | UPDATE object_map SET storage_backend='webdav' WHERE file_node_id=? AND status='active'                                                                                                                                                                                                                                        | `{ changes }` |

#### GC support methods (Phase 6)

| Method                                           | SQL Pattern                                                                                                                           | Returns                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| `getOrphanedObjectsWithNodeState(olderThanDays)` | Orphaned rows older than cutoff, LEFT JOIN file_nodes (node sync status) + EXISTS active-row subquery                                 | rows[] annotated with `node_sync_status` and `has_active` |
| `getStalePendingObjects(staleThanDays)`          | SELECT \* WHERE status='pending' AND created_at < cutoff AND node sync_status='pending_upload'                                        | rows[]                                                    |
| `getKeptS3Keys()`                                | UNION of active ∪ history ∪ orphaned (evicted version) ∪ pending-on-pending_upload-node `s3_key` values; no trash arm, no age filters | string[]                                                  |
| `deleteObjectMapRows(ids)`                       | DELETE WHERE id IN (...); SQLite branch per-row via `executor.run` in `FileNodeRepository.sqlite.js`                                  | `{ changes }`                                             |
| `getNodesBySyncStatus(status)`                   | SELECT \* FROM file_nodes WHERE sync_status=?                                                                                         | mapped rows[]                                             |
| `getNodesBySyncStatusNot(status)`                | SELECT \* FROM file_nodes WHERE sync_status != ?                                                                                      | mapped rows[]                                             |

#### filecache Methods

| Method                                                 | SQL Pattern                            | Returns       |
| ------------------------------------------------------ | -------------------------------------- | ------------- |
| `upsertCache(fileNodeId, size, mimeType, contentHash)` | INSERT ON CONFLICT DO UPDATE           | `{ changes }` |
| `getCache(fileNodeId)`                                 | SELECT \* WHERE file_node_id=? LIMIT 1 | row \| null   |

### 2.5 PostgreSQL vs SQLite Branching

These dialect differences live in the repository implementations behind the executor seam —
`server/store/repositories/sqlite/FileNodeRepository.sqlite.js` / `server/store/repositories/postgres/FileNodeRepository.postgres.js` —
not in the facade, which executes no SQL. The `RETURNING`/`lastID`, `NOW()`/`datetime('now')`
and placeholder markers shown across the method tables in §2.4 are the same dialect twins' work.

| Operation             | PostgreSQL                | SQLite                   |
| --------------------- | ------------------------- | ------------------------ |
| INSERT RETURNING id   | `INSERT ... RETURNING id` | `INSERT` + `db.lastID`   |
| NOW()                 | `NOW()`                   | `datetime('now')`        |
| ON CONFLICT DO UPDATE | Supported                 | Supported (SQLite 3.24+) |
| Parameter placeholder | `$1, $2, ...`             | `?`                      |

### 2.6 Transaction Handling

- **Single-row operations** (`createNode`, `renameNode`, `moveNode`): execute without explicit TX
- **Batch operations** (`deleteNodeTree`, bulk ancestor update): caller wraps with `withTransaction()` / `withSqliteTransaction()`
- **No self-wrapped transactions** — TX ownership belongs to the orchestration layer only

### 2.7 Verification Scenarios

- [ ] Tree operations (create/move/delete/rename) maintain closure table correctness
- [ ] Name uniqueness: a live duplicate `(parent_id, name)` insert is rejected; two trashed siblings (both `deleted_at` set) with the same name coexist; a trashed row and a live row with the same name coexist; the root variant (`parent_id IS NULL`) behaves identically; `deleted_at` defaults to NULL on insert
- [ ] CASCADE deletes propagate properly across all dependent tables
- [ ] Self-referencing `file_nodes.parent_id` FK works on both PostgreSQL and SQLite with deferred foreign keys
- [ ] object_map pending→active→history→orphaned lifecycle transitions work correctly
- [ ] upsertObjectMap demotes the previous active row to `history` before inserting new pending
- [ ] version_number increments per node on every upsertObjectMap (1, 2, 3, ... on repeated overwrites; prior versions become history rows)
- [ ] reactivateObjectMapRow flips a single `history` **or** `orphaned` row back to active (guarded by `status IN ('history','orphaned')`); a `pending`/`active` row is left untouched and `{ changes }` is 0
- [ ] demoteActiveToHistory flips only the active row with the given s3_key to `history`; non-active rows are untouched
- [ ] evictVersionsBeyondCap: demotes the oldest `history` rows (version_number ASC) to `orphaned` while `active + history > cap`; `cap=0` is a no-op (unbounded); the `active` row is never touched
- [ ] getVersionsByNode returns only `active` + `history` rows newest-version first; `pending` and `orphaned` rows are excluded
- [ ] getKeptS3Keys UNION membership: active keys, history keys, orphaned keys, and pending keys on `pending_upload` nodes are all returned; pending keys on other node states are excluded; a **trashed node's active key stays in the keep-set** (the active arm is not trash-filtered — Tier 2 must never reclaim trashed content)
- [ ] Trash gating: `getNode(trashedId)` returns null and `getNodeIncludingTrashed(trashedId)` returns the row with `deletedAt` set; a trashed child is absent from `getChildren(parent)` and from `getChildren(null)` at root level while `getTrashChildren(parent)` returns exactly the trashed siblings; `resolvePathSegment(parent, trashedName)` returns null
- [ ] markSubtreeDeleted marks every row of the id list (`changes` = matched rows); re-running re-marks the same matched rows without corrupting state; restore cycle: clearing `deleted_at` (restore path) re-enrolls the row in live uniqueness — the restore UPDATE is REJECTED while a live same-name sibling exists (the collision the restore flow resolves via a name suffix), succeeds with no sibling, and re-trashing releases uniqueness again
- [ ] getTrashChildren(null) returns trashed root-level rows
- [ ] getTopmostTrashedNodes returns only topmost trashed rows (parent live-or-NULL): a trashed child inside a trashed parent is excluded, a trashed child of a LIVE parent is included; the optional `olderThanDays` filter keeps fresh rows out and passes expired ones; ordering is newest-deleted first
- [ ] untrashSubtree clears `deleted_at` on every given row (`changes` = rows cleared); a live row in the list is untouched; after untrash the row re-enrolls in live uniqueness (`getChildren`/`resolvePathSegment` see it again)
- [ ] getDescendantIds / getAncestorChain remain UNFILTERED across a trash boundary: a trashed subtree is still fully enumerable by descendant/ancestor queries
- [ ] getObjectMapBySubtree returns every object_map row of the subtree (any status: active + history + orphaned + pending), including the root itself
- [ ] getOrphanedObjectsWithNodeState annotation: each row carries the correct `node_sync_status` and `has_active` (true when an active row exists for the same node); a node-less orphan (LEFT JOIN miss) is annotated accordingly
- [ ] getStalePendingObjects filter: returns only `pending` rows on `pending_upload` nodes older than the cutoff; younger rows and pending rows on other node states are excluded
- [ ] getObjectMapByNode returns every object_map row of the node (any status) newest-version first, independent of row age
