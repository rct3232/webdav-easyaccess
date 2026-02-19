# useFileManager Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Core FileManager state: currentPath, files, loading, sortMode, hasWritePermission. Loads files via listFiles, handles __recent__, __shared__, share link mode. |
| Used by components/pages | FileManager page |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useFileManager.js`
- **Test file:** `client/src/hooks/__tests__/useFileManager.test.js`

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
| sortMode | string | Sort mode |
| setSortMode | function | Set sort |
| hasWritePermission | boolean | Write permission |
| webdavUrl | string | WebDAV URL |
| loadFiles | () => Promise | Reload files |
| onLoadErrorRef | ref | Ref for onLoadError callback (for external updates) |

### 2.4 Dependencies

- listFiles, getWebDAVInfo, checkPermission, listFilePermissions, getFilesMetadata
- getRecentFiles, getUserPermissions, getShowHiddenFiles, getSortMode (localStorage)
- normalizePath, getParentPath, getBasename (pathUtils)
- filterOutUserOwnFolders (userUtils)
- HTTP_STATUS (shared constants)
- useParams, useNavigate

### 2.5 Side Effects

- listFiles on currentPath change
- __recent__: getRecentFiles + getFilesMetadata
- __shared__: getUserPermissions + listFilePermissions for shared folders, filter top-level
- shareToken: listFiles with shareToken
- Navigate on setCurrentPath (non-share mode)

### 2.6 Error Handling

- onLoadError callback
- requestIdRef for stale request guard

### 2.7 Verification Scenarios

- [ ] Load files on path change
- [ ] __recent__ flow
- [ ] __shared__ flow (shared folders, file-only permissions)
- [ ] Share mode path handling
- [ ] setCurrentPath navigates

### 2.8 Edge Cases

- requestIdRef prevents stale updates
- shareCurrentPath vs currentPathFromUrl
