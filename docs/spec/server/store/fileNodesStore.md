# fileNodesStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Filesystem tree management via `file_nodes`, `object_map`, `filecache`, `node_ancestors`. Provides inode-equivalent filesystem hierarchy with node_id-based references, multi-backend blob mapping, and closure-table ancestry tracking. |

---

## 2. Implementation Spec

### 2.1 Tables

| Table | Purpose |
|-------|---------|
| `file_nodes` | Inode equivalent — self-referencing FK tree for filesystem hierarchy. Directories exist only as DB rows; S3 remains flat. |
| `object_map` | Node-to-blob mapping — enables multiple storage backends and future version history. |
| `filecache` | Metadata cache — size, mime_type, content_hash. Written on upload completion. PK is FK to file_nodes. |
| `node_ancestors` | Closure table for permission inheritance and bulk descendant queries. Maintained at application level via `_updateAncestors(nodeId)` helper (Phase 2). No DB triggers (SQLite compatibility). Self-referential `depth=0` row included for every node. |

### 2.2 DDL Source of Truth

Canonical table definitions, constraints, and indexes are in:
- `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

This spec does not duplicate full DDL text.

### 2.3 Maintenance Strategy

- **Closure table (`node_ancestors`)**: Maintained by application-level `_updateAncestors(nodeId)` helper (Phase 2, Task 2.5/2.6). No DB triggers for SQLite compatibility.
- **Self-referential row**: Every node has a `(ancestor_id = id, descendant_id = id, depth = 0)` entry.
- **CASCADE semantics**: `ON DELETE CASCADE` on all FK references to `file_nodes(id)`. When a file_node is deleted, corresponding rows in object_map, filecache, permissions_*, share_links, recent_files are auto-removed.

### 2.4 Verification Scenarios

- [ ] Tree operations (create/move/delete/rename) maintain closure table correctness
- [ ] CASCADE deletes propagate properly across all dependent tables
- [ ] Self-referencing `file_nodes.parent_id` FK works on both PostgreSQL and SQLite with deferred foreign keys
