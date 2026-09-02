# BaseFolderTreeItem Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Folder tree item view: renders a folder row with expand/collapse affordance, highlights current path, and wires drop/drag callbacks provided by the host. Supports `path`/`name` or `node`.                                                     |
| Used in            | FolderTree, SharedFoldersSection                                                                                                                                                                                                                |
| Related components | `FolderTree`, `SharedFoldersSection`, `FileTreeSkeleton`                                                                                                                                                                                        |
| Ownership note     | This component is primarily a **view** + interaction wiring. Child loading, permission derivation, tree-update reconciliation, and DnD policy are delegated to `useFolderTreeItemController`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/BaseFolderTreeItem.js`
- **Test file:** `client/src/components/folder-tree/__tests__/BaseFolderTreeItem.test.js`

### 2.2 Props

| Name                  | Type      | Required | Default | Description                                                                                                                                   |
| --------------------- | --------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| path                  | string    | N\*      | -       | Path fallback (\* or node; used when `node` is not provided — legacy fallback retained)                                                       |
| name                  | string    | N\*      | -       | Name (\* or node)                                                                                                                             |
| node                  | object    | N\*      | -       | Node `{ nodeId, name, isHidden, hasReadPermission, hasWritePermission, children }` (\* or path/name)                                          |
| level                 | number    | N        | 0       | Indent level                                                                                                                                  |
| currentNodeId         | number    | Y        | -       | Current folder node id                                                                                                                        |
| onNodeClick           | function  | Y        | -       | Folder click: `(nodeId) => void`                                                                                                              |
| expandedNodeIds       | Set       | Y        | -       | Expanded node id set                                                                                                                          |
| onToggleExpand        | function  | Y        | -       | Toggle expand: `(nodeId) => void`                                                                                                             |
| hasReadPermission     | boolean   | N        | true    | Read permission                                                                                                                               |
| hasWritePermission    | boolean   | N        | true    | Write permission                                                                                                                              |
| onExplorerDrop        | function  | N        | -       | Drop handler (OS files)                                                                                                                       |
| onInternalFileDrop    | function  | N        | -       | Internal drag drop: `(draggedNodeId, targetNodeId)` when file/folder dropped from file manager                                                |
| onInternalDragStart   | function  | N        | -       | Called when drag starts: `(nodeId) => void`. Lets host know the dragged node id (e.g. to hide content-area overlay when drop would be no-op). |
| onInternalDragEnd     | function  | N        | -       | Called when drag ends: `() => void`. Clears host state tied to tree drag.                                                                     |
| internalDraggedNodeId | number    | N        | -       | Internal drag source node id used by drop no-op logic                                                                                         |
| isMobile              | boolean   | N        | false   | Mobile                                                                                                                                        |
| icon                  | ReactNode | N        | -       | Custom icon                                                                                                                                   |
| openIcon              | ReactNode | N        | -       | Open icon                                                                                                                                     |
| children              | array     | N        | []      | Initial children                                                                                                                              |
| treeUpdateTrigger     | any       | N        | -       | Reload trigger                                                                                                                                |
| isHome                | boolean   | N        | false   | Is home                                                                                                                                       |
| renderChild           | function  | N        | -       | Render child                                                                                                                                  |
| sharedFoldersMap      | Map       | N        | -       | Shared folders map keyed by nodeId                                                                                                            |
| isHidden              | boolean   | N        | false   | Hidden item                                                                                                                                   |
| user                  | object    | N        | -       | Current user                                                                                                                                  |
| useHiddenFilesFilter  | boolean   | N        | true    | Filter hidden                                                                                                                                 |
| listFilesOptions      | object    | N        | -       | listFiles options                                                                                                                             |
| filterChildNames      | string[]  | N        | -       | Child-name denylist forwarded to the controller/gateway                                                                                       |

### 2.3 Callback Signatures

| Callback           | When invoked                 | Arguments                     |
| ------------------ | ---------------------------- | ----------------------------- |
| onNodeClick        | Folder click                 | (nodeId)                      |
| onToggleExpand     | Expand/collapse              | (nodeId)                      |
| onExplorerDrop     | Drop (OS files)              | -                             |
| onInternalFileDrop | Internal drop (file manager) | (draggedNodeId, targetNodeId) |

### 2.4 Dependencies

- **Allowed imports:** presentational components, pure utilities, and the controller hook `useFolderTreeItemController`.
- **No direct file listing/service calls or direct DnD wiring (`useDropToUpload`) inside the view.** Child-loading, drop-to-upload wiring, and reconciliation are owned by `useFolderTreeItemController`.
- **Reference implementation:** `client/src/components/folder-tree/BaseFolderTreeItem.js`

### 2.5 i18n Keys

- None direct

### 2.6 Conditional Rendering

- Recursive children when expanded
- Permission from node or sharedFoldersMap
- Loading: FileTreeSkeleton
- **Drag source:** When not `isMobile` and not disabled, the item is `draggable={true}` and the controller-provided `onDragStart` sets `e.dataTransfer.setData('text/plain', String(nodeId))` (and optionally a custom type) so the file manager can accept drops from the tree.

### 2.7 Verification Scenarios

- [ ] Expand, node click
- [ ] Drop handler
- [ ] Permission-based disable

### 2.8 Display

- Folder name: long names are truncated with CSS ellipsis (`overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`). Tooltip with full name is shown on hover only when the name is truncated (detected via `scrollWidth` > `clientWidth` and ResizeObserver).

### 2.9 Edge Cases

- path/name or node – either required
- sharedFoldersMap overrides permission (keyed by nodeId)
- **Permission (cross-DnD):** When used as drop target, hasWritePermission is already enforced by `useDropToUpload` inside `useFolderTreeItemController` (no-write nodes are not highlighted, no onInternalFileDrop). When used as drag source, draggable is off when isDisabled (no read).
