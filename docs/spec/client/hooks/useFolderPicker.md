# useFolderPicker Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | FolderPicker dialog controller: manages open-state lifecycle, `selectedPath`, current folder list, write-permission status, and callback wiring for the picker dialog. |
| Used by components/pages | FolderPickerDialog |
| Ownership note | This hook is product UI/controller logic for the picker dialog. It is not reusable explorer core. Its target boundary is state/orchestration only: IO must go through `folderPickerGateway`, while breadcrumb shaping, invalid-destination rules, shared-root resolution, and home/shared toggle landing decisions belong in pure helper utilities. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/hooks/useFolderPicker.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/hooks/__tests__/useFolderPicker.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| open | boolean | Y | Dialog open |
| currentPath | string | Y | Initial path |
| user | object | Y | User |
| action | string | N | 'copy' \| 'move' |
| sourceFilePath | string | N | Source path |
| sourceFilePaths | array | N | Source paths |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| selectedPath | string | Selected path |
| folders | array | Folder list |
| loading | boolean | Loading |
| hasWritePermission | boolean | Write permission |
| breadcrumbs | array | Breadcrumb items |
| handleFolderClick | (folder) => void | Select folder |
| handlePathClick | (path) => void | Breadcrumb click |
| handleTogglePath | (e, target) => void | Home/shared toggle |
| getCurrentPathType | () => 'home' \| 'shared' | Current type |
| isInvalidDestination | () => boolean | Invalid dest |
| setSelectedPath | function | Set selected path |
| loadFolders | (path) => Promise | Load folders for path |
| checkWritePermission | (path) => Promise | Check write permission |

### 2.4 Dependencies

- IO boundary:
  - `client/src/services/folderPickerGateway`
- Pure helper utilities:
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/buildFolderPickerBreadcrumbs.js`
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/isInvalidFolderPickerDestination.js`
- Additional pure helper utilities for shared-state and toggle derivation:
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js`
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/resolveFolderPickerToggleTarget.js`
- Pure path/user utilities:
  - `normalizePath`
  - `getUserBaseFolder`

#### 2.4.1 Pure Helper Utilities
- Breadcrumb builder: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/buildFolderPickerBreadcrumbs.js`
  - Responsibility: derive the `breadcrumbs` model purely from `selectedPath`, `user`, `homePath`, `homeLabel`, `sharedPermissionPaths`, and translated labels (no gateways/services/hooks).
- Invalid-destination validator: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/isInvalidFolderPickerDestination.js`
  - Responsibility: return whether a copy/move destination is invalid based on `selectedPath` and the provided `sourceFilePath`/`sourceFilePaths` (no React state, no translations, no side effects).
- Shared-state derivation: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js`
  - Responsibility: normalize shared-permission results into top-level shared-folder lists plus shared-permission path context for the picker (no React state, no gateways, no side effects).
- Toggle-target resolver: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/resolveFolderPickerToggleTarget.js`
  - Responsibility: determine the landing path for home/shared toggle changes, including source-home detection and shared-root fallback, without mutating React state or calling IO.

### 2.5 Side Effects

- On open transition (`closed -> open`):
  - resets `selectedPath` to `currentPath || '/'`
  - loads folders for the initial path
  - checks write permission for copy/move flows
  - preloads shared permission paths for non-admin copy/move flows
- On folder or breadcrumb navigation:
  - loads folders for the newly selected path
  - updates write-permission state for copy/move flows
- For `__shared__`:
  - loads shared-folder permissions through `folderPickerGateway.getUserSharedFolderPermissions`
  - stores raw permission-path inputs needed by helper-driven breadcrumb/toggle derivation

### 2.6 Error Handling

- Directory/shared loading failure:
  - log error
  - set `folders` to `[]`
- Write-permission failure:
  - admins fall back to `hasWritePermission = true`
  - non-admins fall back to whether the selected path is under the user's home path

### 2.7 Verification Scenarios

- [ ] Folders load for path
- [ ] __shared__ loads shared folders
- [ ] Breadcrumb contents match home/shared path rules, including the non-admin hidden username crumb rule
- [ ] Path click updates `selectedPath` and reloads the requested path
- [ ] Home/shared toggle routes to the expected landing path for home-origin and shared-origin moves/copies
- [ ] Shared top-level folder shaping and shared-root resolution preserve the same visible destinations after helper extraction
- [ ] `isInvalidDestination` returns `true` for source path, parent path, and descendant path targets
- [ ] Multi-source copy/move is invalid when any selected source would land in an invalid destination

### 2.8 Edge Cases

- `sourceFilePath` and `sourceFilePaths` are both supported by the invalid-destination helper
- `prevOpenRef` ensures initialization only runs when the dialog transitions from closed to open
- Shared breadcrumbs start at the first path segment covered by `sharedPermissionPaths`; otherwise they fall back to `__shared__` + full path segments
