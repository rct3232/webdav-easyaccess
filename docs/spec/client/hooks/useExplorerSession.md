# useExplorerSession Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Explorer “session” controller: derives view-ready explorer state for the current directory (search/sort/view mode/display list) and exposes stable callbacks to update that session state. |
| Used by components/pages | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`) |
| Does not own | Navigation transitions, command orchestration (upload/rename/move/copy/delete/download), progress orchestration, product overlays (share-link policy, `__recent__`, `__shared__`). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useExplorerSession.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useExplorerSession.test.js`

### 2.2 Input Parameters

`useExplorerSession(params)`

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentPath | string | Y | Normalized current folder path that the explorer is showing. |
| files | Array<object> | Y | Current directory entries already loaded (source of truth from higher-level listing logic). |
| initialViewMode | string | N | Initial view mode (e.g. `'list' \| 'grid' \| 'detail'`). Defaults to current app behavior. |
| initialSortMode | string | N | Initial sort mode. Defaults to current app behavior. |
| initialSearchQuery | string | N | Initial search query. Defaults to empty string. |
| isMobile | boolean | N | Used only for preserving current mobile view-mode restrictions (behavior must remain unchanged). |

Notes:

- This hook is **purely client-state/derivation**; it must not call IO (no service calls, no gateways).
- This hook may persist small preference-like values (e.g. view mode) only if that matches current behavior and is routed through the same storage policy used today.

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| searchQuery | string | Current search query. |
| setSearchQuery | (q: string) => void | Update query. |
| sortMode | string | Current sort mode. |
| setSortMode | (mode: string) => void | Update sort. |
| viewMode | string | Current view mode. |
| setViewMode | (mode: string) => void | Update view mode (must preserve current mobile restrictions). |
| filteredFiles | Array<object> | Derived list after applying search. |
| displayedFiles | Array<object> | Final list that the view consumes (search + sort + any display shaping that is currently local-state-derived). |
| sessionKey | string | A stable key representing the “session boundary” for resets when `currentPath` changes. Used by the page shell to reset selection when path changes (preserve current behavior). |

### 2.4 Responsibilities (must be non-overlapping)

- **Owns**
  - Search query state and client-side filtering behavior (must match current “filter by name” behavior).
  - Sort state and ordering rules (must match current ordering rules).
  - View mode state and any page-local restrictions needed to preserve current UX.
  - Derived display list that the view consumes.
  - Exposes a path-change boundary token (`sessionKey`) used by the shell for selection reset.
- **Does not own**
  - Fetching/listing files (belongs to listing logic / gateway usage outside this hook).
  - Navigation transitions/optimistic updates (belongs to `useExplorerNavigation`).
  - Operations orchestration and conflict prompts (belongs to `useExplorerCommands`).
  - Progress coordination, retry/cancel routing, completion messaging (belongs to `useExplorerProgress`).

### 2.5 Dependencies

- **May use:** pure helpers for filtering/sorting (no IO).
- **Must not use:** `apiClient`, any `services/*` modules, browser globals directly (except via existing preference persistence policy), router hooks.

### 2.6 Side Effects

- May persist view/sort preferences only if the current app already persists them for FileManager and the persistence mechanism is unchanged.

### 2.7 Error Handling

- This hook should not throw for malformed file objects; it should behave defensively (e.g. treat missing names as empty) to match current UX stability.

### 2.8 Verification Scenarios

Verify observable outcomes (“what”), not internal implementation:

- [ ] When `searchQuery` changes, `displayedFiles` updates using the same name-matching behavior as today.
- [ ] When `sortMode` changes, the ordering matches current behavior for each supported sort mode.
- [ ] When `currentPath` changes, `sessionKey` changes (or otherwise signals a reset boundary) so the shell can reset selection as today.
- [ ] Mobile view-mode restrictions remain unchanged (if mobile disallows certain modes today, it still does).

### 2.9 Edge Cases

- `files` is empty → `displayedFiles` is empty.
- `files` contains entries with missing/empty name → they do not crash filtering/sorting.

