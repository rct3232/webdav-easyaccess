# useFolderTreeItemController Spec

## 1. Overview

| Item                     | Description                                                                                                                                                           |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Controller hook for a single folder-tree item: resolves permissions, lazy-loads children, wires DnD drop-to-upload handlers, and reconciles children on tree updates. |
| Used by components/pages | `client/src/components/folder-tree/BaseFolderTreeItem.js`                                                                                                             |
| Related components       | `BaseFolderTreeItem`                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/hooks/useFolderTreeItemController.js`
- **Test file:** `client/src/components/folder-tree/hooks/__tests__/useFolderTreeItemController.test.js`

> **NodeId-first controller:** the controller uses nodeId-first state — `nodeId`, `currentNodeId`, `expandedNodeIds`, `onNodeClick(nodeId)`, `onToggleExpand(nodeId)` — and the drag source writes `text/plain` = `String(nodeId)` (unifying with `useDragAndDrop`). `useDropToUpload` is wired with `nodeId` so `isFolderMode` activates.

### 2.2 Input Parameters

| Name                  | Type     | Required | Description                                                                                         |
| --------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------- | --------- | ---------------- |
| path                  | string   | N        | Folder path fallback (used when `node` is not provided; transitional — superseded by `node.nodeId`) |
| name                  | string   | N        | Folder display name (used when `node` is not provided)                                              |
| node                  | object   | N        | Node `{ nodeId, name, isHidden, hasReadPermission, hasWritePermission, children }`                  |
| level                 | number   | N        | Indent level (kept for API completeness; controller may not use)                                    |
| currentNodeId         | number   | Y        | Current explorer node id for auto-expansion/highlighting                                            |
| expandedNodeIds       | Set      | Y        | Expanded node id set                                                                                |
| onToggleExpand        | function | Y        | Toggle expanded state for a node id: `(nodeId) => void`                                             |
| onNodeClick           | function | Y        | Folder click callback: `(nodeId) => void` (called when enabled)                                     |
| hasReadPermission     | boolean  | N        | Defaults to true                                                                                    |
| hasWritePermission    | boolean  | N        | Defaults to true                                                                                    |
| onExplorerDrop        | function | N        | OS-file drop handler (folder-tree mode)                                                             |
| onInternalFileDrop    | function | N        | Internal drag/drop: `(draggedNodeId, targetNodeId)`                                                 |
| onInternalDragStart   | function | N        | Called when drag starts: `(nodeId) => void`                                                         |
| onInternalDragEnd     | function | N        | Called when drag ends: `() => void`                                                                 |
| internalDraggedNodeId | number   | N        | Last internal drag source node id for drop no-op logic                                              |
| isMobile              | boolean  | N        | Defaults to false                                                                                   |
| children              | array    | N        | Initial children (used when `node?.children` is not provided)                                       |
| treeUpdateTrigger     | any      | N        | Reload trigger: { type: 'created'                                                                   | 'deleted' | 'refresh', ... } |
| isHome                | boolean  | N        | If true, allows refresh reload even when not currently expanded                                     |
| user                  | object   | N        | Included for compatibility with existing item props; not used directly in Phase 4 controller logic  |
| sharedFoldersMap      | Map      | N        | Shared-folder permission map keyed by nodeId that can override permissions                          |
| useHiddenFilesFilter  | boolean  | N        | Defaults to true                                                                                    |
| listFilesOptions      | object   | N        | Options forwarded to `folderTreeGateway.listFolderChildren`                                         |
| filterChildNames      | string[] | N        | Optional child-name denylist forwarded to `folderTreeGateway.listFolderChildren`                    |

### 2.3 Return Value / State

| Key                   | Type     | Meaning                                                                          |
| --------------------- | -------- | -------------------------------------------------------------------------------- |
| nodeId                | number   | Resolved folder node id                                                          |
| name                  | string   | Resolved folder display name                                                     |
| isHidden              | boolean  | Resolved hidden flag                                                             |
| hasReadPermission     | boolean  | Resolved read permission                                                         |
| hasWritePermission    | boolean  | Resolved write permission                                                        |
| children              | array    | Current children list                                                            |
| loading               | boolean  | Lazy-loading in progress                                                         |
| hasLoaded             | boolean  | Whether children have been loaded at least once                                  |
| isExpanded            | boolean  | Whether `expandedNodeIds` contains `nodeId`                                      |
| isCurrent             | boolean  | Whether `currentNodeId === nodeId`                                               |
| hasChildren           | boolean  | Whether `children.length > 0`                                                    |
| showExpandIcon        | boolean  | Whether expand affordance should be visible                                      |
| isDisabled            | boolean  | Whether item is disabled (no read permission)                                    |
| isDropTarget          | boolean  | From `useDropToUpload`                                                           |
| isDraggingOver        | boolean  | From `useDropToUpload`                                                           |
| handleFolderDragOver  | function | Drop-to-upload drag over handler                                                 |
| handleFolderDragEnter | function | Drop-to-upload drag enter handler                                                |
| handleFolderDragLeave | function | Drop-to-upload drag leave handler                                                |
| handleFolderDrop      | function | Drop-to-upload drop handler                                                      |
| handleClick           | function | Folder click handler: `onNodeClick(nodeId)` (respects disabled)                  |
| handleToggle          | function | Expand/collapse handler: `onToggleExpand(nodeId)` (and initial load)             |
| handleDragStart       | function | Drag start handler for tree drag source (writes `text/plain` = `String(nodeId)`) |
| handleDragEnd         | function | Drag end handler for tree drag source                                            |

### 2.4 Dependencies

- Services called:
  - `client/src/services/folderTreeGateway.listFolderChildren` (called with `nodeId`)
- Other hooks:
  - `client/src/hooks/useDropToUpload` (wired with `nodeId` so `isFolderMode` activates)
- Ownership note:
  - Permission derivation, lazy child loading, tree-update reconciliation, and tree-item DnD wiring belong here rather than in `BaseFolderTreeItem`.

### 2.5 Side Effects

- Lazy-loads children via `folderTreeGateway.listFolderChildren` when:
  - the item is expanded (`expandedNodeIds.has(nodeId)`),
  - children have not been loaded (`!hasLoaded`),
  - and no load is currently running (`!loading`).
- Ancestor auto-expansion is owned by `useFolderTreeController` (its `expandedNodeIds` includes the current node's ancestor node ids from the shell-provided `ancestors`); the item expands according to `expandedNodeIds`.
- Reconciles children when `treeUpdateTrigger` changes:
  - `created`: inserts a new child under `parentNodeId === nodeId` and expands if needed
  - `deleted`: removes a child by `nodeId`
  - `refresh`: reloads children when expanded or `isHome` is true

### 2.6 Error Handling

- If `listFolderChildren` throws:
  - logs `console.error`
  - sets `children` to `[]`
  - sets `hasLoaded` to `true` (so repeated failures do not retry automatically)
  - clears `loading`

### 2.7 Verification Scenarios

- [ ] When expanded and never loaded, lazy loading calls `folderTreeGateway.listFolderChildren` with the item `nodeId` and renders children in `BaseFolderTreeItem`.
- [ ] `treeUpdateTrigger.type === 'created'` adds a missing child (deduped by `child.nodeId`) and expands when needed.
- [ ] `treeUpdateTrigger.type === 'deleted'` removes the matching child by `nodeId`.
- [ ] `treeUpdateTrigger.type === 'refresh'` reloads when expanded or when `isHome` is true.
- [ ] Node permission fields win over fallback permission derivation from `sharedFoldersMap`.
- [ ] Drag start writes `e.dataTransfer.setData('text/plain', String(nodeId))` only when the item is enabled and not mobile; drag end notifies the host cleanup callback.
- [ ] `useDropToUpload` receives `nodeId` so `isFolderMode` activates for folder-tree drops.

### 2.8 Edge Cases

- `path/name` can be provided either directly or via `node` (the nodeId end-state resolves `nodeId` from `node?.nodeId`).
- `sharedFoldersMap` (keyed by nodeId) can override permission derivation when `node` does not carry permission fields.
- Refresh reload should not happen for non-expanded nodes when `isHome` is false.
- Disabled items do not navigate and are not draggable.
