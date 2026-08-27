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

> **Phase 4 nodeId end-state** (pending implementation in C2.3): the share dialog tree is keyed by **nodeId** — `rootNodeId`, `folderTree` Map keyed by nodeId, `expandedNodeIds`, `loadingNodeIds`, `toggleExpand(nodeId)`, permissions keyed by nodeId, and `setFolderMenuNodeId(nodeId)`. The current source still uses path keys (`rootPath`, `expandedPaths`, `toggleExpand(path)`, `setFolderMenuPath(path)`); those are transitional and are replaced below.

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| rootNodeId | number | Y | - | Root node id (target contract, pending implementation) |
| folderTree | Map | Y | - | NodeId -> node map (target contract, pending implementation) |
| expandedNodeIds | Set | Y | - | Expanded node ids (target contract, pending implementation) |
| loadingNodeIds | Set | Y | - | Loading node ids (target contract, pending implementation) |
| toggleExpand | function | Y | - | Toggle expand: `(nodeId) => void` (target contract, pending implementation) |
| folderPermissions | object | Y | - | Folder permissions map keyed by nodeId (target contract, pending implementation) |
| isAdminMode | boolean | Y | - | Admin mode |
| userId | string | N | - | Target user ID |
| user | object | N | - | User |
| userInfoMap | object | Y | - | User info map |
| users | array | N | - | Users list |
| getUserName | function | Y | - | Get username |
| hasPermissionChanged | boolean | Y | - | Has changes |
| setFolderMenuAnchor | function | Y | - | Menu anchor |
| setFolderMenuNodeId | function | Y | - | Menu node id (target contract, pending implementation) |
| loadingPermissions | boolean | Y | - | Loading |
| isMobile | boolean | Y | - | Mobile |
| level | number | N | 0 | Indent level |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| toggleExpand | Expand/collapse | (nodeId) |
| setFolderMenuAnchor | Menu open | - |
| setFolderMenuNodeId | Menu node id | (nodeId) |

### 2.4 Dependencies

- **imports:** `FileTreeSkeleton`, `deriveShareFolderAccessView`
- **Reference implementation:** `client/src/components/dialogs/ShareFolderTree.js`
- **Boundary:** The component must not create/remove global style tags or call `document.*`. Any hover-scroll behavior should use prepared CSS variables/handlers only.

### 2.5 i18n Keys

- `dialogs.*`, `permissions.*`

### 2.6 Conditional Rendering

- Recursive children when expanded (`expandedNodeIds.has(nodeId)`)
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
