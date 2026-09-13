# useFileManager Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                    |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Transitional listing/nodeId seam for FileManager. Its final target is narrow: own the current explorer nodeId plus gateway-backed listing reload state, while staying out of explorer session, commands, progress, and product-overlay policy. |
| Used by components/pages | FileManager page shell (current implementation)                                                                                                                                                                                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useFileManager.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useFileManager.test.js`

### 2.2 Input Parameters

| Name    | Type   | Required | Description                                       |
| ------- | ------ | -------- | ------------------------------------------------- |
| user    | object | Y        | Current user                                      |
| options | object | N        | onLoadComplete, onLoadError, shareToken, linkInfo |

### 2.3 Return Value / State

| Key                | Type                   | Meaning                                                                                                                                                                         |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| currentNodeId      | number\|null           | Current folder nodeId (`null` = root / virtual-root level). **Source of truth** for the explorer location in the nodeId end-state.                                              |
| setCurrentNodeId   | (nodeId) => void       | Set current folder nodeId and navigate to `/files/node/<nodeId>`.                                                                                                               |
| currentPath        | string                 | Derived display path only (breadcrumbs/labels); not a navigation or lookup key.                                                                                                 |
| files              | array                  | File list                                                                                                                                                                       |
| loading            | boolean                | Loading                                                                                                                                                                         |
| hasWritePermission | boolean                | Write permission                                                                                                                                                                |
| loadFiles          | () => Promise          | Reload files                                                                                                                                                                    |
| onLoadErrorRef     | ref                    | Ref for onLoadError callback (for external updates)                                                                                                                             |
| trashParentNodeId  | number\|null           | Trash view only: current trashed-parent nodeId (`null` = trash root listing topmost items).                                                                                     |
| trashTrail         | array                  | Trash-view breadcrumb chain `[{ nodeId, name }]` (trashed folder names from the trash root down to the current trashed parent).                                                 |
| openTrashFolder    | (nodeId, name) => void | Trash-view navigation setter: `nodeId == null` → `/files/__trash__`; otherwise remember the folder name in the trash trail cache and navigate `/files/__trash__/node/<nodeId>`. |

### 2.3.1 Trash view branch (DEF-16 P9)

- **URL forms:** `/files/__trash__` (trash root: topmost trashed items) and
  `/files/__trash__/node/<nodeId>` (inside a trashed folder: lists its trashed children).
  The `urlView` parser maps both to `kind: 'trash'` and exposes `trashNodeId` (`null` at root).
  `currentPath` stays `/__trash__` at every trash depth (sidebar/breadcrumb/FAB policy keys off it).
- **Listing:** the trash branch calls `explorerGateway.loadTrashEntries({ parentId })` — `parentId`
  only when a trashed folder is open. Location key is `trash:<nodeId|root>` so navigation between
  trash levels reloads the listing and clears selection (same session-boundary rule as other views).
- **Breadcrumb trail:** `useFileManager` owns a session-local trashed-name cache
  (`Map<nodeId, { name, parentNodeId }>`) filled by `openTrashFolder` clicks. `trashTrail` is
  rebuilt from the cache on every trash URL change; when the current trashed parent is unknown to
  the cache (direct URL entry/refresh) the hook derives its name from the first listed child's
  `displayPath` (parent of the child's original path). Unknown ancestors truncate the trail — the
  breadcrumb always keeps the navigable Trash chip.
- **Permissions:** the trash view is read-only at the folder level (`hasWritePermission` = false,
  like `__recent__`/`__shared__`); item-level restore/purge gates use the row-level
  `hasWritePermission` flags carried by the trash entries.
- **Interaction:** trashed rows never navigate via `resolve-path`/`canNavigateToNode`
  (trashed = not-found). Folder opens go through `openTrashFolder`; file clicks in the trash view
  are no-ops in the shell (preview would 404 — visibility only via the trash listing).

### 2.4 Boundaries

- **Final target owns**
  - nodeId source of truth for the active explorer location (`currentNodeId`) until navigation ownership is fully isolated behind `useExplorerNavigation`.
  - Listing reload state (`files`, `loading`, `loadFiles`) for the current explorer location.
  - Gateway-backed access facts needed to render the current listing (for example current-folder write capability via `getPathAccess({ nodeId })`).
  - Coordination between route (`/files/node/:nodeId`, virtual roots) / share-link inputs and the listing seam so the rest of explorer core can consume normalized listing data.
- **Explicitly does not own**
  - Search/sort/view-mode derived explorer session state (`useExplorerSession`)
  - Navigation orchestration and optimistic rollback (`useExplorerNavigation`)
  - Operation orchestration (`useExplorerCommands`)
  - Progress drawer/retry/cancel coordination (`useExplorerProgress`)
  - Recent-file verification/removal flows (`useRecentFile`)
  - Product overlays such as share-link policy and virtual collections
  - Browser-preference storage concerns such as persisted sort/view state
  - Ancillary service lookups that are not required for nodeId/listing coordination (for example WebDAV info)

### 2.5 Dependencies

- **May use directly:** router/path inputs (`useParams`, `useNavigate`) and pure path helpers.
- **Route-param contract (`/files/*`)**:
  - The explorer route uses a splat param (`*`) to represent the explorer location under `/files/`.
  - **Real folders:** URL form is `/files/node/<nodeId>` (decision D1). `useFileManager` parses the splat into a `nodeId`; that `nodeId` is the source of truth and is passed to `explorerGateway.listDirectory({ nodeId })`.
  - **Virtual roots:** `/files/__recent__` and `/files/__shared__` URLs are unchanged; they map to the recent-files and shared-folder views (no nodeId). `/files/__trash__` and `/files/__trash__/node/<nodeId>` map to the trash view (`trashNodeId` = trashed parent, `null` at root; DEF-16 P9).
  - **Legacy path URLs** (e.g. `/files/<username>/<subpath>`): resolved via `POST /files/resolve-path { path } → { nodeId }` (server S3) and redirected to `/files/node/<nodeId>`; if resolution fails, fall back to the root-level listing. The client keeps no persistent path→nodeId mapping for this; the session-local `path → nodeId` map is removed in the nodeId end-state.
  - Router upgrades that change relative splat resolution (React Router v6 `future.v7_relativeSplatPath`, and React Router v7 baseline behavior) must not change the user-visible nodeId contract above.
- **Must route explorer IO through:** `explorerGateway` (directory listing, path access checks, recent-file load/remove subscription helpers, metadata enrichment, and shared-entry loading when special collections need them).
- **Must not use directly in the final target:** file service modules, permission service modules, recent-files repositories/notifiers, or browser storage helpers.
- Transitional compatibility may still exist while the extraction is incomplete, but the spec target is the non-overlapping end state above.

### 2.5.1 Test Mock Strategy

- Prefer mocking `explorerGateway` and router/path seams rather than low-level file/permission/recent repository modules.
- Keep `useFileManager` tests focused on observable state transitions (`currentNodeId`, `files`, `loading`, permission flags) and navigation effects.
- Prefer per-test override of gateway responses instead of redefining whole mock modules in each test file.
- When the hook loads asynchronously on mount, prefer deferred promises (or an equivalent test-owned async seam) over instantly resolved mocks so the test can resolve listing/access requests inside an `act` boundary and then wait for the final observable state.
- If migrating portions to MSW, keep router and local UI helper mocks at module level and use MSW only for stable API interactions.

### 2.6 Side Effects

- Reload listing when the current nodeId or share context changes.
- `currentNodeId` is the single source of truth; the URL is derived from it:
  - Real folder navigation emits `/files/node/<nodeId>`; `setCurrentNodeId(nextNodeId)` triggers `explorerGateway.listDirectory({ nodeId: nextNodeId })` and a current-folder access check.
  - Initial loads and unresolvable locations fall back to the root-level listing (`nodeId = null`).
  - Legacy path URLs are bootstrapped through `POST /files/resolve-path` and redirected to `/files/node/<nodeId>` (decision D1); no session-local `path → nodeId` map is maintained.
- In the normal flow, request the current directory listing (`listDirectory({ nodeId })`) and current-folder access facts (`getPathAccess({ nodeId })`) through `explorerGateway`.
- In the `__recent__` view, request recent entries and any needed metadata through `explorerGateway`, preserving `lastAccessed` and current derived-list behavior.
- In the `__shared__` view, request shared-root listing/capability data through gateway-backed seams while the shell still owns the product decision to activate that collection.
- Navigate by nodeId in non-share mode (or coordinate with the navigation seam during the transition).
- While viewing `__recent__`, subscribe to recent-file change notifications through `explorerGateway` so listing reloads remain localized to the listing seam.
- Forward explorer session ownership upward: callers such as `FileManager` obtain sort/view/search state from `useExplorerSession`, not from this hook.

### 2.7 Error Handling

- onLoadError callback
- requestIdRef for stale request guard

### 2.8 Verification Scenarios

- [ ] Load files when the current nodeId changes (root-level listing when `null`)
- [ ] Real-folder URL `/files/node/<nodeId>` lists via `listDirectory({ nodeId })`; current-folder write capability via `getPathAccess({ nodeId })` is loaded through `explorerGateway`, not direct service imports.
- [ ] Virtual-root URLs `/files/__recent__` and `/files/__shared__` keep their existing behavior.
- [ ] Trash view: `/files/__trash__` lists topmost trashed entries via `explorerGateway.loadTrashEntries()`; `/files/__trash__/node/<nodeId>` reloads with `{ parentId }`; location key changes clear selection; `trashTrail` follows the navigation chain and rebuilds from cached trashed names (or the first child's `displayPath` on refresh); `openTrashFolder(null)` returns to the trash root (DEF-16 P9).
- [ ] A legacy path URL is resolved via `POST /files/resolve-path` and redirected to `/files/node/<nodeId>`; an unknown path falls back to the root listing.
- [ ] `__recent__` flow continues to render the same recent-file entries and metadata while all repository/notifier access flows through `explorerGateway`.
- [ ] While viewing `__recent__`, notifier-driven recent-file changes trigger a reload through this hook without extra page-shell wiring.
- [ ] `__shared__` flow (shared folders, file-only permissions) remains stable until overlay extraction.
- [ ] Share mode navigates by the share current folder nodeId: `currentNodeId` is the share folder nodeId and share listings use it (`listDirectory({ nodeId: shareCurrentNodeId, options: { shareToken } })`); the share display path is kept for breadcrumb display only (C2.5).
- [ ] setCurrentNodeId navigates
- [ ] The hook is treated as a listing/nodeId seam, not the owner of search/sort/view derived state, browser-preference storage, or recent-file recovery logic.

### 2.9 Edge Cases

- requestIdRef prevents stale updates
- shareCurrentNodeId vs currentNodeIdFromUrl
- Share mode when the root nodeId is unavailable (linkInfo without nodeId / unauthenticated viewer): the share root is listed via `shareToken` with `nodeId: null`, and subfolder navigation still uses child `nodeId`s from listings; the display path fallback keeps the breadcrumb usable.
