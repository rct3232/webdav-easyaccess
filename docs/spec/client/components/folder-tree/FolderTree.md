# FolderTree Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Folder-tree UI for explorer surfaces: renders “home” plus optional product sections such as “shared”, “recent”, and share-link entries. Delegates tree-item rendering to `BaseFolderTreeItem` and section components. A **bottom-pinned trash row** sits below the tree lines (DEF-16 P9) — the trash entry is NOT a tree section and does not participate in tree expansion/DnD. |
| Used in            | FileManager page shell (see `docs/spec/client/pages/FileManager.md`) and other explorer-like surfaces where applicable.                                                                                                                                                                                                                                                           |
| Related components | `BaseFolderTreeItem`, `SharedFoldersSection`, `RecentFilesSection`, `ShareLinkSection`, `TrashSidebarItem`                                                                                                                                                                                                                                                                        |
| Ownership note     | This spec documents the **view/component contract**. Product overlays (virtual collections like `__recent__`, `__shared__`, share-link UI) remain **outside** reusable explorer core.                                                                                                                                                                                             |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/FolderTree.js`
- **Test file:** `client/src/components/folder-tree/__tests__/FolderTree.test.js`

### 2.2 Props

| Name               | Type      | Required | Default | Description                                                                                                                                                                                                                                                                                                       |
| ------------------ | --------- | -------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| currentNodeId      | number    | Y        | -       | Current folder node id                                                                                                                                                                                                                                                                                            |
| onNodeClick        | function  | Y        | -       | Folder click: `(nodeId) => void`                                                                                                                                                                                                                                                                                  |
| onLeaveShareClick  | function  | N        | -       | Share-mode folder click for non-share sections: `(nodeId: number \| path: string) => void`. When a `shareLinkSection` is present, the home / shared / recent sections call this instead of `onNodeClick`, so the hosting surface can open the leave-share confirmation. Falls back to `onNodeClick` when omitted. |
| onFileClick        | function  | N        | -       | File click (recent). Recent entries are nodeId-keyed; directory entries navigate via `onNodeClick(nodeId)`, file entries (carrying `nodeId`) are passed to `onFileClick`.                                                                                                                                         |
| user               | object    | Y        | -       | User                                                                                                                                                                                                                                                                                                              |
| treeUpdateTrigger  | any       | N        | -       | Trigger reload                                                                                                                                                                                                                                                                                                    |
| hasWritePermission | boolean   | N        | -       | Compatibility prop accepted by host surfaces; the `FolderTree` view does not destructure or consume it (the home item is rendered write-enabled unconditionally).                                                                                                                                                 |
| onExplorerDrop     | function  | N        | -       | Drop handler (OS files)                                                                                                                                                                                                                                                                                           |
| onInternalFileDrop | function  | N        | -       | Internal drag: `(draggedNodeId, targetNodeId)` when dropped from file manager                                                                                                                                                                                                                                     |
| isMobile           | boolean   | N        | false   | Mobile                                                                                                                                                                                                                                                                                                            |
| shareLinkSection   | ReactNode | N        | -       | Share link section                                                                                                                                                                                                                                                                                                |

### 2.3 Callback Signatures

| Callback           | When invoked                                                                              | Arguments                          |
| ------------------ | ----------------------------------------------------------------------------------------- | ---------------------------------- |
| onNodeClick        | Folder click                                                                              | (nodeId)                           |
| onLeaveShareClick  | Non-share section folder click while a share-link section is present (home/shared/recent) | (nodeId: number) or (path: string) |
| onFileClick        | Recent file click                                                                         | (file)                             |
| onExplorerDrop     | Drop (OS files)                                                                           | -                                  |
| onInternalFileDrop | Internal drop (file manager)                                                              | (draggedNodeId, targetNodeId)      |

### 2.4 Dependencies

- **Allowed imports:** presentational components, section views, and controller hooks that prepare section state/handlers for the view.
- **No direct service/IO imports inside the tree view component.** Shared/recent section coordination is delegated to `useFolderTreeController`; share-link section data loading goes through `folderTreeGateway`.
- **Reference implementation:** `client/src/components/folder-tree/FolderTree.js`
- **Related specs:**
  - `docs/spec/client/components/folder-tree/BaseFolderTreeItem.md`
  - `docs/spec/client/components/folder-tree/TrashSidebarItem.md`
  - `docs/spec/client/utils/recentFiles.md`

### 2.5 i18n Keys

- nav._, fileManager._

### 2.6 Conditional Rendering

- Admin: home root node
- Non-admin: user home node
- Shared/recent sections expandable
- shareLinkSection when provided

### 2.7 Home (leading) row

- Label: `nav.home` (홈 / Home) for **all roles and all modes** — never the acting user's
  username. (Admin home row label was already `nav.home`; non-admin row is relabeled from the
  username, see Breadcrumb spec §1.1 for the underlying home model.)
- Icon: the home icon is shown in **both collapsed and expanded states** (the home row passes an
  `openIcon`), so auto-expanding the home row never swaps the home icon for a generic folder icon.
- Click target semantics are unchanged: home row nodeId is `homeNodeId`
  (admin → `null` = filesystem root; non-admin → `user.rootNodeId`).

### 2.7.1 Bottom-pinned trash row (DEF-16 P9)

- Rendered by `TrashSidebarItem` **after the scrollable tree List**, pinned at the bottom of the
  sidebar column (footer block below the `flex: 1` tree area — not inside the `List`, no tree
  indent, no expansion/DnD). Covered by the same `(!shareLinkSection || user)` gating as the
  home/shared/recent sections (never rendered for anonymous share-link viewers).
- Row content: `{휴지통 아이콘} 휴지통` (i18n `nav.trash`; two-part custom SVG trash icon with an
  animated lid — see `TrashSidebarItem.md`).
- Selected state: tree-row-selected styling when `currentPath === '/__trash__'` (any trash depth).
- Click → `onNodeClick('/__trash__')` (in share-link mode the shared-scope routing sends it through
  the leave-share confirmation like the other non-share entries; after confirmation it navigates to
  `/files/__trash__`).

### 2.7 Verification Scenarios

- [ ] Clicking a folder calls `onNodeClick(nodeId)` with the clicked folder's node id.
- [ ] When a share-link section is present, clicking the home / shared / recent entries calls `onLeaveShareClick` (node id or virtual-root path) instead of `onNodeClick`; the share-link section itself still calls `onNodeClick`.
- [ ] Clicking a recent file entry (if rendered) calls `onFileClick(file)` with the same file object used by the section. Recent entries are nodeId-keyed.
- [ ] Shared and recent sections render when the hosting surface provides the required inputs/sections (product overlays remain product-owned).
- [ ] External drop handler calls `onExplorerDrop` when OS-file drop occurs (if enabled).
- [ ] Internal DnD drop calls `onInternalFileDrop(draggedNodeId, targetNodeId)` only for valid targets (permission/no-op rules remain unchanged).

### 2.8 Edge Cases

- !user: recent files cleared
