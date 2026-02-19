# ShareFolderTree Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Recursive folder tree for share dialog. Shows expand/collapse, permissions, add/edit actions. Uses folderTree Map. |
| Used in | ShareDialog |
| Related components | FileTreeSkeleton, PERMISSIONS |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareFolderTree.js`
- **Test file:** `client/src/components/__tests__/ShareFolderTree.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| rootPath | string | Y | - | Root path |
| folderTree | Map | Y | - | Path -> node map |
| expandedPaths | Set | Y | - | Expanded paths |
| loadingPaths | Set | Y | - | Loading paths |
| toggleExpand | function | Y | - | Toggle expand |
| folderPermissions | object | Y | - | Folder permissions |
| isAdminMode | boolean | Y | - | Admin mode |
| userId | string | N | - | Target user ID |
| user | object | N | - | User |
| userInfoMap | object | Y | - | User info map |
| users | array | N | - | Users list |
| getUserName | function | Y | - | Get username |
| hasPermissionChanged | boolean | Y | - | Has changes |
| setFolderMenuAnchor | function | Y | - | Menu anchor |
| setFolderMenuPath | function | Y | - | Menu path |
| loadingPermissions | boolean | Y | - | Loading |
| isMobile | boolean | Y | - | Mobile |
| level | number | N | 0 | Indent level |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| toggleExpand | Expand/collapse | (path) |
| setFolderMenuAnchor | Menu open | - |
| setFolderMenuPath | Menu path | (path) |

### 2.4 Dependencies

- **imports:** FileTreeSkeleton, PERMISSIONS
- **Reference implementation:** `client/src/components/dialogs/ShareFolderTree.js`

### 2.5 i18n Keys

- dialogs.*, permissions.*

### 2.6 Conditional Rendering

- Recursive children when expanded
- GroupAdd/Edit icons for permissions
- isLoading: skeleton

### 2.7 Verification Scenarios

- [ ] Expand/collapse
- [ ] Permission display
- [ ] Menu open

### 2.8 Edge Cases

- node null – return null
