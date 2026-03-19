# useFileManager Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Transitional listing/path seam for FileManager. Its final target is narrow: own the current explorer path plus gateway-backed listing reload state, while staying out of explorer session, commands, progress, and product-overlay policy. |
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
| hasWritePermission | boolean | Write permission |
| loadFiles | () => Promise | Reload files |
| onLoadErrorRef | ref | Ref for onLoadError callback (for external updates) |

### 2.4 Boundaries

- **Final target owns**
  - Path source of truth for the active explorer location (`currentPath`, `setCurrentPath`) until navigation ownership is fully isolated behind `useExplorerNavigation`.
  - Listing reload state (`files`, `loading`, `loadFiles`) for the current explorer location.
  - Gateway-backed access facts needed to render the current listing (for example current-path write capability).
  - Coordination between route/share-path inputs and the listing seam so the rest of explorer core can consume normalized listing data.
- **Explicitly does not own**
  - Search/sort/view-mode derived explorer session state (`useExplorerSession`)
  - Navigation orchestration and optimistic rollback (`useExplorerNavigation`)
  - Operation orchestration (`useExplorerCommands`)
  - Progress drawer/retry/cancel coordination (`useExplorerProgress`)
  - Recent-file verification/removal flows (`useRecentFile`)
  - Product overlays such as share-link policy and virtual collections
  - Browser-preference storage concerns such as persisted sort/view state
  - Ancillary service lookups that are not required for path/listing coordination (for example WebDAV info)

### 2.5 Dependencies

- **May use directly:** router/path inputs (`useParams`, `useNavigate`) and pure path helpers.
- **Must route explorer IO through:** `explorerGateway` (directory listing, path access checks, recent-file load/remove subscription helpers, metadata enrichment, and shared-entry loading when special collections need them).
- **Must not use directly in the final target:** file service modules, permission service modules, recent-files repositories/notifiers, or browser storage helpers.
- Transitional compatibility may still exist while the extraction is incomplete, but the spec target is the non-overlapping end state above.

### 2.5.1 Test Mock Strategy

- Prefer mocking `explorerGateway` and router/path seams rather than low-level file/permission/recent repository modules.
- Keep `useFileManager` tests focused on observable state transitions (`currentPath`, `files`, `loading`, permission flags) and navigation effects.
- Prefer per-test override of gateway responses instead of redefining whole mock modules in each test file.
- When the hook loads asynchronously on mount, prefer deferred promises (or an equivalent test-owned async seam) over instantly resolved mocks so the test can resolve listing/access requests inside an `act` boundary and then wait for the final observable state.
- If migrating portions to MSW, keep router and local UI helper mocks at module level and use MSW only for stable API interactions.

### 2.6 Side Effects

- Reload listing when the current path or share context changes.
- In the normal path flow, request the current directory listing and current-path access facts through `explorerGateway`.
- In the `__recent__` view, request recent entries and any needed metadata through `explorerGateway`, preserving `lastAccessed` and current derived-list behavior.
- In the `__shared__` view, request shared-root listing/capability data through gateway-backed seams while the shell still owns the product decision to activate that collection.
- Navigate on `setCurrentPath` in non-share mode (or coordinate with the navigation seam during the transition).
- While `currentPath === '/__recent__'`, subscribe to recent-file change notifications through `explorerGateway` so listing reloads remain localized to the listing seam.
- Forward explorer session ownership upward: callers such as `FileManager` obtain sort/view/search state from `useExplorerSession`, not from this hook.

### 2.7 Error Handling

- onLoadError callback
- requestIdRef for stale request guard

### 2.8 Verification Scenarios

- [ ] Load files on path change
- [ ] Normal-path listing and current-path write capability are loaded through `explorerGateway`, not direct service imports.
- [ ] `__recent__` flow continues to render the same recent-file entries and metadata while all repository/notifier access flows through `explorerGateway`.
- [ ] While viewing `__recent__`, notifier-driven recent-file changes trigger a reload through this hook without extra page-shell wiring.
- [ ] `__shared__` flow (shared folders, file-only permissions) remains stable until overlay extraction.
- [ ] Share mode path handling remains stable until overlay extraction
- [ ] setCurrentPath navigates
- [ ] The hook is treated as a listing/path seam, not the owner of search/sort/view derived state, browser-preference storage, or recent-file recovery logic.

### 2.9 Edge Cases

- requestIdRef prevents stale updates
- shareCurrentPath vs currentPathFromUrl
