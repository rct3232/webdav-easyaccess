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
| currentPath | string | Y | - | Current path |
| onPathClick | function | Y | - | Path click |
| onFileClick | function | N | - | File click (recent) |
| user | object | Y | - | User |
| treeUpdateTrigger | any | N | - | Trigger reload |
| hasWritePermission | boolean | N | - | Compatibility prop accepted by host surfaces; Phase 4 `FolderTree` view does not consume it directly |
| onExplorerDrop | function | N | - | Drop handler (OS files) |
| onInternalFileDrop | function | N | - | Internal drag: (draggedPath, targetFolderPath) when dropped from file manager |
| isMobile | boolean | N | false | Mobile |
| shareLinkSection | ReactNode | N | - | Share link section |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onPathClick | Folder click | (path) |
| onFileClick | Recent file click | (file) |
| onExplorerDrop | Drop (OS files) | - |
| onInternalFileDrop | Internal drop (file manager) | (draggedPath, targetFolderPath) |

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

- Admin: home at /
- Non-admin: user home path
- Shared/recent sections expandable
- shareLinkSection when provided

### 2.7 Verification Scenarios

- [ ] Clicking a folder calls `onPathClick(path)` with the clicked folder’s path.
- [ ] Clicking a recent file entry (if rendered) calls `onFileClick(file)` with the same file object used by the section.
- [ ] Shared and recent sections render when the hosting surface provides the required inputs/sections (product overlays remain product-owned).
- [ ] External drop handler calls `onExplorerDrop` when OS-file drop occurs (if enabled).
- [ ] Internal DnD drop calls `onInternalFileDrop(draggedPath, targetFolderPath)` only for valid targets (permission/no-op rules remain unchanged).

### 2.8 Edge Cases

- !user: recent files cleared
