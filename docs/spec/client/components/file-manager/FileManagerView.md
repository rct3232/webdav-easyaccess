# FileManagerView Spec

## 1. Overview

| Item    | Description                                                                                                                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role    | Pure view for the FileManager explorer UI. Renders the content area (list/grid/detail), toolbars/controls, folder tree region, dialogs/overlays slots, and binds callbacks passed from controller hooks and the page shell. |
| Used in | `FileManager` page shell (`docs/spec/client/pages/FileManager.md`)                                                                                                                                                          |
| Must be | A pure view: renders from props only. Must not import services, gateways, router hooks, or browser globals.                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerView.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerView.test.js`

### 2.2 Props

This view remains pure, but the page shell should pass grouped sub-view models instead of flattening dozens of individual props. The goal is to keep `FileManager` readable as a composition layer while the view still receives fully prepared data/callbacks.

| Name                | Type   | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| shareContext        | object | Y        | Share-link mode context (`shareToken`, `isShareLinkMode`, `shareRootPath`, `shareRootName`).                                                                                                                                                                                                                                                                                                                                            |
| shellContext        | object | Y        | Shell-only view state such as `user`, `navigate`, `isMobile`, refs, and responsive layout inputs.                                                                                                                                                                                                                                                                                                                                       |
| overlayState        | object | Y        | Product overlay and drawer/login/share-link modal state prepared by the shell/controllers.                                                                                                                                                                                                                                                                                                                                              |
| explorerSession     | object | Y        | Current explorer session view model. This should be split into sub-objects such as `controlsState` (search/sort/view controls) and `listingState` (displayed files, loading, thumbnails, infinite-scroll state).                                                                                                                                                                                                                        |
| selectionState      | object | Y        | Selection-derived view model. This should be split into sub-objects such as `selectionModel` (selection mode, selected set, item toggle callback) and `bulkState` (select-all/reset callbacks and bulk-action capability flags).                                                                                                                                                                                                        |
| explorerActionState | object | Y        | Explorer action-related view state. This should be split into sub-objects such as `capabilityState` (write permission), `treeState` (tree refresh trigger), and `transferState` (drag source path and move/copy in-progress flags).                                                                                                                                                                                                     |
| dialogState         | object | Y        | Dialog-related view state prepared by controllers. This should be split into sub-objects such as `actionContext`, `pickerState`, `modalDialogs`, and `fileTargets` rather than one flat dialog bag.                                                                                                                                                                                                                                     |
| messaging           | object | Y        | Snackbar and drop-message view model.                                                                                                                                                                                                                                                                                                                                                                                                   |
| explorerHandlers    | object | Y        | Prepared callbacks grouped by responsibility. At minimum, this should be split into sub-objects such as `interaction`, `commands`, `progress`, and `refreshIndicator` rather than one flat callback bag.                                                                                                                                                                                                                                |
| trashState          | object | N        | Trash-view overlay group: `trashMode`, breadcrumb `trail`, `canEmptyTrash`, the three trash confirm states + open/close/confirm callbacks (`useTrashOperations`), and the `handleTrashRestore`/`handleTrashPurge` executors. The view keys trash behavior off `trashMode`/`currentPath === '/__trash__'` (breadcrumb trail, controls trash buttons, withheld live-item menu/sheet callbacks, trash confirm dialogs, trash `emptyText`). |

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
- `controlsState`: `currentPath`, `viewMode`, `memberViewMode` (+ `setMemberViewMode`, members surface), `likedViewMode` (+ `setLikedViewMode`, Likes surface), `sortMode`, `searchQuery`, and other true explorer-session inputs owned by the session controller.
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
- **Reference implementation:** extracted from `client/src/pages/FileManager/FileManager.js`.

### 2.5 Backend-health banner

- The controller (`FileManager.js`) fetches the public `GET /api/health` for every authenticated
  session (no admin config access) on mount and re-polls every 15 s while mounted, passing
  `backends` (status strings) + `activeFileStorage` + `activeMetadataBackend` down via the shell
  context. Polling ensures a failure recorded mid-session (e.g. a failed upload or DB drop) flips
  the banner without a page remount.
- The view renders a warning `Alert` (between `FileManagerControls` and the listing,
  `data-testid="backend-health-banner"`) when an authenticated, non-share session is active and an
  ACTIVE backend is `fail`: the active FILE backend (`backendHealth[activeFileStorage]`), or the
  metadata backend when it is `postgresql` (`activeMetadataBackend === 'postgresql' &&
