# FolderTree Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Folder-tree UI for explorer surfaces: renders “home” plus optional product sections such as “shared”, “recent”, and share-link entries. Delegates tree-item rendering to `BaseFolderTreeItem` and section components. |
| Used in | FileManager page shell (see `docs/spec/client/pages/FileManager.md`) and other explorer-like surfaces where applicable. |
| Related components | `BaseFolderTreeItem`, `SharedFoldersSection`, `RecentFilesSection`, `ShareLinkSection` |
| Ownership note | This spec documents the **view/component contract**. Product overlays (virtual collections like `__recent__`, `__shared__`, share-link UI) remain **outside** reusable explorer core. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/FolderTree.js`
- **Test file:** `client/src/components/folder-tree/__tests__/FolderTree.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| currentNodeId | number | Y | - | Current folder node id |
| onNodeClick | function | Y | - | Folder click: `(nodeId) => void` |
| onLeaveShareClick | function | N | - | Share-mode folder click for non-share sections: `(nodeId: number \| path: string) => void`. When a `shareLinkSection` is present, the home / shared / recent sections call this instead of `onNodeClick`, so the hosting surface can open the leave-share confirmation. Falls back to `onNodeClick` when omitted. |
| onFileClick | function | N | - | File click (recent). Recent entries carry `nodeId` (nodeId-first since Phase 5) |
| user | object | Y | - | User |
| treeUpdateTrigger | any | N | - | Trigger reload |
| hasWritePermission | boolean | N | - | Compatibility prop accepted by host surfaces; Phase 4 `FolderTree` view does not consume it directly |
| onExplorerDrop | function | N | - | Drop handler (OS files) |
| onInternalFileDrop | function | N | - | Internal drag: `(draggedNodeId, targetNodeId)` when dropped from file manager |
| isMobile | boolean | N | false | Mobile |
| shareLinkSection | ReactNode | N | - | Share link section |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onNodeClick | Folder click | (nodeId) |
| onLeaveShareClick | Non-share section folder click while a share-link section is present (home/shared/recent) | (nodeId: number) or (path: string) |
| onFileClick | Recent file click | (file) |
| onExplorerDrop | Drop (OS files) | - |
| onInternalFileDrop | Internal drop (file manager) | (draggedNodeId, targetNodeId) |

### 2.4 Dependencies

- **Allowed imports:** presentational components, section views, and controller hooks that prepare section state/handlers for the view.
- **Avoid (target contract):** direct service/IO imports inside the tree view component. Shared/recent section coordination belongs to `useFolderTreeController`; share-link section loading must go through `folderTreeGateway`.
- **Reference implementation:** `client/src/components/folder-tree/FolderTree.js`
- **Related specs:**
  - `docs/spec/client/components/folder-tree/BaseFolderTreeItem.md`
  - `docs/spec/client/utils/recentFiles.md`

### 2.5 i18n Keys

- nav.*, fileManager.*

### 2.6 Conditional Rendering

- Admin: home root node 
- Non-admin: user home node 
- Shared/recent sections expandable
- shareLinkSection when provided

### 2.7 Verification Scenarios

- [ ] Clicking a folder calls `onNodeClick(nodeId)` with the clicked folder's node id.
- [ ] When a share-link section is present, clicking the home / shared / recent entries calls `onLeaveShareClick` (node id or virtual-root path) instead of `onNodeClick`; the share-link section itself still calls `onNodeClick`.
- [ ] Clicking a recent file entry (if rendered) calls `onFileClick(file)` with the same file object used by the section. Recent entries are nodeId-first since Phase 5.
- [ ] Shared and recent sections render when the hosting surface provides the required inputs/sections (product overlays remain product-owned).
- [ ] External drop handler calls `onExplorerDrop` when OS-file drop occurs (if enabled).
- [ ] Internal DnD drop calls `onInternalFileDrop(draggedNodeId, targetNodeId)` only for valid targets (permission/no-op rules remain unchanged).

### 2.8 Edge Cases

- !user: recent files cleared
