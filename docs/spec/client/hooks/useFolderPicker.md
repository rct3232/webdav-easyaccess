# useFolderPicker Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | FolderPicker dialog controller: manages open-state lifecycle, `selectedNodeId`, current folder list, write-permission status, and callback wiring for the picker dialog. |
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
| currentNodeId | number \| null | Y | Initial nodeId |
| user | object | Y | User |
| action | string | N | 'copy' \| 'move' |
| sourceNodeId | number | N | Source nodeId |
| sourceNodeIds | array | N | Source nodeIds |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| selectedNodeId | number \| null | Selected folder nodeId (the destination handed to the caller via `onSelect` is a nodeId, not a path) |
| folders | array | Folder list |
| loading | boolean | Loading |
| hasWritePermission | boolean | Write permission |
| breadcrumbs | array | Breadcrumb items (display names; clicks emit nodeIds) |
| handleFolderClick | (folder) => void | Select folder (by `folder.nodeId`) |
| handleNodeClick | (nodeId) => void | Breadcrumb click (by nodeId) |
| handleTogglePath | (e, target) => void | Home/shared toggle |
| getCurrentPathType | () => 'home' \| 'shared' | Current type |
| isInvalidDestination | () => boolean | Invalid dest |
| setSelectedNodeId | function | Set selected nodeId |
| loadFolders | (nodeId) => Promise | Load folders for nodeId |
| checkWritePermission | (nodeId) => Promise | Check write permission |

### 2.4 Dependencies

- IO boundary:
  - `client/src/services/folderPickerGateway` — `checkWritePermission({ nodeId })`, `listFolderContents({ nodeId })`, `getUserSharedFolderPermissions({ user })`
- Pure helper utilities:
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/buildFolderPickerBreadcrumbs.js`
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/isInvalidFolderPickerDestination.js`
- Additional pure helper utilities for shared-state and toggle derivation:
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js`
  - `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/resolveFolderPickerToggleTarget.js`

#### 2.4.1 Pure Helper Utilities
- Breadcrumb builder: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/buildFolderPickerBreadcrumbs.js`
  - Responsibility: derive the `breadcrumbs` model purely from the hook-maintained navigation stack (`navStack` of `{ nodeId, name }` entries whose first entry is the home or shared root), `homeNodeId`, `homeLabel`, and `sharedLabel` (no gateways/services/hooks). Breadcrumb clicks emit nodeIds.
- Invalid-destination validator: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/isInvalidFolderPickerDestination.js`
  - Responsibility: return whether a copy/move destination is invalid based on `selectedNodeId` and the provided `sourceNodeId`/`sourceNodeIds` (no React state, no translations, no side effects). Without server ancestor calls, the reliably checkable invalid destination is the source nodeId itself.
- Shared-state derivation: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/deriveFolderPickerSharedState.js`
  - Responsibility: normalize shared-permission results into top-level shared-folder lists plus shared-permission nodeId context for the picker (no React state, no gateways, no side effects).
- Toggle-target resolver: `client/src/components/dialogs/FolderPickerDialog/hooks/helpers/resolveFolderPickerToggleTarget.js`
  - Responsibility: determine the landing nodeId for home/shared toggle changes (home nodeId, shared root, or the matching top-level shared root), without mutating React state or calling IO.

### 2.5 Side Effects

- On open transition (`closed -> open`):
  - resets `selectedNodeId` to `currentNodeId`
  - loads folders for the initial nodeId
  - checks write permission for copy/move flows
  - preloads shared permissions for non-admin copy/move flows
- On folder or breadcrumb navigation:
  - loads folders for the newly selected nodeId
  - updates write-permission state for copy/move flows
- For `__shared__`:
  - loads shared-folder permissions through `folderPickerGateway.getUserSharedFolderPermissions`
  - stores raw permission-nodeId inputs needed by helper-driven breadcrumb/toggle derivation

### 2.6 Error Handling

- Directory/shared loading failure:
  - log error
  - set `folders` to `[]`
- Write-permission failure:
  - admins fall back to `hasWritePermission = true`
  - non-admins fall back to `hasWritePermission = false` (no path-based heuristic in the nodeId end-state)

### 2.7 Verification Scenarios

- [x] Folders load for nodeId (`listFolderContents({ nodeId })`)
- [x] __shared__ loads shared folders through the toggle
- [x] Breadcrumb contents match the navigation stack (home/shared root base; clicks emit nodeIds)
- [x] NodeId click updates `selectedNodeId` and reloads the requested folder
- [x] Home/shared toggle routes to the expected landing nodeId (home nodeId, shared root, or matching top-level shared root)
- [x] Shared top-level folder shaping and shared-root resolution preserve visible destinations after helper extraction
- [x] `isInvalidDestination` returns `true` when the destination equals the source nodeId (multi-source aware)
- [x] `checkWritePermission({ nodeId })` and `listFolderContents({ nodeId })` are the gateway contract; `onSelect` returns a nodeId

### 2.8 Edge Cases

- `sourceNodeId` and `sourceNodeIds` are both supported by the invalid-destination helper
- `prevOpenRef` ensures initialization only runs when the dialog transitions from closed to open
- Initial nodeId: `currentNodeId` when provided, otherwise the user's home nodeId (`user.rootNodeId`) if derivable, otherwise the server root (`nodeId = null`)
- Navigation state is a `{ nodeId, name }` stack, so breadcrumbs/back work without server ancestor calls
