# BaseFolderTreeItem Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Unified folder tree item: expand/collapse, path click, drop. Supports path/name or node. Used for home tree and shared folders. |
| Used in | FolderTree, SharedFoldersSection |
| Related components | listFiles, useDropToUpload, FileTreeSkeleton |

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
| onExplorerDrop | function | N | - | Drop handler |
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
| filterChildNames | function | N | - | Filter child names |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onPathClick | Folder click | (path) |
| onToggleExpand | Expand/collapse | (path) |
| onExplorerDrop | Drop | - |

### 2.4 Dependencies

- **imports:** listFiles, useDropToUpload, FileTreeSkeleton, getShowHiddenFiles
- **Reference implementation:** `client/src/components/folder-tree/BaseFolderTreeItem.js`

### 2.5 i18n Keys

- None direct

### 2.6 Conditional Rendering

- Recursive children when expanded
- Permission from node or sharedFoldersMap
- Loading: FileTreeSkeleton

### 2.7 Verification Scenarios

- [ ] Expand, path click
- [ ] Drop handler
- [ ] Permission-based disable

### 2.8 Display

- Folder name: long names are truncated with CSS ellipsis (`overflow: hidden`, `textOverflow: ellipsis`, `whiteSpace: nowrap`). Tooltip with full name is shown on hover only when the name is truncated (detected via `scrollWidth` > `clientWidth` and ResizeObserver).

### 2.9 Edge Cases

- path/name or node – either required
- sharedFoldersMap overrides permission
