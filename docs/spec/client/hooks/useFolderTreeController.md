# useFolderTreeController Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Folder-tree section controller: loads and maintains “__shared__” + “__recent__” data, manages expansion state for tree nodes, and exposes view-ready handlers plus controller-owned derived shared-tree data for Phase 4. |
| Used by components/pages | `client/src/components/folder-tree/FolderTree.js` |
| Ownership note | This hook owns folder-tree section loading/expansion coordination only. It must not become a UI component or own product overlay policies beyond what `FolderTree` already supports. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/hooks/useFolderTreeController.js`
- **Test file:** `client/src/components/folder-tree/hooks/__tests__/useFolderTreeController.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentPath | string | Y | Current explorer path (drives which sections should be marked expanded). |
| user | object | Y | Current user (drives whether shared/recent sections can load). |
| onPathClick | function | Y | Called when the controller wants to navigate via the host (e.g. toggle “__shared__” to that route). |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| homePath | string | Host “home” folder path (admin -> `/`, others -> `/${username}`). |
| expandedPaths | Set<string> | Expanded folder paths for the main tree and shared section items. |
| onToggleExpand | (path: string) => void | Toggles expansion for an individual folder path. |
| sharedFolders | Array<{ folder_path: string, permission: string }> | Shared-folder permission entries (filtered) used by the shared tree builder. |
| sharedExpanded | boolean | Whether the “__shared__” section is expanded. |
| handleSharedToggle | (e: any) => void | Stops propagation and toggles “__shared__” expanded state (and navigates to `/__shared__` when expanding). |
| handleSharedClick | () => void | Navigates to `/__shared__`. |
| handleSharedFolderClick | (folderPath: string) => void | Navigates to a specific shared subfolder path. |
| buildSharedFolderTree | () => Array<{ path: string, name: string, children: any[], parentPath: string | null, permission: string, hasReadPermission: boolean }> | Derived shared-tree structure consumed by `SharedFoldersSection`. Phase 4 keeps this derived builder inside the controller; extraction to a standalone pure helper is future work. |
| recentExpanded | boolean | Whether the “__recent__” section is expanded. |
| handleRecentToggle | (e: any) => void | Stops propagation and toggles “__recent__” expanded state. |
| handleRecentClick | () => void | Navigates to `/__recent__`. |
| recentFilesList | Array<any> | Current recent files list consumed by `RecentFilesSection`. |

### 2.4 Dependencies

- Services called / IO boundaries:
  - `getRecentFiles` from `client/src/services/recentFilesRepository`
  - `onRecentFilesChange` from `client/src/services/recentFilesNotifier`
  - `folderTreeGateway.getUserSharedFolderPermissions` from `client/src/services/folderTreeGateway`
- Pure utilities:
  - `normalizePath` for shared-tree building
  - `getUserBaseFolder` to compute the user home path

### 2.5 Side Effects

- On mount / whenever `user` changes:
  - Loads recent files when `user` is present
  - Subscribes to recent-file updates via `onRecentFilesChange`, reloading on updates
  - Clears recent files when `user` becomes falsy
- On mount / whenever `user` changes:
  - Loads shared-folder permissions for non-admin users
  - Clears shared-folder permissions for admin users
- Whenever `currentPath`, `user homePath`, or `sharedFolders` changes:
  - Recomputes `expandedPaths` to include the path prefixes and `homePath`
  - Sets `sharedExpanded` to `true` when `currentPath` is `/__shared__` or within a shared folder prefix
  - Sets `recentExpanded` to `true` when `currentPath` is `/__recent__`
- Manual toggles:
  - `handleSharedToggle` and `handleRecentToggle` allow the user to collapse/expand sections after auto-expansion has been derived from path state

### 2.6 Error Handling

- Recent-files loading errors:
  - The controller expects `recentFilesRepository.getRecentFiles()` to resolve to a contract-safe array (`[]` on ordinary IO failure).
  - The local `try/catch` remains a defensive guard for unexpected exceptions and still falls back to `[]`.
- Shared-folder loading errors:
  - Log and set `sharedFolders` to `[]`

### 2.7 Verification Scenarios

The following should be covered by `useFolderTreeController` unit tests (renderHook):

- Initial `recentFilesList` loads for a non-null `user`.
- When `user` becomes falsy, `recentFilesList` becomes `[]`.
- `onRecentFilesChange` triggers a reload of recent files.
- The notifier subscription returns a callable cleanup function that the controller can invoke safely on unmount.
- Shared folders load for non-admin users, and do not load for admin users.
- Repository-provided empty recent results still keep `recentFilesList` array-safe.
- Shared-folder load failure falls back to `[]`.
- `expandedPaths` includes `homePath` and each prefix segment of `currentPath` when `currentPath` is set.
- Falsy `currentPath` leaves `expandedPaths` with only `homePath`.
- Setting `currentPath` to `/__shared__` sets `sharedExpanded` to `true`.
- Setting `currentPath` to a shared-folder prefix sets `sharedExpanded` to `true`.
- Setting `currentPath` to `/__recent__` sets `recentExpanded` to `true`.
- `handleSharedToggle` toggles `sharedExpanded` and calls `onPathClick('/__shared__')` when transitioning to expanded.
- `handleRecentClick` and `handleSharedFolderClick` navigate through the host callback with the expected path.

### 2.8 Edge Cases

- `currentPath` is empty/falsy: `expandedPaths` contains only `homePath`.
- Shared permissions entries may contain paths with or without trailing slashes: shared-tree building normalizes paths.

