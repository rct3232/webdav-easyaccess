# recentFilesStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Per-user recent files. Stored as JSON in `webdav`/`fs` and normalized rows in `postgresql`. Max 20 entries per user. Supports add, remove, clear, bulk move, bulk remove. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/recentFilesStore.js`
- **Test file:** `server/store/__tests__/recentFilesStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| getUserRecentFiles | (userId) => Promise\<Array\> | List recent files |
| addRecentFile | (userId, fileData) => Promise\<Array\> | Add; dedupe by path; prepend; cap at MAX_RECENT_FILES |
| removeRecentFile | (userId, targetPath) => Promise\<Array\> | Remove by path |
| clearRecentFiles | (userId) => Promise\<void\> | Delete file |
| applyBulkMove | (userId, moves) => Promise\<Array\> | Move/rename paths in one read/write |
| removePaths | (userId, filePaths, folderPaths) => Promise\<Array\> | Remove paths and descendants |

### 2.3 Storage Paths

- `/.wea/recent-files/{userId}.json`
- Entry: { path, name, type, lastAccessed }
- MAX_RECENT_FILES = 20

### 2.4 PostgreSQL v2 Table Mapping

- Table: `recent_files(user_id, path, name, type, last_accessed)`
- Constraints:
  - unique (`user_id`, `path`)
  - foreign key (`user_id`) references `users(id)`

### 2.5 Transaction Boundaries

- `addRecentFile`: single transaction that upserts by `(user_id, path)` and preserves recency ordering.
- `removeRecentFile`, `clearRecentFiles`: single transaction per call.
- `applyBulkMove`, `removePaths`: single transaction per batch to keep list updates atomic.

### 2.6 Dependencies

- storage (ensureDirSafe, exists, readFile, writeFile, deletePath)
- metaPaths.normalizeWebdavPath
- shared pathUtils.normalizePath

### 2.7 Verification Scenarios

- [ ] addRecentFile dedupes; new entry at front; cap at 20
- [ ] removeRecentFile filters by normalized path
- [ ] applyBulkMove: folder → update subpaths; file → replace
- [ ] removePaths: filePaths exact match; folderPaths remove descendants
- [ ] Missing file → [] from getUserRecentFiles
- [ ] PostgreSQL: unique `(user_id, path)` prevents duplicates under concurrent inserts
