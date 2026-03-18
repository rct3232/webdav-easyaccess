# recentFiles Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Recent-files tracking utility: fetch/update recent entries via API, publish change notifications to subscribers, and provide helpers to keep recent paths consistent across rename/move/delete and bulk operations. |
| Boundary note | This is a **product utility**, not part of reusable explorer core. Explorer core must not own virtual collections such as `__recent__` (those remain product overlays in the FileManager shell), but the product may use this utility to build a “recent” section. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/recentFiles.js`
- **Test file:** `client/src/utils/__tests__/recentFiles.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| onRecentFilesChange | (callback) => unsubscribeFn |
| getRecentFiles | () => Promise<Array> |
| addRecentFile | (file, options?) => Promise<Array> |
| removeRecentFile | (filePath, options?) => Promise<Array> |
| clearRecentFiles | () => Promise<void> |
| updateSubPathsOnPathChange | (oldPath, newPath, options?) => Promise<Array> |
| removeSubPathsOnFolderDelete | (folderPath) => Promise<Array> |
| removeMultiplePaths | (filePaths) => Promise<Array> |
| applyRecentFilesAfterRename | (oldPath, newPath, file) => Promise<Array> |
| applyRecentFilesAfterBulkDelete | (filePaths, folderPaths) => Promise<Array> |
| applyRecentFilesAfterBulkMove | (moves) => Promise<Array> |

### 2.3 Dependencies

- apiClient (get, post, del)
- pathUtils.normalizePath
- notifyRecentFilesChange (internal, calls listeners)

### 2.4 API Endpoints

- GET /recent-files
- POST /recent-files
- DELETE /recent-files
- DELETE /recent-files/:encodedPath
- POST /recent-files/remove-paths
- POST /recent-files/apply-moves

### 2.5 Options

- `{ silent: true }` – skip getRecentFiles and notify (for bulk updates)

### 2.6 Verification Scenarios

- [ ] getRecentFiles returns array; on error returns []
- [ ] addRecentFile/removeRecentFile call notifyRecentFilesChange unless silent
- [ ] onRecentFilesChange returns unsubscribe that removes listener
- [ ] updateSubPathsOnPathChange moves sub-paths from oldPath to newPath
- [ ] removeSubPathsOnFolderDelete removes entries under folderPath
- [ ] applyRecentFilesAfterBulkDelete/applyRecentFilesAfterBulkMove use batch APIs

### 2.7 Edge Cases

- API errors → return [] or [] on fallback
- Empty filePaths/folderPaths → getRecentFiles() for bulk delete
- Empty moves → getRecentFiles() for bulk move
