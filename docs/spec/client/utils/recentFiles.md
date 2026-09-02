# recentFiles Spec

## 1. Overview

| Item          | Description                                                                                                                                                                                                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role          | **REMOVED in Phase 5.** Previously a pure path-mutation helper module for recent entries: given a list of recent entries and a path change (rename/move/delete), it derived which recent paths should be removed and which updated entries should be added. |
| Boundary note | Recent entries are now keyed by stable `nodeId`s, and server `CASCADE` handles deletes. Path-based mutation planning is no longer needed, so this module and its three helpers are **REMOVED** and must not be imported by client code.                     |

---

## 2. Removal

### 2.1 File Path

- **Source:** `client/src/utils/recentFiles.js` (REMOVED in Phase 5)
- **Test file:** `client/src/utils/__tests__/recentFiles.test.js` (REMOVED in Phase 5)

### 2.2 Removed Functions (Phase 5)

The following path-mutation helpers are **REMOVED**:

- `updateSubPathsOnPathChange`
- `removeSubPathsOnFolderDelete`
- `removeMultiplePaths`

### 2.3 Impact

- `recentFilesRepository` no longer depends on path-mutation planning helpers.
- Renames/moves no longer rewrite recent paths (nodeIds are stable).
- Folder/file deletes are handled by server `CASCADE`; no client-side removal planning is required.
