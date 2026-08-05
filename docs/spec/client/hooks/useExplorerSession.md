# useExplorerSession Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer session controller: the single owner of search, sort, view-mode, and other preference-backed in-session explorer state for the current directory. It derives view-ready explorer state (display list, local thumbnail merges, infinite-scroll shaping) and exposes stable callbacks to update that session state. |
| Used by components/pages | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`) |
| Does not own | Navigation transitions, selection reset side effects, directory listing IO, recent-files repository/notifier IO, command orchestration (upload/rename/move/copy/delete/download), progress orchestration, product overlays (share-link policy, `__recent__`, `__shared__`). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerSession.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerSession.test.js`

### 2.2 Input Parameters

`useExplorerSession(params)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentNodeId | number \| null | Y | Current folder nodeId that the explorer is showing (`null` = root / virtual root). |
| files | Array<object> | Y | Current directory entries already loaded (source of truth from higher-level listing logic). |
| initialSearchQuery | string | N | Initial search query. Defaults to empty string. |
| isMobile | boolean | N | Used only for preserving current mobile view-mode restrictions (behavior must remain unchanged). |

Notes:

- This hook is **client-state/derivation focused**; it must not call network/file IO (no service calls, no explorer gateway mutations/listing).
- This hook is the owner of explorer preference-backed session state for search/sort/view mode; callers do not supply external sort/view ownership anymore.
- Preference persistence for view/sort mode may remain here only through the established preference-storage policy/helpers. The hook must not access `localStorage` or other browser globals directly.

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| searchQuery | string | Current search query. |
| setSearchQuery | (q: string) => void | Update query. |
| sortMode | string | Current sort mode. |
| setSortMode | (mode: string) => void | Update sort. |
| viewMode | string | Current view mode. |
| setViewMode | (mode: string) => void | Update view mode (must preserve current mobile restrictions). |
| files | Array<object> | Local file list copy used for safe in-session display updates such as thumbnail merges. |
| setFiles | (files: Array<object>) => void | Advanced setter for session-local display updates. |
| filteredFiles | Array<object> | Derived list after applying search. |
| sortedFiles | Array<object> | Derived list after sorting. |
| displayedFiles | Array<object> | Final list that the view consumes (search + sort + infinite-scroll shaping + any display shaping that is currently local-state-derived). |
| loadMoreRef | ref callback/object | Infinite-scroll sentinel for the view layer. |
| hasMore | boolean | Whether more items can be revealed by the infinite-scroll seam. |
| handleThumbnailsLoaded | `(thumbnailMap: Map<number, string>) => void` | Merge thumbnail URLs keyed by `file.nodeId` into the session-local file list without re-owning list loading. |
| sessionKey | string | A stable key representing the explorer session boundary for downstream resets when the current nodeId changes. The hook exposes this token; the page shell / selection seam decides how to react to it. (pending implementation: the current source derives `sessionKey` from `currentPath`.) |

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - Search query state and client-side filtering behavior (must match current “filter by name” behavior).
  - Sort state and ordering rules (must match current ordering rules).
  - View mode state and any page-local restrictions needed to preserve current UX.
  - Preference-backed persistence for sort/view mode through a storage adapter/helper boundary.
  - Session-local file shaping needed for view updates that do not re-fetch data (for example thumbnail URL merges).
  - Derived display list that the view consumes, including infinite-scroll shaping.
  - Exposes a node-change boundary token (`sessionKey`) used by the shell/selection seam for selection reset.
- **Does not own**
  - Fetching/listing files (belongs to listing logic / gateway usage outside this hook).
  - Recent-file subscriptions or repository access when `__recent__` is active.
  - Clearing or mutating selection state directly when the path changes.
  - Navigation transitions/optimistic updates (belongs to `useExplorerNavigation`).
  - Operations orchestration and conflict prompts (belongs to `useExplorerCommands`).
  - Progress coordination, retry/cancel routing, completion messaging (belongs to `useExplorerProgress`).

### 2.5 Dependencies

- **May use:** pure helpers for filtering/sorting plus view-focused hooks such as infinite-scroll utilities.
- **May use for preference persistence only:** small preference-storage helpers/adapters that encapsulate browser storage policy.
- **Must not use:** `apiClient`, explorer/file service modules for listing or mutations, browser globals directly, router hooks.

### 2.6 Side Effects

- May persist view/sort preferences only if the current app already persists them for FileManager and the persistence mechanism stays behind the existing preference-storage helper/adapter boundary.

### 2.7 Error Handling

- This hook should not throw for malformed file objects; it should behave defensively (e.g. treat missing names as empty) to match current UX stability.

### 2.8 Verification Scenarios

Verify observable outcomes (“what”), not internal implementation:

- [ ] When `searchQuery` changes, `displayedFiles` updates using the same name-matching behavior as today.
- [ ] When `sortMode` changes, the ordering matches current behavior for each supported sort mode.
- [ ] When `currentNodeId` changes, `sessionKey` changes (or otherwise signals a reset boundary) so the shell/selection seam can reset selection as today.
- [ ] Mobile view-mode restrictions remain unchanged (if mobile disallows certain modes today, it still does).
- [ ] Thumbnail updates merged through `handleThumbnailsLoaded` update rendered file data without requiring a full re-fetch.
- [ ] Preference persistence for sort/view mode keeps the same observable behavior without exposing direct browser-storage requirements in the hook contract.
- [ ] Other explorer seams (`useFileManager`, page shell) do not need to duplicate or inject sort/view ownership to preserve current behavior.

### 2.9 Edge Cases

- `files` is empty → `displayedFiles` is empty.
- `files` contains entries with missing/empty name → they do not crash filtering/sorting.

