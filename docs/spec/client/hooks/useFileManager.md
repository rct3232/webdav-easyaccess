# useFileManager Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Transitional FileManager listing/path hook: owns currentPath, files, loading, hasWritePermission, and current listing-related state while the monolith is being split. It is a legacy integration point, not the long-term owner of explorer session, commands, progress, or product overlays. |
| Used by components/pages | FileManager page shell (current implementation) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useFileManager.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useFileManager.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| user | object | Y | Current user |
| options | object | N | onLoadComplete, onLoadError, shareToken, linkInfo |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| currentPath | string | Current path |
| setCurrentPath | (path) => void | Set path (navigate or share state) |
| files | array | File list |
| loading | boolean | Loading |
| sortMode | string | Legacy transitional output. Target ownership moves to `useExplorerSession`. |
| setSortMode | function | Legacy transitional setter. Target ownership moves to `useExplorerSession`. |
| hasWritePermission | boolean | Write permission |
| webdavUrl | string | WebDAV URL |
| loadFiles | () => Promise | Reload files |
| onLoadErrorRef | ref | Ref for onLoadError callback (for external updates) |

### 2.4 Boundaries

- **Currently owns**
  - Path source of truth for FileManager (`currentPath`, `setCurrentPath`)
  - File listing state (`files`, `loading`, `loadFiles`)
  - Write-permission state for the current path
  - Transitional special-path handling that still exists in the current monolith
- **Does not own in target architecture**
  - Search/sort/view-mode derived explorer session state (`useExplorerSession`)
  - Navigation orchestration and optimistic rollback (`useExplorerNavigation`)
  - Operation orchestration (`useExplorerCommands`)
  - Progress drawer/retry/cancel coordination (`useExplorerProgress`)
  - Long-term ownership of product overlays such as share-link policy and virtual collections

### 2.5 Dependencies

- listFiles, getWebDAVInfo, checkPermission, listFilePermissions, getFilesMetadata
- recentFilesRepository (`getRecentFiles`)
- getUserPermissions, getShowHiddenFiles, getSortMode (localStorage)
- normalizePath, getParentPath, getBasename (pathUtils)
- filterOutUserOwnFolders (userUtils)
- HTTP_STATUS (shared constants)
- useParams, useNavigate

### 2.5.1 Test Mock Strategy

- Use shared client test mock helpers for repeated dependencies (fileService, permissionService, recentFiles, router navigate).
- Keep `useFileManager` tests focused on observable state transitions (`currentPath`, `files`, `loading`, permission flags) and navigation effects.
- Prefer per-test override of service responses instead of redefining whole mock modules in each test file.
- If migrating portions to MSW, keep router and local UI helper mocks at module level and use MSW only for stable API interactions.

### 2.6 Side Effects

- listFiles on currentPath change
- __recent__: getRecentFiles + getFilesMetadata
- In the `__recent__` view, repository entries may include `lastAccessed`; the hook maps that field into the listing model when present.
- __shared__: getUserPermissions + listFilePermissions for shared folders, filter top-level
- For shared request dedupe and TTL memoization behavior, see `docs/spec/client/services/permissionService.md`.
- shareToken: listFiles with shareToken
- Navigate on setCurrentPath (non-share mode)
- FileManager shell may subscribe to `recentFilesNotifier` while `currentPath === '/__recent__'` and call `loadFiles()` when recent-file change events are published.

### 2.7 Error Handling

- onLoadError callback
- requestIdRef for stale request guard

### 2.8 Verification Scenarios

- [ ] Load files on path change
- [ ] __recent__ flow
- [ ] While viewing `__recent__`, notifier-driven recent-file changes trigger a reload through the shell integration.
- [ ] __shared__ flow (shared folders, file-only permissions) remains stable until overlay extraction
- [ ] Share mode path handling remains stable until overlay extraction
- [ ] setCurrentPath navigates
- [ ] The hook is treated as a transitional listing/path hook, not the owner of search/sort/view derived state

### 2.9 Edge Cases

- requestIdRef prevents stale updates
- shareCurrentPath vs currentPathFromUrl