backendHealth.postgresql === 'fail'`). Failures of inactive backends never trigger it.
- Copy is role-based: admins see `admin.health.banner`. Non-admin text matches the failing backend
  type — `files.maintenanceNotice` when the metadata DB is failing, otherwise
  `files.storageUnavailable` — conveying only that the service is unavailable (no backend/key
  detail). The System Settings health card remains admin-only.
- The view never performs the health fetch itself (presentational boundary).

### 2.6 Verification Scenarios

These scenarios should be covered by a dedicated component test in `client/src/components/file-manager/__tests__/FileManagerView.test.js`. That test may mock lower-level child components and dialogs to verify boundary wiring while layout/details inside those children remain covered by their own tests.

- [ ] Renders list/grid/detail based on `viewMode` without calling IO.
- [ ] Search, sort, and view-mode controls call the provided callbacks.
- [ ] Clicking/tapping items triggers `onFileOpen` or `onFolderOpen` with the same UX semantics as today (semantics are owned by controllers; view must only wire events).
- [ ] Folder tree and overlay slots render in the same layout positions as today.
- [ ] Progress drawer renders from `progress` props and calls provided retry/cancel callbacks without owning the operation logic.
- [ ] In share-link mode, the folder tree routes non-share section clicks through `onLeaveShareClick` (`interaction.handleLeaveSharePathClick`) so the hosting shell can open the leave-share confirmation; the leave-share `ConfirmDialog` renders from `overlayState` (leave-share state) and confirms via `handleLeaveShareConfirm`.
- [ ] Backend-health banner renders for admins (detailed copy) when the active file backend is `fail`
- [ ] Backend-health banner renders for non-admin users (simplified `files.storageUnavailable` copy) when the active file backend is `fail`
- [ ] Backend-health banner renders when the active metadata DB (`postgresql`) is `fail` — non-admin copy is `files.maintenanceNotice`
- [ ] Banner is absent when no active backend is `fail`, or in share-link mode

### 2.6 Edge Cases

- `displayedFiles` empty: renders empty state message consistent with current UI.
- Loading state: renders the current loading UX (spinner/skeleton) driven purely by `isLoading`.

---

## 3. AI-platform composition (AI platform)

Addendum to §2.2 grouping rules (docs/features/collections-platform.md §4.6 results mode, §4.9 virtual collections). Pure-view rule unchanged: the shell passes view-ready models; the view only swaps regions.

- **Search results mode:** when the shell passes a `searchResults` model with `mode === 'results'` or `'pending'` (prepared by `useSearchResults`), the view swaps two regions — no separate overlay surface exists:
  - **Chip bar replaces the breadcrumb row:** `SearchQueryChipBar` renders in the breadcrumb area (committed chain terms, undo/exit reveal, right-edge/mobile-slot `LibraryAdd` and the save affordance — their own spec owns the chrome); `Breadcrumb` is not rendered while results mode is active, and on mobile the chip bar's `LibraryAdd` occupies the breadcrumb expand-toggle slot (the expand toggle is not rendered). Exit returns to the normal breadcrumb+list composition; folder navigation from the sidebar/tree/breadcrumb exits results mode (shell rule — `FileManager.md` §7).
  - **The listing area hosts the accordion zones** inside the single scroll container (`explorer-container`), in order: Zone A (current-folder matches of the committed terms, fed by the session listing adapter — no suppression, `useExplorerSession.md` §3), separator + Zone B (server name-match rows converted to explorer entries), Zone C (semantic snapshot rows — renders NOTHING while empty or unavailable; with rows it renders in the SERVER's delivered score order, never re-sorted by `sortMode` — `useSearchResults.md` §2.3). Rows render through the SAME `FileList`/`FileGrid`/`FileDetail` renderer chosen by the session `viewMode`; session `sortMode` applies to Zones A/B (Zone C keeps the server order); each zone runs its own `useInfiniteScroll` (50+50) on top of its row array. Thumbnail lazy-load callbacks are threaded per zone source: Zone A's renderer keeps the session `handleThumbnailsLoaded` (its rows ARE session rows), Zone B/C renderers receive `searchResults.onZoneThumbnailsLoaded` — the zone-local merge (`useSearchResults.md` §2.3 zone thumbnails); the view holds no merge logic itself (pure-view rule).
  - **Zone headers (sticky):** `position: sticky; top: 0` inside the scroll container with frosted translucent background + bottom divider (standard push-up stacking, plain CSS — no virtualization exists). LEFT: icon + label + count (count in the secondary color, snapshot count): Zone A `FolderOpen` + the current folder path string; Zone B plain `Cloud` (test seam `search-zone-glyph-b`) + `fileManager.searchZoneAllResults` (EN "All results"); Zone C plain `AutoAwesome` wand-stars, unmirrored (test seam `search-zone-glyph-c`) + `fileManager.searchZoneSuggestedResults` (EN "Suggested results"). The button composite glyph is NOT used in zone headers. RIGHT: the accordion toggle, styled as the mobile breadcrumb expand button.
  - **Accordion:** header or toggle click collapses/expands the zone content (MUI Collapse, repo idiom). Collapsed state persists per surface under a dedicated localStorage key following the `collectionMemberViewMode` pattern; defaults: A + B expanded.
  - **Pending:** while `mode === 'pending'` the zone content is replaced by the skeleton matching the `viewMode` (`FileListSkeleton`/`FileGridSkeleton`/`FileDetailSkeleton`, `FileSkeletons.md`), container testid `search-zone-skeleton`.
  - **Empty results:** zero zone rows across A+B ⇒ no zone headers render, a single `fileManager.searchNoResults` line shows in the listing area.
  - **Selection:** the shell feeds the union array (Zone A rows ++ Zone B displayed rows ++ Zone C displayed rows) through the existing selection props (`selectionState`); the view keeps zero selection logic (pure-view rule). The union add-target (`libraryAddTarget`) and the save affordance gate live on the shell-prepared model (`useSearchResults.md` §2.3).
- **Virtual collection nodes:** when the active node is `__collections__` (or its `__archive__` child / an opened collection route), `CollectionsListView` **replaces the FileList region** (list mode = grid-parity cards + merge-card slot; members mode = explorer rows with `MemberRowControls` wiring). All other regions (controls, FAB policy per read-only virtual-view precedent, dialogs) follow the existing `__recent__`/`__shared__`/`__trash__` treatment — **except** the sort control: when `collectionsModel` is in `list` mode (list AND archive surfaces), the view passes `sortSurface='collections'`, `collectionSort=collectionsModel.sort`, `onCollectionSortChange=collectionsModel.onSortChange` to `FileManagerControls` so the single toolbar sort button renders the 5-option server menu; file surfaces keep the files radio menu.
- **Collections surface chrome + selection wiring:** the view derives toolbar flags from `collectionsModel.mode` — LIST/ARCHIVE surface: `viewModeHidden` (grid-parity cards, no file view modes) plus the collections selection cluster props (`collectionsMode`, `collectionsArchiveView` = `include==='mine,archived'`, `onCollectionsBulkAction` = `collectionsModel.onBulkAction`); the view forwards the file-parity selection inputs into `CollectionsListView` (`selectionMode`/`selectedFiles` from `selectionState.selectionModel` plus the shell-prepared `onCardClick`/`onCardLongPressSelect`/`previewThumbnails`/`onPreviewThumbnailsLoaded`/`bulkConfirm`/`onBulkConfirm`/`onBulkConfirmDismiss` from `collectionsModel`) — resolution of click semantics, bulk execution and state stays shell-owned (§2.2 pure-view rule).
- **Members surface (real controls):** the MEMBERS surface renders the view-mode toggles and the sort button — the view passes the FILES-style menu bound to the PER-SURFACE SORT KEY: `sortMode={memberSortMode}` / `setSortMode={setMemberSortMode}` for `isCollectionsMemberSurface` (the `collectionMemberSortMode` session state — shared by the liked surface too, `useExplorerSession.md` §2.3), while the collections LIST surface keeps the 5-option server menu (`sortSurface='collections'`) and file surfaces keep the file `sortMode`. `viewModeHidden=false` with the view-mode buttons BOUND TO THE PER-SURFACE MEMBER KEY: `viewMode={memberViewMode}`, `setViewMode={setMemberViewMode}` (the `collectionMemberViewMode` session state, `useExplorerSession.md` §2.3 — file `viewMode` untouched). `memberMode={true}` plus the selection cluster seams `onBulkMemberExclude={collectionsModel.onBulkMemberExclude}` and `onBulkAddToCollection={collectionsModel.onBulkAddToCollection}` (bulk publish stays banner-driven). The region swap delegates the member rows themselves INSIDE `CollectionsListView` (`CollectionsListView.md` §2.5): the LIST/ARCHIVE surfaces keep replacing the whole file region with the card grid; the members surface renders banners + the shared `FileList`/`FileGrid`/`FileDetail` renderer chosen by `memberViewMode`. Row click/check/long-press flow to `CollectionsListView` via `onMemberRowClick={handleFileClick}` / `onMemberRowCheck={handleFileCheck}` / `onMemberRowLongPressSelect={handleLongPressSelect}` and `onMemberThumbnailsLoaded={collectionsModel.onMemberThumbnailsLoaded}` (member-local merge); the row menu dispatch (`'menu'`, `anchorEl`) rides `collectionsModel.onMemberAction`. The view forwards `memberSortMode` into `CollectionsListView` (the host re-sorts the FULL set before slicing — `CollectionsListView.md` §2.5).
- **Pseudo-tile navigation:** the collections LIST surface forwards
  `onPseudoTileNavigate` (from `collectionsModel`) into `CollectionsListView` — the shell wires it
  to the SAME string-path setter the sidebar rows use (`setCurrentPath('/__collections__/liked' |
'/__collections__/__archive__')`, `useFileManager.md`), never through card-selection machinery.
  Tiles themselves are CollectionsListView-owned (see `CollectionsListView.md` §2.4).
- **Collections breadcrumb chip:** the view passes Breadcrumb
  the resolved collection NAME for the member route: `collectionsModel` (member mode) carries
  `collectionId` + `collections` (the shell's already-fetched `useCollections` list — the view
  finds `name` by id); while the list or the row is missing (`null`), the view passes `null` and
  Breadcrumb renders the transient `Collections › …` segment (never hides it). The liked route is
  route-detected INSIDE Breadcrumb (currentPath parity with trash/recent). The `Collections` chip
  click and the name-chip click ride the existing `onNodeClick` (virtual path strings — shell
  `handleFolderTreeNodeClick` accepts `/__collections__/…`).
- **Likes surface (member-parity consumer):** the view derives `isCollectionsLikedSurface` from the shell-prepared flag `collectionsModel.likedSurface === true` (mode stays `'members'` —
  `CollectionsListView.md` §2.2) and swaps ONLY key binding + seams, never new chrome: the toolbar
  renders the FILES-style sort menu bound to `collectionMemberSortMode` (the members-surface state —
  `FileManagerControls.md` §2.2) and the view-mode buttons bind `likedViewMode`/`setLikedViewMode` (NEITHER the
  file `viewMode`/`setViewMode` NOR `memberViewMode` dispatch when the Likes surface is active);
  `CollectionsListView` receives `memberViewMode = likedSurface ? likedViewMode : memberViewMode`;
  the member bulk cluster seams (`onBulkMemberExclude`/`onBulkAddToCollection`) stay `undefined`
  (the model omits them ⇒ no membership bulk buttons, `FileManagerControls.md` memberMode gate).
  Row click/check/long-press/thumbnail/menu dispatch reuse the exact members-surface forwardings
  (numeric `nodeId` selection; the row menu is the shell's `MemberRowControls` with
  `collection:null`).
- **Otherwise unchanged:** any composition flag absent ⇒ pixel-identical rendering to today; both addenda are additive region swaps.
- **Files-surface membership badges + bulk add (`membershipModel`):** the shell passes the grouped `membershipModel = { membershipsByNodeId, onBulkAddToCollection }` (`useCollectionMemberships.md`, `CollectionMembershipBadges.md` §2.6). The view (i) threads `membershipsByNodeId` into the FILES-surface renderers — the three browse sites and `zoneRendererProps` (search zones render through the same components; snapshot rows get badges from the same map) — and (ii) binds `FileManagerControls.onBulkAddToCollection`: the members surface keeps `collectionsModel.onBulkAddToCollection`; every non-member, non-share surface falls back to `membershipModel.onBulkAddToCollection` (the shell withholds it for admin/share-link sessions ⇒ the button is absent, not disabled). `CollectionsListView` never receives the map — member/liked rows carry no membership badges.
- **Properties `Member of` chips (dialog slot, `FilePropertiesDialog.md` §3.2):** the view passes host-prepared `dialogState.fileTargets.propertiesCollections` as `FilePropertiesDialog.collections` and `explorerHandlers.commands.handleOpenCollectionFromProperties` as `onOpenCollection`. The view resolves neither the map slice nor the route (pure-view rule; the shell owns both); it only forwards the prepared entries for the currently opened `propertiesFile`, so an opened node that is no longer a listing row still gets its chips.
- Prop placement: `searchResults`, `collectionsModel` and `membershipModel` arrive as additional grouped sub-objects (same §2.2 grouping discipline — the view never receives gateways or raw API payloads).

### 3.1 Verification (appends §2.6)

- [ ] (target) `results` mode: the chip bar replaces the breadcrumb row, the three accordion zones (A/B/C) render inside `explorer-container` with sticky frosted headers (icon + label + snapshot count), and rows come from the same list/grid/detail renderer; exit (chip `Exit`, ✕, or folder navigation) restores the normal breadcrumb+list composition.
- [ ] (target) Zone C renders nothing while empty; A+B default expanded; a header/toggle click collapses a zone (Collapse animation) and the collapsed state survives reload through the per-surface localStorage key.
- [ ] (target) Zone C rows render through the shared renderer with the sticky wand header + snapshot count when the semantic snapshot is non-empty (delivered score order, never re-sorted); the chip bar save affordance forwards the model's `onSave` and is absent when the model passes none.
- [ ] (target) `pending` mode shows the viewMode-matching skeleton with testid `search-zone-skeleton` instead of zone content; zero rows overall renders no headers + the `fileManager.searchNoResults` line.
- [ ] (target) The view-mode/sort toolbar keeps the session bindings and its effect is visible in BOTH zones (Zone C keeps the server score order — `useSearchResults.md` §2.3); each zone exposes its own infinite-scroll sentinel.
- [ ] (target) Active node `__collections__`/`__archive__` renders `CollectionsListView` in place of FileList, no file-grid fallback.
- [ ] (target) MEMBERS surface: the toolbar DOES render the sort button (FILES-style radio menu bound to `memberSortMode`/`setMemberSortMode` — clicking a radio calls `setMemberSortMode`, never the file `setSortMode`) and the three view-mode buttons bound to the member key (clicking `view-mode-list` calls `setMemberViewMode`, never the file `setViewMode`); `CollectionsListView` receives `memberViewMode` + `memberSortMode` + the row click/check/thumbnail callbacks; the file `viewMode` renderer region stays unreachable while `collectionsModel` is active.
- [ ] (target) LIKES surface (`collectionsModel.likedSurface`): view-mode buttons call `setLikedViewMode` only; `memberViewMode` and file `viewMode` are untouched; the sort button renders (same `collectionMemberSortMode` state as members); no member bulk cluster buttons; the digest/publish banners are absent (model omits the props).
- [ ] member route: Breadcrumb receives `collectionName` resolved from `collectionsModel.collections` by `collectionId` (transient `…` when unresolved); liked route: `Collections › Liked` renders.
- [ ] (target) LIST/ARCHIVE surfaces keep `viewModeHidden` and the 5-option server sort menu (regression anchors).
- [ ] (target) With both models absent, the view output is unchanged (regression assertion).
- Operator rule (admin is a pure operator): the view never forwards like/add affordances for admin — the shell withholds `handleToggleLike`/`handleOpenAddToCollection` (`undefined` ⇒ `like-toggle`/`collection-add` rows hidden, not disabled; same callback-withhold idiom as share/trash §2.x).
