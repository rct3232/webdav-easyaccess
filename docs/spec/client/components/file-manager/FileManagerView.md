# FileManagerView Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure view for the FileManager explorer UI. Renders the content area (list/grid/detail), toolbars/controls, folder tree region, dialogs/overlays slots, and binds callbacks passed from controller hooks and the page shell. |
| Used in | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`) |
| Must be | A pure view: renders from props only. Must not import services, gateways, router hooks, or browser globals. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerView.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerView.test.js`

### 2.2 Props

This view intentionally aggregates many props during extraction. Over time, props should be grouped into sub-view models, but the view must remain pure.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| currentPath | string | Y | Current normalized path for display/breadcrumbs. |
| displayedFiles | Array<object> | Y | View-ready list to render (already filtered/sorted). |
| viewMode | string | Y | `'list' \| 'grid' \| 'detail'` (as currently implemented). |
| sortMode | string | Y | Current sort mode (as currently implemented). |
| searchQuery | string | Y | Current search query. |
| onSearchQueryChange | (q: string) => void | Y | Update search. |
| onSortModeChange | (mode: string) => void | Y | Update sort. |
| onViewModeChange | (mode: string) => void | Y | Update view mode. |
| selection | object | Y | View model for selection state (count, selected set/ids, selection mode flag) matching current UX. |
| onFileOpen | (file: object) => void | Y | Open/preview file. |
| onFolderOpen | (folderPath: string) => void | Y | Open folder (delegates to navigation controller). |
| onContextAction | (action: string, file?: object) => void | Y | Open action sheet/context menu for file or selection. |
| folderTree | ReactNode | N | Slot for folder-tree rendering (tree itself remains separate). |
| progress | object | N | Progress view model (drawer state + items) from `useExplorerProgress`. |
| overlays | ReactNode | N | Slot for product overlays/dialogs (share dialog, share-link login prompt, etc.). |
| isLoading | boolean | N | Listing/loading state. |
| errorState | object \| null | N | Optional error view model if current UI shows page-level errors. |

Notes:

- The view does **not** decide share-link restrictions or virtual collection mapping; it receives view-ready data/flags.
- If the current UI relies on responsive behavior, the shell or controllers must pass the derived flags (e.g. `isMobile`) rather than the view importing responsive hooks directly (unless those hooks are considered purely presentational and do not break layering rules).

### 2.3 Callback Signatures

Call signatures listed in the props table are the contract; the view must call these and must not directly perform side effects.

### 2.4 Dependencies

- **Allowed imports:** React, i18n hooks, UI libraries (MUI), presentational helpers/components.
- **Forbidden imports:** `client/src/services/*`, gateways (including `explorerGateway`), router hooks, browser APIs, storage utilities.
- **Reference implementation:** extracted from `client/src/pages/FileManager/FileManager.js` during Phase 3.1.

### 2.5 Verification Scenarios

- [ ] Renders list/grid/detail based on `viewMode` without calling IO.
- [ ] Search, sort, and view-mode controls call the provided callbacks.
- [ ] Clicking/tapping items triggers `onFileOpen` or `onFolderOpen` with the same UX semantics as today (semantics are owned by controllers; view must only wire events).
- [ ] Folder tree and overlay slots render in the same layout positions as today.
- [ ] Progress drawer renders from `progress` props and calls provided retry/cancel callbacks without owning the operation logic.

### 2.6 Edge Cases

- `displayedFiles` empty: renders empty state message consistent with current UI.
- Loading state: renders the current loading UX (spinner/skeleton) driven purely by `isLoading`.

