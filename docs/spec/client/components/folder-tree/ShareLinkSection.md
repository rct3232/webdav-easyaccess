# ShareLinkSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Section for share link root (like `__shared__`/`__recent__`). Shows the share link root and its children via `BaseFolderTreeItem`. Loads root children through `folderTreeGateway.listFolderChildren`. |
| Used in | FolderTree (share link view) |
| Related components | BaseFolderTreeItem, folderTreeGateway |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/ShareLinkSection.js`
- **Test file:** `client/src/components/folder-tree/__tests__/ShareLinkSection.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| shareRootPath | string | Y | - | Share root path |
| shareRootName | string | Y | - | Display name |
| shareToken | string | N | - | Share token |
| currentPath | string | Y | - | Current path |
| onShareLinkPathClick | function | Y | - | Path click |
| isMobile | boolean | N | false | Mobile |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onShareLinkPathClick | Path click | (path) |

### 2.4 Dependencies

- **imports:** BaseFolderTreeItem, `folderTreeGateway`, `normalizePath`
- **Reference implementation:** `client/src/components/folder-tree/ShareLinkSection.js`

### 2.5 i18n Keys

- From share/nav

### 2.6 Conditional Rendering

- Expands parent paths when currentPath under root
- Loads root children through `folderTreeGateway.listFolderChildren({ path, listFilesOptions: { shareToken } })`

### 2.7 Verification Scenarios

- [ ] Path click
- [ ] Expand when currentPath in tree
- [ ] Root children loaded
- [ ] Root children request is routed through `folderTreeGateway` with the provided `shareToken`

### 2.8 Edge Cases

- shareRootPath normalized
- currentPath outside root – no segments
