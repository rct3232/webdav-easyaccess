# FolderTree Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Main folder tree: home, shared, recent, share links. Uses BaseFolderTreeItem, SharedFoldersSection, RecentFilesSection, ShareLinkSection. Loads shared folders, recent files. |
| Used in | FileManager |
| Related components | BaseFolderTreeItem, SharedFoldersSection, RecentFilesSection, ShareLinkSection, listFiles, getUserPermissions |

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
| hasWritePermission | boolean | N | - | Write permission |
| onExplorerDrop | function | N | - | Drop handler |
| isMobile | boolean | N | false | Mobile |
| shareLinkSection | ReactNode | N | - | Share link section |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onPathClick | Folder click | (path) |
| onFileClick | Recent file click | (file) |
| onExplorerDrop | Drop | - |

### 2.4 Dependencies

- **imports:** BaseFolderTreeItem, SharedFoldersSection, RecentFilesSection, ShareLinkSection, getRecentFiles, onRecentFilesChange (recentFiles), normalizePath (pathUtils), getUserBaseFolder, filterOutUserOwnFolders (userUtils), getUserPermissions (permissionService)
- **Reference implementation:** `client/src/components/folder-tree/FolderTree.js`

### 2.5 i18n Keys

- nav.*, fileManager.*

### 2.6 Conditional Rendering

- Admin: home at /
- Non-admin: user home path
- Shared/recent sections expandable
- shareLinkSection when provided

### 2.7 Verification Scenarios

- [ ] Path click, file click
- [ ] Create folder, upload
- [ ] Shared/recent sections
- [ ] Drop handler

### 2.8 Edge Cases

- !user: recent files cleared
