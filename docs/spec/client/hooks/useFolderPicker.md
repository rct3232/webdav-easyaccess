# useFolderPicker Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | FolderPicker dialog controller state: manages `selectedPath`, folder list for the current picker path, loading state, write-permission flag, and breadcrumb model for rendering. |
| Used by components/pages | FolderPickerDialog |
| Ownership note | This hook is product UI/controller logic for the picker dialog. It should not be treated as part of reusable explorer core. IO concerns should be isolated behind gateways/adapters over time (see refactor plan Phase 4). |

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

- Current implementation may use existing services (listing + permission checks).
- Target contract: picker IO should be routed through a gateway (future: `folderPickerGateway`) so the hook does not permanently mix service imports and domain rules.
- Pure folder-selection rules (breadcrumbs building, invalid destination validation) should be extractable into pure utilities over time.

### 2.5 Side Effects

- loadFolders on path/open
- checkWritePermission on selectedPath
- __shared__: getUserPermissions for shared folders

### 2.6 Error Handling

- setFolders([]) on error
- Admin: hasWritePermission true

### 2.7 Verification Scenarios

- [ ] Folders load for path
- [ ] __shared__ loads shared folders
- [ ] Breadcrumbs, path click
- [ ] Home/shared toggle
- [ ] isInvalidDestination (source = dest)

### 2.8 Edge Cases

- sourceFilePath/sourceFilePaths for invalid dest
- prevOpenRef for open change
