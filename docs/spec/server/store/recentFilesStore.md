# recentFilesStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Per-user recent files. Stored as normalized tables in postgresql/sqlite. Max 20 entries per user. Supports add, remove, clear. Node_ids are stable so bulk move/remove operations are no longer needed. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/recentFilesStore.js`
- **Test file:** `server/store/__tests__/recentFilesStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| getUserRecentFiles | (userId) => Promise\<Array\> | List recent files |
| addRecentFile | (userId, fileNodeId) => Promise<Array> | Add; dedupe by node_id; prepend; cap at MAX_RECENT_FILES. Name/type derivable from `file_nodes`. |
| removeRecentFile | (userId, fileNodeId) => Promise\<Array\> | Remove by node_id |
| clearRecentFiles | (userId) => Promise\<void\> | Delete all entries |

**REMOVED methods:** `applyBulkMove`, `removePaths` — node_ids are stable; rename/move does not change nodeId.

### 2.3 PostgreSQL v2 Table Mapping

- Table: `recent_files(user_id, file_node_id, last_accessed)`
- Unique on `(user_id, file_node_id)`
- Constraint/index source of truth: `server/store/postgresql/ddl/001_initial_normalized_schema.sql`

### 2.4 Transaction Boundaries

- `addRecentFile`: single transaction that upserts by `(user_id, file_node_id)` and preserves recency ordering.
- `removeRecentFile`, `clearRecentFiles`: single transaction per call.

### 2.5 Dependencies

- PostgresqlMetadataAdapter / SqliteMetadataAdapter
- shared pathUtils.normalizePath

### 2.6 Verification Scenarios

- [ ] addRecentFile dedupes by node_id; new entry at front; cap at 20
- [ ] removeRecentFile filters by file_node_id
- [ ] Missing entries → [] from getUserRecentFiles
- [ ] PostgreSQL: unique `(user_id, file_node_id)` prevents duplicates under concurrent inserts
