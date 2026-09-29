# FileManagerControls Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Toolbar for sort, select all/deselect all, view mode (list/grid/detail), and bulk actions (move, copy, download, delete). In selection mode: hides sort and view mode; shows select all, deselect all, and bulk action buttons in a single row. No selection mode toggle — entry/exit driven by file interactions and selected count. The sort button is the ONLY sort control for both surfaces (P-2, 2026-09-29 owner ruling): its menu content swaps by surface — files: the 4 radio options (2×2 name/date × asc/desc, client-side, persisted) ↔ collections: the 5 server sort options (flat menu items, no direction radios — the server bakes the direction, `GET /api/collections?sort=…`; ephemeral, never persisted; see `useCollections.md` §2.3). |
| Used in            | FileManager                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Related components | VIEW_MODES, SORT_MODES, COLLECTION_SORT_OPTIONS constants; CollectionsListView (collections list/archive surfaces)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerControls.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerControls.test.js`

### 2.2 Props

| Name                     | Type     | Required | Default | Description                                                                                                                                                                                                                                                                    |
| ------------------------ | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| isMobile                 | boolean  | Y        | -       | Mobile layout                                                                                                                                                                                                                                                                  |
| selectionMode            | boolean  | Y        | -       | Selection mode active                                                                                                                                                                                                                                                          |
| handleSelectAll          | function | Y        | -       | Select all                                                                                                                                                                                                                                                                     |
| handleDeselectAll        | function | Y        | -       | Deselect all                                                                                                                                                                                                                                                                   |
| selectedFiles            | Set      | Y        | -       | Selected count                                                                                                                                                                                                                                                                 |
| sortMode                 | string   | Y        | -       | SORT_MODES value (files surface menu state)                                                                                                                                                                                                                                    |
| setSortMode              | function | Y        | -       | Set sort mode (files surface dispatch)                                                                                                                                                                                                                                         |
| sortSurface              | string   | N        | 'files' | Active sort surface: `'files' \| 'collections'` — swaps the sort menu content/state (P-2)                                                                                                                                                                                      |
| collectionSort           | string   | N        | -       | Current COLLECTION_SORT_OPTIONS value (`activity\|name\|created\|updated\|similar`); selected item in the collections menu                                                                                                                                                     |
| onCollectionSortChange   | function | N        | -       | Collections sort dispatch `(option) => void` — host wires it to `useCollections.setSort` (ephemeral; no localStorage)                                                                                                                                                          |
| sortHidden               | boolean  | N        | false   | Members-surface contract (P-4, real): the MEMBERS surface hides the sort button + sort menu ENTIRELY — member ordering is server-fixed (activity → node_id), a members sort is out of scope. File surfaces never pass it.                                                                                                                     |
| viewModeHidden           | boolean  | N        | false   | Collections LIST/ARCHIVE surfaces hide the view-mode icon buttons (grid-parity cards have no file view modes). **P-4 retirement:** the MEMBERS surface NO LONGER hides them — the three buttons render and are bound to the per-surface member key by the view (`viewMode`/`setViewMode` carry `memberViewMode`/`setMemberViewMode`, `FileManagerView.md` §3).                                                                                                                       |
| memberMode               | boolean  | N        | false   | P-4 real contract: the collection MEMBERS surface while `selectionMode` — the cluster shows Bulk exclude + Bulk add-to-collection and hides move/copy/download/delete. `viewModeHidden` is NOT set for members anymore; `sortHidden` IS (server-fixed ordering).                                                                                                                                             |
| onBulkMemberExclude      | function | N        | -       | `(nodeIds: number[]) => void` — bulk exclude dispatch (`data-testid="bulk-member-exclude"`); execution (per-item-tolerant `DELETE /:id/items` loop, journal per collection = the owning collection of the current surface) is SHELL-owned. Members surface only.                                                                                                                                            |
| onBulkAddToCollection    | function | N        | -       | `(nodeIds: number[]) => void` — bulk add dispatch (`data-testid="bulk-collection-add"`; members title `fileManager.memberAddToOther`). Members surface wires it to the shell's single `AddToCollectionMenu` instance (same flow as the file-side single-row submenu).                                                                                                                                        |
| collectionsMode          | boolean  | N        | false   | Collections LIST/ARCHIVE surface while `selectionMode`: the selection cluster shows the fixed collections bulk set instead of the file bulk buttons.                                                                                                                           |
| collectionsArchiveView   | boolean  | N        | false   | Archive surface (`include=mine,archived`): bulk set = Restore · Delete permanently; otherwise Pin · Unpin · Archive.                                                                                                                                                           |
| onCollectionsBulkAction  | function | N        | -       | `(action: 'pin' \| 'unpin' \| 'archive' \| 'restore' \| 'delete-permanent') => void` — bulk dispatch; execution (loop over the existing single-collection calls, confirms via the view-hosted dialog, per-item failure tolerance, journal/undo per collection) is SHELL-owned. |
| viewMode                 | string   | Y        | -       | VIEW_MODES value                                                                                                                                                                                                                                                               |
| setViewMode              | function | Y        | -       | Set view mode                                                                                                                                                                                                                                                                  |
| selectionActionsDisabled | boolean  | N        | false   | Disable selection actions                                                                                                                                                                                                                                                      |
| handleBulkMove           | function | N        | -       | Bulk move handler (when selectionMode)                                                                                                                                                                                                                                         |
| handleBulkCopy           | function | N        | -       | Bulk copy handler (when selectionMode)                                                                                                                                                                                                                                         |
| handleBulkDownload       | function | N        | -       | Bulk download handler (when selectionMode)                                                                                                                                                                                                                                     |
| openBulkDeleteDialog     | function | N        | -       | Bulk delete handler; receives (filePaths: string[]) (when selectionMode)                                                                                                                                                                                                       |
| bulkWritePermission      | boolean  | N        | true    | Whether write actions (move, delete) allowed for bulk ops                                                                                                                                                                                                                      |
| hasReadOnlyInSelection   | boolean  | N        | false   | Show read-only warning when some selected are read-only                                                                                                                                                                                                                        |
| bulkActionsDisabled      | boolean  | N        | false   | Disable all bulk action buttons                                                                                                                                                                                                                                                |
| downloadOnly             | boolean  | N        | false   | Hide move, copy, delete; show only download (e.g. share link mode)                                                                                                                                                                                                             |
| trashMode                | boolean  | N        | false   | Trash view: selection toolbar shows Restore + Permanent delete instead of Move/Copy/Download/Delete                                                                                                                                                                            |
| handleBulkRestore        | function | N        | -       | Trash bulk restore handler; receives `(nodeIds: number[])` (when selectionMode + trashMode)                                                                                                                                                                                    |
| handleBulkPurge          | function | N        | -       | Trash bulk permanent-delete handler; receives (nodeIds: number[]) (when selectionMode + trashMode)                                                                                                                                                                             |
| onEmptyTrash             | function | N        | -       | Empty-trash click (when !selectionMode). Admin-only trash control — rendered only when the host passes it (`user.is_admin` + trash view)                                                                                                                                       |

### 2.3 Callback Signatures

| Callback               | When invoked                               | Arguments             |
| ---------------------- | ------------------------------------------ | --------------------- |
| handleSelectAll        | Select all click                           | -                     |
| handleDeselectAll      | Deselect all click                         | -                     |
| setSortMode            | Sort option selected (files surface)       | (mode)                |
| onCollectionSortChange | Sort option selected (collections surface) | (option)              |
| setViewMode            | View option selected                       | (mode)                |
| handleBulkMove         | Move button click                          | -                     |
| handleBulkCopy         | Copy button click                          | -                     |
| handleBulkDownload     | Download button click                      | -                     |
| openBulkDeleteDialog   | Delete button click                        | (filePaths: string[]) |
| handleBulkRestore      | Trash restore click                        | (nodeIds: number[])   |
| handleBulkPurge        | Trash purge click                          | (nodeIds: number[])   |
| onEmptyTrash           | Empty-trash icon click                     | -                     |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Box/IconButton/Button/Menu/MenuItem/Radio/RadioGroup/FormControlLabel/Divider/Typography, VIEW_MODES, SORT_MODES, COLLECTION_SORT_OPTIONS, Move/Copy/Download/Delete icons from @mui/icons-material
- **Reference implementation:** `client/src/components/file-manager/FileManagerControls.js`

Notes:

- The control should keep its own transient menu-open state (such as the sort menu anchor) instead of pushing that shell-chrome state up into `FileManager`.
- The collections list/archive surfaces render no sort control of their own (`CollectionsListView.md` §2.3 — private menu retired with P-2); the host passes `sortSurface='collections'` plus `collectionSort`/`onCollectionSortChange` and this toolbar owns the menu.

### 2.5 i18n Keys

- `fileManager.sort`, `fileManager.sortByName`, `fileManager.sortByDate`, `fileManager.asc`, `fileManager.desc`
- `fileManager.collectionsSortActivity` / `collectionsSortName` / `collectionsSortCreated` / `collectionsSortUpdated` / `collectionsSortSimilar` – collections-surface menu labels (shared keys with the retired CollectionsListView menu; `collectionsSortMenu` stays as the generic title key)
- `fileManager.selectionMode`, `fileManager.selectAll`, `fileManager.deselectAll`, `fileManager.selectedCount`, `fileManager.selectedCountFull`
- `fileManager.viewMode`, `fileManager.listView`, `fileManager.gridView`, `fileManager.detailView`, `fileManager.listViewTitle`, `fileManager.gridViewTitle`, `fileManager.detailViewTitle`
- `fileManager.readOnlyInSelection` – warning when hasReadOnlyInSelection
- `actions.move`, `actions.copy`, `actions.download`, `actions.delete` – bulk action titles
- `actions.restore`, `actions.purge` – trash bulk action titles
- `actions.emptyTrash` – empty-trash icon button title/aria-label

### 2.6 Conditional Rendering

- **selectionMode:** Hide sort button, sort menu, and view mode. Show: select all, deselect all, selected count (desktop only; hidden on mobile to save space), move, copy, download, delete (single row). downloadOnly hides move, copy, delete. bulkWritePermission disables move/delete. bulkActionsDisabled disables all bulk actions. hasReadOnlyInSelection: on desktop shows inline caption; on mobile shows gray-background banner below the toolbar row. **Download on mobile:** On mobile, when multiple items are selected (`selectedFiles.size > 1`), the download button is disabled (grayed out); only single-item download is allowed on mobile.
- **!selectionMode:** Show sort button, sort menu, view mode (direct icon buttons). No select all/deselect all, no bulk action buttons. **Toggle hiding (P-4 real contract):** `sortHidden` removes the sort button AND its menu entirely — members surface only (server-fixed member ordering; the P-3 "until P-4 ships real member controls" note is resolved: the members surface keeps the sort hidden BY CONTRACT and shows the view-mode buttons); `viewModeHidden` removes the list/grid/detail buttons — LIST/ARCHIVE collection surfaces only (grid-parity cards; members got their own toggles with P-4, bound to `collectionMemberViewMode` via the view's prop swap). The view-mode box keeps hosting `onEmptyTrash` when present.
- **Collections selection cluster (P-3):** while `selectionMode && collectionsMode`, the file bulk buttons (move/copy/download/delete, member/trash affordances) are NOT rendered — a fixed, count-INDEPENDENT set replaces them (files philosophy: the same buttons always show, disabled while nothing is selected): active view ⇒ Pin · Unpin · Archive (`data-testid="bulk-collections-pin|unpin|archive"`); archive view (`collectionsArchiveView`) ⇒ Restore · Delete permanently (`bulk-collections-restore`, `bulk-collections-delete-permanent`, `color="error"`). NO Rename/Leave/Sharing/Move/Copy/Download. Select all / deselect all / "N selected" stay as-is (the host's select-all source includes the card keys). Titles reuse `fileManager.cardMenuPin/Unpin/Archive/Restore/Delete`. Clicks dispatch `onCollectionsBulkAction(action)`; `pin/unpin/restore` execute directly, `archive`/`delete-permanent` open the confirms hosted by `CollectionsListView` (shell-driven state) — execution + batching live in the shell.
- **Sort menu surface swap (P-2):** same trigger button (`data-testid="file-manager-sort"`, `fileManager.sort` title) for both surfaces; the menu body renders from `sortSurface`:
  - `files` (default): the existing two grouped RadioGroups (Name asc/desc, Date asc/desc over SORT_MODES) dispatching `setSortMode(mode)` and closing the menu.
  - `collections`: five flat MenuItems (one per COLLECTION_SORT_OPTIONS value, labeled via `fileManager.collectionsSort*`, `data-testid="collections-sort-option-<option>"`), the item matching `collectionSort` marked selected; NO RadioGroup/Divider (server bakes direction: name ASC, created/updated/activity DESC — `routes/collections.md` GET /). Click dispatches `onCollectionSortChange(option)` and closes the menu. State is ephemeral — nothing here touches localStorage (files `sortMode` persistence stays upstream in `useExplorerSession`).
- **Trash mode:**
  - selectionMode: select all / deselect all / count stay; Move, Copy, Download, Delete are hidden; Restore (`data-testid="trash-bulk-restore"`) and Permanent delete (`data-testid="trash-bulk-purge"`, `color="error"`) icon buttons render instead, gated by `bulkActionsDisabled`/`bulkWritePermission` (row-level write permission from the trash selection).
  - !selectionMode: the Empty-trash admin icon button (`data-testid="trash-empty"`, `color="error"`, `actions.emptyTrash` title) renders next to the sort/view-mode toggles when `onEmptyTrash` is provided; ≥44px touch target.
- !isMobile: detail view option; select all/deselect as Button with icon
- isMobile: select all/deselect as IconButton; no detail view

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Sort menu opens from the control itself and sort options change `sortMode`
- [ ] Collections surface (`sortSurface='collections'`): the same `file-manager-sort` trigger opens a flat 5-option menu (`collections-sort-option-*` testids), current `collectionSort` selected, no radio groups; clicking dispatches `onCollectionSortChange(option)` and closes the menu
- [ ] Files surface regression: default props render the 4 radios (2 grouped RadioGroups) and dispatch `setSortMode` only
- [ ] Select all, deselect all (no selection mode toggle)
- [ ] View mode buttons/menu (when !selectionMode)
- [ ] selectionActionsDisabled disables selection actions
- [ ] Detail view hidden on mobile
- [ ] When selectionMode, sort button and view mode not in document
- [ ] When selectionMode, move, copy, download, delete buttons in document
- [ ] When selectionMode and downloadOnly, move/copy/delete hidden
- [ ] Bulk action clicks invoke corresponding callbacks
- [ ] bulkActionsDisabled disables bulk action buttons
- [ ] bulkWritePermission=false disables move and delete
- [ ] On mobile with multiple items selected, download button is disabled
- [ ] Trash mode: selection toolbar shows trash-bulk-restore / trash-bulk-purge instead of move/copy/download/delete; clicks pass the selected node ids
- [ ] P-3 collections surface: `collectionsMode` + `selectionMode` shows the fixed bulk set (active: `bulk-collections-pin/unpin/archive`; `collectionsArchiveView`: `bulk-collections-restore` + `bulk-collections-delete-permanent`) and NO file/member/trash bulk buttons; clicks dispatch `onCollectionsBulkAction(action)`
- [ ] P-3 toggle hiding: `viewModeHidden` removes the view-mode buttons; `sortHidden` removes the sort button (and its menu) — files surface (`sortSurface='files'`, no hide flags) renders both unchanged
- [ ] Trash mode: trash-bulk-restore / trash-bulk-purge disabled by bulkActionsDisabled or no row write permission
- [ ] Empty-trash icon renders only when onEmptyTrash is provided and triggers it on click
- [ ] On mobile with multiple items selected, download button is disabled

### 2.8 Edge Cases

- Detail view only on desktop
