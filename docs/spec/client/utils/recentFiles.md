# recentFiles Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure path-mutation helpers for recent entries: given a list of recent entries and a path change (rename/move/delete), derive which recent paths should be removed and which updated entries should be added. |
| Boundary note | This is a **product utility**, not part of reusable explorer core. Explorer core must not own virtual collections such as `__recent__` (those remain product overlays in the FileManager shell), but the product may use these pure helpers inside the `recentFilesRepository` implementation. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/recentFiles.js`
- **Test file:** `client/src/utils/__tests__/recentFiles.test.js`

### 2.2 Function Signatures (pure contracts)

Recent entry shape:

- `RecentEntry = { path: string, name?: string, type?: 'file'|'directory', basename?: string }`

Return shape:

- `RecentMutationPlan = { removedPaths: string[], addedEntries: RecentEntry[] }`

| Function | Input => Return |
|----------|------------------|
| updateSubPathsOnPathChange | `(recentEntries, oldPath, newPath) => RecentMutationPlan` |
| removeSubPathsOnFolderDelete | `(recentEntries, folderPath) => { removedPaths: string[] }` |
| removeMultiplePaths | `(recentEntries, filePaths) => { removedPaths: string[] }` |

### 2.3 Dependencies

- pathUtils.normalizePath (used only to compare and compute derived relative paths)

### 2.4 Verification Scenarios

- [ ] `updateSubPathsOnPathChange` produces removed paths under `oldPath` and (for non-directory recent entries) adds updated entries under `newPath`.
- [ ] `updateSubPathsOnPathChange` does not re-add `type === 'directory'` recent entries.
- [ ] `removeSubPathsOnFolderDelete` removes any recent entry whose normalized path is `folderPath` or has `folderPath + '/'` prefix.
- [ ] `removeMultiplePaths` removes only exact path matches after normalization.

### 2.5 Edge Cases

- Empty `recentEntries` returns empty removals/additions.
- `oldPath === newPath` produces an empty mutation plan.
- Empty `filePaths` for `removeMultiplePaths` produces `{ removedPaths: [] }`.
