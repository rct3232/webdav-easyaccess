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

This view remains pure, but the page shell should pass grouped sub-view models instead of flattening dozens of individual props. The goal is to keep `FileManager` readable as a composition layer while the view still receives fully prepared data/callbacks.

| Name | Type | Required | Description |
|------|------|----------|-------------|
| shareContext | object | Y | Share-link mode context (`shareToken`, `isShareLinkMode`, `shareRootPath`, `shareRootName`). |
| shellContext | object | Y | Shell-only view state such as `user`, `navigate`, `isMobile`, refs, and responsive layout inputs. |
| overlayState | object | Y | Product overlay and drawer/login/share-link modal state prepared by the shell/controllers. |
| explorerSession | object | Y | Current explorer session view model. This should be split into sub-objects such as `controlsState` (search/sort/view controls) and `listingState` (displayed files, loading, thumbnails, infinite-scroll state). |
| selectionState | object | Y | Selection-derived view model. This should be split into sub-objects such as `selectionModel` (selection mode, selected set, item toggle callback) and `bulkState` (select-all/reset callbacks and bulk-action capability flags). |
| explorerActionState | object | Y | Explorer action-related view state. This should be split into sub-objects such as `capabilityState` (write permission), `treeState` (tree refresh trigger), and `transferState` (drag source path and move/copy in-progress flags). |
| dialogState | object | Y | Dialog-related view state prepared by controllers. This should be split into sub-objects such as `actionContext`, `pickerState`, `modalDialogs`, and `fileTargets` rather than one flat dialog bag. |
| messaging | object | Y | Snackbar and drop-message view model. |
| explorerHandlers | object | Y | Prepared callbacks grouped by responsibility. At minimum, this should be split into sub-objects such as `interaction`, `commands`, `progress`, and `refreshIndicator` rather than one flat callback bag. |

Notes:

- The view does **not** decide share-link restrictions or virtual collection mapping; it receives view-ready grouped data/flags.
- If the current UI relies on responsive behavior, the shell or controllers must pass the derived flags (e.g. `isMobile`) rather than the view importing responsive hooks directly (unless those hooks are considered purely presentational and do not break layering rules).
- These grouped props are organizational only; they do not grant the view ownership of side effects.
- The view should consume only the grouped values it actually renders. If the shell/controller has extra internal state, keep that state upstream instead of destructuring unused values in the view.
- Handler grouping should reflect responsibility boundaries. For example:
  - `interaction`: click/open/context/drag handlers for explorer content.
  - `commands`: dialog completion and command entry points.
  - `progress`: retry/cancel callbacks and progress items.
  - `refreshIndicator`: pull-to-refresh indicator styles and state.
- Dialog grouping should also reflect responsibility boundaries. For example:
  - `actionContext`: action sheet, desktop context menu, current file target.
  - `pickerState`: folder picker and mobile move/copy picker state.
  - `modalDialogs`: upload/create/preview/rename/share/properties/confirm/conflict dialog state.
  - `fileTargets`: selected file/media/conflict payloads consumed by dialogs.
- Explorer-session grouping should reflect responsibility boundaries. For example:
  - `controlsState`: `currentPath`, `viewMode`, `sortMode`, `searchQuery`, and other true explorer-session inputs owned by the session controller.
  - `listingState`: `displayedFiles`, `loading`, `processingMap`, thumbnail callbacks, and infinite-scroll refs/flags.
- Preference persistence for sort/view mode stays upstream in the explorer session controller; this pure view should not require dedicated `saveSortMode` / `saveViewMode` props.
- Pure control-chrome state that is only needed inside a child control component (for example a local sort-menu anchor) should stay local to that child instead of being hoisted through `FileManager` and this view.
- Selection grouping should reflect responsibility boundaries. For example:
  - `selectionModel`: `selectionMode`, `selectedFiles`, and per-item toggle callbacks.
  - `bulkState`: select-all/reset callbacks plus bulk capability flags derived from the current selection.
- Explorer-action grouping should reflect responsibility boundaries. For example:
  - `capabilityState`: write-permission style capability flags.
  - `treeState`: tree refresh/update tokens consumed by the folder tree.
  - `transferState`: internal drag path and bulk move/copy progress state.

### 2.3 Callback Signatures

Call signatures listed in the props table are the contract; the view must call these and must not directly perform side effects.

### 2.4 Dependencies

- **Allowed imports:** React, i18n hooks, UI libraries (MUI), presentational helpers/components.
- **Forbidden imports:** `client/src/services/*`, gateways (including `explorerGateway`), router hooks, browser APIs, storage utilities.
- **Reference implementation:** extracted from `client/src/pages/FileManager/FileManager.js` during Phase 3.1.

### 2.5 Verification Scenarios

These scenarios should be covered by a dedicated component test in `client/src/components/file-manager/__tests__/FileManagerView.test.js`. That test may mock lower-level child components and dialogs to verify boundary wiring while layout/details inside those children remain covered by their own tests.

- [ ] Renders list/grid/detail based on `viewMode` without calling IO.
- [ ] Search, sort, and view-mode controls call the provided callbacks.
- [ ] Clicking/tapping items triggers `onFileOpen` or `onFolderOpen` with the same UX semantics as today (semantics are owned by controllers; view must only wire events).
- [ ] Folder tree and overlay slots render in the same layout positions as today.
- [ ] Progress drawer renders from `progress` props and calls provided retry/cancel callbacks without owning the operation logic.
- [ ] In share-link mode, the folder tree routes non-share section clicks through `onLeaveShareClick` (`interaction.handleLeaveSharePathClick`) so the hosting shell can open the leave-share confirmation; the leave-share `ConfirmDialog` renders from `overlayState` (leave-share state) and confirms via `handleLeaveShareConfirm`.

### 2.6 Edge Cases

- `displayedFiles` empty: renders empty state message consistent with current UI.
- Loading state: renders the current loading UX (spinner/skeleton) driven purely by `isLoading`.

