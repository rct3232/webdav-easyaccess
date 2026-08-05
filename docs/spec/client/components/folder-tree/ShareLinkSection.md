# ShareLinkSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Section for share link root (like `__shared__`/`__recent__`). Shows the share link root and its children via `BaseFolderTreeItem`. Loads root children through `folderTreeGateway.listFolderChildren`. |
| Used in | FolderTree (share link view) |
| Related components | BaseFolderTreeItem, folderTreeGateway |

> **Phase 4 nodeId end-state:** share-link mode is keyed by the share root **nodeId** (`shareRootNodeId` prop). When the root nodeId is absent (linkInfo does not yet carry it), a temporary `resolve-path` fallback resolves the share root path to a nodeId; the fallback is removed in Phase 5, once `GET /share-link/:token` returns a nodeId (task C2.5).

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/ShareLinkSection.js`
- **Test file:** `client/src/components/folder-tree/__tests__/ShareLinkSection.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| shareRootNodeId | number | Y | - | Share root node id |
| shareRootName | string | Y | - | Display name |
| shareToken | string | N | - | Share token |
| currentNodeId | number | Y | - | Current folder node id |
| onNodeClick | function | Y | - | Folder click: `(nodeId) => void` |
| isMobile | boolean | N | false | Mobile |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onNodeClick | Node click | (nodeId) |

### 2.4 Dependencies

- **imports:** BaseFolderTreeItem, `folderTreeGateway`, `normalizePath`
- **Reference implementation:** `client/src/components/folder-tree/ShareLinkSection.js`

### 2.5 i18n Keys

- From share/nav

### 2.6 Conditional Rendering

- Expands ancestor nodes when `currentNodeId` is under the share root
- Loads root children through `folderTreeGateway.listFolderChildren({ nodeId: shareRootNodeId, listFilesOptions: { shareToken } })` 

### 2.7 Verification Scenarios

- [ ] Node click
- [ ] Expand when current node in tree
- [ ] Root children loaded
- [ ] Root children request is routed through `folderTreeGateway` with the provided `shareToken` and the share root `nodeId`

### 2.8 Edge Cases

- share root nodeId absent: falls back to a temporary `resolve-path` shim (removed in Phase 5); returns null when neither `shareRootNodeId` nor `shareToken` is provided
- currentNodeId outside root – no segments
