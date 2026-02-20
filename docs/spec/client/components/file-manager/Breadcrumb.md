# Breadcrumb Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Path breadcrumb: path segments as chips. Shown on all viewports (mobile and desktop). shareRootPath: share mode (path within share). Optional folder tree toggle. Loads shared permission paths for path display. |
| Used in | FileManager |
| Related components | getUserPermissions, normalizePath, userUtils |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/Breadcrumb.js`
- **Test file:** `client/src/components/file-manager/__tests__/Breadcrumb.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| currentPath | string | Y | - | Current path |
| onPathClick | function | Y | - | Path chip click |
| user | object | N | - | User |
| onToggleFolderTree | function | N | - | Toggle folder tree |
| isFolderTreeOpen | boolean | N | - | Tree open |
| shareRootPath | string | N | - | Share root (share mode) |
| shareRootName | string | N | - | Share root name |
| showFolderTreeToggle | boolean | N | - | Show toggle |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onPathClick | Chip click | (path) |
| onToggleFolderTree | Toggle click | - |

### 2.4 Dependencies

- **imports:** getUserPermissions, normalizePath, isUserOwnFolder, filterOutUserOwnFolders
- **Reference implementation:** `client/src/components/file-manager/Breadcrumb.js`

### 2.5 i18n Keys

- nav.home, nav.sharedFolders, nav.recentFiles

### 2.6 Conditional Rendering

- shareRootPath: segments relative to share root
- __shared__/__recent__: no segments
- Home/shared/recent: special icons
- showFolderTreeToggle: up/down icon

### 2.7 Verification Scenarios

- [ ] Path segments, chip click
- [ ] Share mode path parsing
- [ ] Toggle folder tree

### 2.8 Edge Cases

- User own folder – no shared segments
- Horizontal scroll for long paths
