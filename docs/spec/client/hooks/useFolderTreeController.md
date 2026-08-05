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

> **Phase 4 nodeId end-state** (pending implementation in C2.3): the controller migrates to nodeId-first state — `expandedNodeIds`, `currentNodeId`, `onNodeClick(nodeId)` — and shared folders are keyed by nodeId (the permissions API already returns nodeId). The current source still uses `expandedPaths`/`currentPath`/`onPathClick`; those are transitional and are replaced below. Virtual roots `/__shared__` and `/__recent__` remain unchanged (decision D1).

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentNodeId | number | Y | Current explorer node id (drives which sections/nodes should be marked expanded). Virtual-root routes (`__shared__`/`__recent__`) keep their route-based selection per D1 (target contract, pending implementation). |
| user | object | Y | Current user (drives whether shared/recent sections can load). |
| onNodeClick | function | Y | Called when the controller wants to navigate via the host: `(nodeId) => void`. Also used to navigate to the `__shared__`/`__recent__` virtual-root routes (target contract, pending implementation). |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| homeNodeId | number | Host "home" folder node id (admin -> root node id, others -> user home node id) (target contract, pending implementation). |
| expandedNodeIds | Set<number> | Expanded folder node ids for the main tree and shared section items (target contract, pending implementation). |
| onToggleExpand | (nodeId: number) => void | Toggles expansion for an individual folder node id. |
| sharedFolders | Array<{ nodeId: number, permission: string }> | Shared-folder permission entries (filtered), keyed by nodeId, used by the shared tree builder. |
| sharedExpanded | boolean | Whether the “__shared__” section is expanded. |
| handleSharedToggle | (e: any) => void | Stops propagation and toggles “__shared__” expanded state (and navigates to `/__shared__` when expanding). |
| handleSharedClick | () => void | Navigates to `/__shared__`. |
| handleSharedFolderClick | (nodeId: number) => void | Navigates to a specific shared folder by nodeId (target contract, pending implementation). |
| buildSharedFolderTree | () => Array<{ nodeId: number, name: string, children: any[], parentNodeId: number \| null, permission: string, hasReadPermission: boolean }> | Derived shared-tree structure consumed by `SharedFoldersSection`. Nodes are keyed by nodeId; the interim synthetic `/__shared__/<nodeId>` path entries are removed (pending implementation in C2.3). Extraction to a standalone pure helper is future work. |
| recentExpanded | boolean | Whether the “__recent__” section is expanded. |
| handleRecentToggle | (e: any) => void | Stops propagation and toggles “__recent__” expanded state. |
| handleRecentClick | () => void | Navigates to `/__recent__`. |
| recentFilesList | Array<any> | Current recent files list consumed by `RecentFilesSection` (path-based until Phase 5). |

### 2.4 Dependencies

- Services called / IO boundaries:
  - `getRecentFiles` from `client/src/services/recentFilesRepository`
  - `onRecentFilesChange` from `client/src/services/recentFilesNotifier`
  - `folderTreeGateway.getUserSharedFolderPermissions` from `client/src/services/folderTreeGateway` (returns nodeId-keyed permission entries)
- Pure utilities:
  - `normalizePath` only where path normalization still applies (virtual-root checks; no longer used to build synthetic shared-folder paths — target contract, pending implementation)
  - `getUserBaseFolder` to compute the user home node id (target contract, pending implementation)

### 2.5 Side Effects

- On mount / whenever `user` changes:
  - Loads recent files when `user` is present
  - Subscribes to recent-file updates via `onRecentFilesChange`, reloading on updates
  - Clears recent files when `user` becomes falsy
- On mount / whenever `user` changes:
  - Loads shared-folder permissions for non-admin users (nodeId-keyed entries)
  - Clears shared-folder permissions for admin users
- Whenever `currentNodeId`, `user homeNodeId`, or `sharedFolders` changes:
  - Recomputes `expandedNodeIds` to include the current node's ancestor node ids and `homeNodeId` (target contract, pending implementation)
  - Sets `sharedExpanded` to `true` when the current location is the `/__shared__` virtual root or within a shared folder node subtree
  - Sets `recentExpanded` to `true` when the current location is `/__recent__`
- Manual toggles:
  - `handleSharedToggle` and `handleRecentToggle` allow the user to collapse/expand sections after auto-expansion has been derived from location state

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
- `expandedNodeIds` includes `homeNodeId` and the current node's ancestor node ids when `currentNodeId` is set (target contract, pending implementation).
- Falsy `currentNodeId` leaves `expandedNodeIds` with only `homeNodeId`.
- Setting the current location to `/__shared__` sets `sharedExpanded` to `true`.
- Setting the current location to a shared folder node subtree sets `sharedExpanded` to `true`.
- Setting the current location to `/__recent__` sets `recentExpanded` to `true`.
- `handleSharedToggle` toggles `sharedExpanded` and calls `onNodeClick` for the `/__shared__` route when transitioning to expanded.
- `handleRecentClick` and `handleSharedFolderClick` navigate through the host callback with the expected location (virtual-root route / nodeId).

### 2.8 Edge Cases

- `currentNodeId` is empty/falsy: `expandedNodeIds` contains only `homeNodeId`.
- Shared permission entries are keyed by nodeId; the shared-tree builder no longer normalizes synthetic paths. Shared folders with the same nodeId must not duplicate.

