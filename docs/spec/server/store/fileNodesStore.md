# fileNodesStore Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Filesystem tree management via `file_nodes`, `object_map`, `filecache`, `node_ancestors`. Provides inode-equivalent filesystem hierarchy with node_id-based references, multi-backend blob mapping, and closure-table ancestry tracking. |

---

## 2. Implementation Spec

### 2.1 Tables

| Table            | Purpose                                                                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `file_nodes`     | Inode equivalent — self-referencing FK tree for filesystem hierarchy. Directories exist only as DB rows; S3 remains flat.                                                                                                                             |
| `object_map`     | Node-to-blob mapping — enables multiple storage backends and future version history.                                                                                                                                                                  |
| `filecache`      | Metadata cache — size, mime_type, content_hash. Written on upload completion. PK is FK to file_nodes.                                                                                                                                                 |
| `node_ancestors` | Closure table for permission inheritance and bulk descendant queries. Maintained at application level via `_updateAncestors(nodeId)` helper (Phase 2). No DB triggers (SQLite compatibility). Self-referential `depth=0` row included for every node. |

### 2.2 DDL Source of Truth

Canonical table definitions, constraints, and indexes are in:

- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

This spec does not duplicate full DDL text.

### 2.3 Maintenance Strategy

- **Closure table (`node_ancestors`)**: Maintained by application-level `_updateAncestors(nodeId)` helper (Phase 2, Task 2.5/2.6). No DB triggers for SQLite compatibility.
- **Self-referential row**: Every node has a `(ancestor_id = id, descendant_id = id, depth = 0)` entry.
- **CASCADE semantics**: `ON DELETE CASCADE` on all FK references to `file_nodes(id)`. When a file*node is deleted, corresponding rows in object_map, filecache, permissions*\*, share_links, recent_files are auto-removed.

### 2.4 Main Methods

#### file_nodes Methods

| Method                               | SQL Pattern                                                                                     | Returns                                    |
| ------------------------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------ |
| `createNode(parentId, name, type)`   | INSERT with sync_status='pending_upload'; RETURNING id (PG) or lastID (SQLite)                  | `{ id, parentId, name, type, syncStatus }` |
| `getNode(id)`                        | SELECT \* FROM file_nodes WHERE id=?                                                            | row \| null                                |
| `getChildren(parentId)`              | LEFT JOIN with filecache for size/mime_type/content_hash; ORDER BY name                         | `row[]`                                    |
| `renameNode(id, newName)`            | UPDATE SET name=?, updated_at=NOW()                                                             | `{ changes }`                              |
| `moveNode(id, newParentId)`          | UPDATE SET parent_id=?, updated_at=NOW()                                                        | `{ changes }`                              |
| `deleteNodeTree(nodeIds)`            | DELETE WHERE id IN (...); CASCADE handles descendants + object_map + filecache + node_ancestors | `{ changes }`                              |
| `updateSyncStatus(id, status)`       | UPDATE SET sync_status=?, updated_at=NOW()                                                      | `{ changes }`                              |
| `resolvePathSegment(parentId, name)` | SELECT id WHERE parent_id=? AND name=?                                                          | `{ id }` \| null                           |

#### node_ancestors Methods

| Method                                      | SQL Pattern                                                                    | Returns                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------ | --------------------------------------------------- |
| `insertAncestorRows(rows)`                  | Bulk INSERT INTO node_ancestors; rows: `[{ ancestorId, descendantId, depth }]` | `{ changes }`                                       |
| `deleteAncestorByDescendant(descendantIds)` | DELETE WHERE descendant_id IN (...)                                            | `{ changes }`                                       |
| `deleteAncestorByAncestor(ancestorIds)`     | DELETE WHERE ancestor_id IN (...)                                              | `{ changes }`                                       |
| `getDescendantIds(ancestorId)`              | SELECT descendant_id WHERE ancestor_id=?                                       | `[id, ...]`                                         |
| `getAncestorChain(descendantId)`            | SELECT ancestor_id, depth WHERE descendant_id=? ORDER BY depth DESC            | `[{ ancestorId, depth }, ...]` — root is last entry |

#### object_map Methods

| Method                                       | SQL Pattern                                                                                                                                                           | Returns       |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `upsertObjectMap(fileNodeId, s3Key, status)` | If active row exists for fileNodeId: UPDATE SET status='orphaned'. Then INSERT INTO object_map (file_node_id, s3_key, storage_backend='s3', version_number=1, status) | `{ changes }` |
| `insertObject(fileNodeId, s3Key, status)`    | INSERT INTO object_map                                                                                                                                                | `{ changes }` |
| `getActiveObject(fileNodeId)`                | SELECT \* WHERE file_node_id=? AND status='active' LIMIT 1                                                                                                            | row \| null   |
| `getObjectMapByS3Key(s3Key)`                 | SELECT \* WHERE s3_key=? AND status IN ('pending', 'active')                                                                                                          | row \| null   |
| `activateObject(s3Key)`                      | UPDATE SET status='active' WHERE s3_key=? AND status='pending'                                                                                                        | `{ changes }` |
| `orphanObject(s3Key)`                        | UPDATE SET status='orphaned' WHERE s3_key=? AND status IN ('active', 'pending')                                                                                       | `{ changes }` |

#### GC support methods (Phase 6)

| Method                              | SQL Pattern                                                                                       | Returns       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- | ------------- |
| `getOrphanedObjects(olderThanDays)` | SELECT \* WHERE status='orphaned' AND created_at < NOW() - interval / `datetime('now','-N days')` | rows[]        |
| `getAllActiveS3Keys()`              | SELECT s3_key WHERE status='active' AND s3_key IS NOT NULL                                        | string[]      |
| `deleteObjectMapRows(ids)`          | DELETE WHERE id IN (...); SQLite per-row via `sqliteRun`                                          | `{ changes }` |
| `getNodesBySyncStatus(status)`      | SELECT \* FROM file_nodes WHERE sync_status=?                                                     | mapped rows[] |
| `getNodesBySyncStatusNot(status)`   | SELECT \* FROM file_nodes WHERE sync_status != ?                                                  | mapped rows[] |

#### filecache Methods

| Method                                                 | SQL Pattern                  | Returns       |
| ------------------------------------------------------ | ---------------------------- | ------------- |
| `upsertCache(fileNodeId, size, mimeType, contentHash)` | INSERT ON CONFLICT DO UPDATE | `{ changes }` |
| `deleteCache(fileNodeId)`                              | DELETE WHERE file_node_id=?  | `{ changes }` |

### 2.5 PostgreSQL vs SQLite Branching

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
- [ ] CASCADE deletes propagate properly across all dependent tables
- [ ] Self-referencing `file_nodes.parent_id` FK works on both PostgreSQL and SQLite with deferred foreign keys
- [ ] object_map pending→active→orphaned lifecycle transitions work correctly
- [ ] upsertObjectMap orphans previous active row before inserting new pending
- [ ] version_number is always 1 in single-version mode
