# ShareFolderTree Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Recursive view for the share dialog folder tree. Renders expand/collapse state, folder labels, and prepared menu-button state for each node. Hover label animation must stay within prepared CSS/handler seams rather than direct document writes. |
| Used in | ShareDialog |
| Related components | `FileTreeSkeleton`, `PERMISSIONS` |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ShareFolderTree.js`
- **Test file:** `client/src/components/dialogs/__tests__/ShareFolderTree.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| rootPath | string | Y | - | Root path |
| folderTree | Map | Y | - | Path -> node map |
| expandedPaths | Set | Y | - | Expanded paths |
| loadingPaths | Set | Y | - | Loading paths |
| toggleExpand | function | Y | - | Toggle expand |
| folderPermissions | object | Y | - | Folder permissions map keyed by path |
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

- **imports:** `FileTreeSkeleton`, `deriveShareFolderAccessView`
- **Reference implementation:** `client/src/components/dialogs/ShareFolderTree.js`
- **Boundary:** The component must not create/remove global style tags or call `document.*`. Any hover-scroll behavior should use prepared CSS variables/handlers only.

### 2.5 i18n Keys

- `dialogs.*`, `permissions.*`

### 2.6 Conditional Rendering

- Recursive children when expanded
- Menu button reflects prepared permission-count / changed-state information
- Loading state renders skeleton/progress affordances
- User filtering and menu-button policy should be prepared upstream where possible; this component should stay primarily presentational
- Folder-name overflow animation may derive scroll distance from the hovered node, but keyframes/style ownership must remain outside `document` mutation paths

### 2.7 Verification Scenarios

- [ ] Expand/collapse
- [ ] Permission-count/menu button display
- [ ] Owner-locked button behavior in admin mode
- [ ] Changed-state badge rendering
- [ ] Menu open
- [ ] Overflowing folder labels animate on hover without requiring direct `document` access in the component

### 2.8 Edge Cases

- node null – return null
- Loading node without children should render a tree skeleton row
