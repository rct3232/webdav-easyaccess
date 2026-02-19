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
- **Test file:** `client/src/components/__tests__/SharedFoldersSection.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| sharedFolders | array | Y | - | Shared folder list |
| sharedExpanded | boolean | Y | - | Section expanded |
| handleSharedToggle | function | Y | - | Toggle expand |
| handleSharedClick | function | Y | - | Section header click |
| currentPath | string | Y | - | Current path |
| buildSharedFolderTree | function | Y | - | Build tree |
| handleSharedFolderClick | function | Y | - | Folder click |
| expandedPaths | Set | Y | - | Expanded paths |
| handleToggleExpand | function | Y | - | Toggle expand |
| user | object | Y | - | User |
| treeUpdateTrigger | any | N | - | Reload trigger |
| onExplorerDrop | function | N | - | Drop |
| isMobile | boolean | N | false | Mobile |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| handleSharedToggle | Expand/collapse | - |
| handleSharedClick | Section click | - |
| handleSharedFolderClick | Folder click | (path) |
| handleToggleExpand | Folder expand | (path) |

### 2.4 Dependencies

- **imports:** BaseFolderTreeItem
- **Reference implementation:** `client/src/components/folder-tree/SharedFoldersSection.js`

### 2.5 i18n Keys

- nav.sharedFolders

### 2.6 Conditional Rendering

- Returns null when user?.is_admin or sharedFolders.length === 0
- Selected when currentPath === '/__shared__'
- Collapse for children

### 2.7 Verification Scenarios

- [ ] Renders when non-admin and shared folders exist
- [ ] Expand, path click
- [ ] Returns null for admin

### 2.8 Edge Cases

- sharedFolders empty – null
