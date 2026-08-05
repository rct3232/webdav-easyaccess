# SharedFoldersSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Collapsible section for shared folders. Shows shared icon, expand/collapse. Renders BaseFolderTreeItem for each shared folder. Hidden for admin or when no shared folders. |
| Used in | FolderTree |
| Related components | BaseFolderTreeItem |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/SharedFoldersSection.js`
- **Test file:** `client/src/components/folder-tree/__tests__/SharedFoldersSection.test.js`

### 2.2 Props

> **Phase 4 nodeId end-state** (pending implementation in C2.3): shared-folder items are keyed and navigated by nodeId (the permissions API already returns nodeId). The current source still builds synthetic `/__shared__/<nodeId>` paths; that is transitional and is replaced below. The section header selection on the `/__shared__` virtual-root route is unchanged (decision D1 keeps virtual roots path-based).

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sharedFolders | array | Y | - | Shared folder list, each entry `{ nodeId, permission, name }` keyed by nodeId |
| sharedExpanded | boolean | Y | - | Section expanded |
| handleSharedToggle | function | Y | - | Toggle expand |
| handleSharedClick | function | Y | - | Section header click |
| currentNodeId | number | Y | - | Current folder node id (item highlighting) (target contract, pending implementation) |
| buildSharedFolderTree | function | Y | - | Build tree of `{ nodeId, name, children, parentNodeId, permission, hasReadPermission }` nodes |
| onNodeClick | function | Y | - | Folder click: `(nodeId) => void` (target contract, pending implementation) |
| expandedNodeIds | Set | Y | - | Expanded node id set (target contract, pending implementation) |
| onToggleExpand | function | Y | - | Toggle expand: `(nodeId) => void` |
| user | object | Y | - | User |
| treeUpdateTrigger | any | N | - | Reload trigger |
| onExplorerDrop | function | N | - | Drop |
| isMobile | boolean | N | false | Mobile |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| handleSharedToggle | Expand/collapse | - |
| handleSharedClick | Section click | - |
| onNodeClick | Folder click | (nodeId) |
| onToggleExpand | Folder expand | (nodeId) |

### 2.4 Dependencies

- **imports:** BaseFolderTreeItem
- **Reference implementation:** `client/src/components/folder-tree/SharedFoldersSection.js`

### 2.5 i18n Keys

- nav.sharedFolders

### 2.6 Conditional Rendering

- Returns null when user?.is_admin or sharedFolders.length === 0
- Section header selected on the `/__shared__` virtual-root route (unchanged per D1)
- Collapse for children

### 2.7 Verification Scenarios

- [ ] Renders when non-admin and shared folders exist
- [ ] Expand, node click
- [ ] Returns null for admin

### 2.8 Edge Cases

- sharedFolders empty – null
