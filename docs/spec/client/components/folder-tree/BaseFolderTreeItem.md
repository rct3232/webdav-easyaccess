# BaseFolderTreeItem Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Folder tree item view: renders a folder row with expand/collapse affordance, highlights current path, and wires drop/drag callbacks provided by the host. Supports `path`/`name` or `node`. |
| Used in | FolderTree, SharedFoldersSection |
| Related components | `FolderTree`, `SharedFoldersSection`, `FileTreeSkeleton` |
| Ownership note | This component is primarily a **view** + interaction wiring. In Phase 4, child loading, permission derivation, tree-update reconciliation, and DnD policy are delegated to `useFolderTreeItemController`, without changing observable behavior. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/BaseFolderTreeItem.js`
- **Test file:** `client/src/components/folder-tree/__tests__/BaseFolderTreeItem.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| path | string | N* | - | Path (* or node) |
| name | string | N* | - | Name (* or node) |
| node | object | N* | - | Node { path, name } (* or path/name) |
| level | number | N | 0 | Indent level |
| currentPath | string | Y | - | Current path |
| onPathClick | function | Y | - | Path click |
| expandedPaths | Set | Y | - | Expanded paths |
| onToggleExpand | function | Y | - | Toggle expand |
| hasReadPermission | boolean | N | true | Read permission |
| hasWritePermission | boolean | N | true | Write permission |
| onExplorerDrop | function | N | - | Drop handler (OS files) |
| onInternalFileDrop | function | N | - | Internal drag drop: (draggedPath, targetFolderPath) when file/folder dropped from file manager |
| onInternalDragStart | function | N | - | Called when drag starts: (path) => void. Lets host know dragged path (e.g. to hide content-area overlay when drop would be no-op). |
| onInternalDragEnd | function | N | - | Called when drag ends: () => void. Clears host state tied to tree drag. |
| internalDraggedPath | string | N | - | Internal drag source path used by drop no-op logic |
| isMobile | boolean | N | false | Mobile |
| icon | ReactNode | N | - | Custom icon |
| openIcon | ReactNode | N | - | Open icon |
| children | array | N | [] | Initial children |
| treeUpdateTrigger | any | N | - | Reload trigger |
| isHome | boolean | N | false | Is home |
| renderChild | function | N | - | Render child |
| sharedFoldersMap | Map | N | - | Shared folders map |
| isHidden | boolean | N | false | Hidden item |
| user | object | N | - | Current user |
| useHiddenFilesFilter | boolean | N | true | Filter hidden |
| listFilesOptions | object | N | - | listFiles options |
| filterChildNames | string[] | N | - | Child-name denylist forwarded to the controller/gateway |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onPathClick | Folder click | (path) |
| onToggleExpand | Expand/collapse | (path) |
| onExplorerDrop | Drop (OS files) | - |
| onInternalFileDrop | Internal drop (file manager) | (draggedPath, targetFolderPath) |

### 2.4 Dependencies

- **Allowed imports:** presentational components, pure utilities, and the controller hook `useFolderTreeItemController`.
- **Avoid (target contract):** direct file listing/service calls and direct DnD wiring (`useDropToUpload`) inside the view. Child-loading, drop-to-upload wiring, and reconciliation are owned by `useFolderTreeItemController`.
- **Reference implementation:** `client/src/components/folder-tree/BaseFolderTreeItem.js`

### 2.5 i18n Keys

- None direct

### 2.6 Conditional Rendering

- Recursive children when expanded
- Permission from node or sharedFoldersMap
- Loading: FileTreeSkeleton
- **Drag source:** When not `isMobile` and not disabled, the item is `draggable={true}` and the controller-provided `onDragStart` sets `e.dataTransfer.setData('text/plain', path)` (and optionally a custom type) so the file manager can accept drops from the tree.

### 2.7 Verification Scenarios

- [ ] Expand, path click
- [ ] Drop handler
- [ ] Permission-based disable

### 2.8 Display

- Folder name: long names are truncated with CSS ellipsis (`overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`). Tooltip with full name is shown on hover only when the name is truncated (detected via `scrollWidth` > `clientWidth` and ResizeObserver).

### 2.9 Edge Cases

- path/name or node – either required
- sharedFoldersMap overrides permission
- **Permission (cross-DnD):** When used as drop target, hasWritePermission is already enforced by `useDropToUpload` inside `useFolderTreeItemController` (no-write nodes are not highlighted, no onInternalFileDrop). When used as drag source, draggable is off when isDisabled (no read).
