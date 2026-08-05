# Breadcrumb Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | NodeId breadcrumb: renders the current folder's ancestor chain (`ancestors: [{ nodeId, name }]` supplied by the `GET /files/list` response) as chips. Shown on all viewports (mobile and desktop). shareRootPath: share mode (path within share). Optional folder tree toggle. |
| Used in | FileManager |
| Related components | `GET /files/list` `ancestors` chain |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/Breadcrumb.js`
- **Test file:** `client/src/components/file-manager/__tests__/Breadcrumb.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| ancestors | array | Y | - | Current folder's ancestor chain `[{ nodeId, name }]` from the `GET /files/list` response |
| onNodeClick | function | Y | - | Ancestor chip click (by nodeId) |
| user | object | N | - | User |
| onToggleFolderTree | function | N | - | Toggle folder tree |
| isFolderTreeOpen | boolean | N | - | Tree open |
| shareRootPath | string | N | - | Share root (share mode) |
| shareRootName | string | N | - | Share root name |
| showFolderTreeToggle | boolean | N | - | Show toggle |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onNodeClick | Ancestor chip click | (nodeId) |
| onToggleFolderTree | Toggle click | - |

> **Note (pending implementation):** The current source still derives segments from `currentPath` and loads shared-permission paths via `getUserPermissions`; the ancestor-chain render with nodeId clicks is the end-state.

### 2.4 Dependencies

- **imports:** the `ancestors` chain provided in the `GET /files/list` response (server builds it via the ancestor-chain helper)
- **Reference implementation:** `client/src/components/file-manager/Breadcrumb.js`
- No client-side shared-permission path loading is needed for segment derivation; segment names and nodeIds come from the server-provided ancestor chain.

### 2.5 i18n Keys

- nav.home, nav.sharedFolders, nav.recentFiles

### 2.6 Conditional Rendering

- shareRootPath: segments relative to share root
- __shared__/__recent__: no segments
- Home/shared/recent: special icons
- showFolderTreeToggle: up/down icon

### 2.7 Verification Scenarios

- [ ] Ancestor chain rendered from `ancestors`; chip click navigates by nodeId
- [ ] Share mode path parsing
- [ ] Toggle folder tree

### 2.8 Edge Cases

- User own folder – no shared segments
- Horizontal scroll for long chains
