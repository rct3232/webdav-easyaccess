# FileManagerControls Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Toolbar for sort, select all/deselect all, view mode (list/grid/detail), and bulk actions (move, copy, download, delete). In selection mode: hides sort and view mode; shows select all, deselect all, and bulk action buttons in a single row. No selection mode toggle — entry/exit driven by file interactions and selected count. |
| Used in            | FileManager                                                                                                                                                                                                                                                                                                                           |
| Related components | VIEW_MODES, SORT_MODES constants                                                                                                                                                                                                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerControls.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerControls.test.js`

### 2.2 Props

| Name                     | Type     | Required | Default | Description                                                                                                                              |
| ------------------------ | -------- | -------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| isMobile                 | boolean  | Y        | -       | Mobile layout                                                                                                                            |
| selectionMode            | boolean  | Y        | -       | Selection mode active                                                                                                                    |
| handleSelectAll          | function | Y        | -       | Select all                                                                                                                               |
| handleDeselectAll        | function | Y        | -       | Deselect all                                                                                                                             |
| selectedFiles            | Set      | Y        | -       | Selected count                                                                                                                           |
| sortMode                 | string   | Y        | -       | SORT_MODES value                                                                                                                         |
| setSortMode              | function | Y        | -       | Set sort mode                                                                                                                            |
| viewMode                 | string   | Y        | -       | VIEW_MODES value                                                                                                                         |
| setViewMode              | function | Y        | -       | Set view mode                                                                                                                            |
| selectionActionsDisabled | boolean  | N        | false   | Disable selection actions                                                                                                                |
| handleBulkMove           | function | N        | -       | Bulk move handler (when selectionMode)                                                                                                   |
| handleBulkCopy           | function | N        | -       | Bulk copy handler (when selectionMode)                                                                                                   |
| handleBulkDownload       | function | N        | -       | Bulk download handler (when selectionMode)                                                                                               |
| openBulkDeleteDialog     | function | N        | -       | Bulk delete handler; receives (filePaths: string[]) (when selectionMode)                                                                 |
| bulkWritePermission      | boolean  | N        | true    | Whether write actions (move, delete) allowed for bulk ops                                                                                |
| hasReadOnlyInSelection   | boolean  | N        | false   | Show read-only warning when some selected are read-only                                                                                  |
| bulkActionsDisabled      | boolean  | N        | false   | Disable all bulk action buttons                                                                                                          |
| downloadOnly             | boolean  | N        | false   | Hide move, copy, delete; show only download (e.g. share link mode)                                                                       |
| trashMode                | boolean  | N        | false   | Trash view (DEF-16 P9): selection toolbar shows Restore + Permanent delete instead of Move/Copy/Download/Delete                          |
| handleBulkRestore        | function | N        | -       | Trash bulk restore handler; receives `(nodeIds: number[])` (when selectionMode + trashMode)                                              |
| handleBulkPurge          | function | N        | -       | Trash bulk permanent-delete handler; receives (nodeIds: number[]) (when selectionMode + trashMode)                                       |
| onEmptyTrash             | function | N        | -       | Empty-trash click (when !selectionMode). Admin-only trash control — rendered only when the host passes it (`user.is_admin` + trash view) |

### 2.3 Callback Signatures

| Callback             | When invoked           | Arguments             |
| -------------------- | ---------------------- | --------------------- |
| handleSelectAll      | Select all click       | -                     |
| handleDeselectAll    | Deselect all click     | -                     |
| setSortMode          | Sort option selected   | (mode)                |
| setViewMode          | View option selected   | (mode)                |
| handleBulkMove       | Move button click      | -                     |
| handleBulkCopy       | Copy button click      | -                     |
| handleBulkDownload   | Download button click  | -                     |
| openBulkDeleteDialog | Delete button click    | (filePaths: string[]) |
| handleBulkRestore    | Trash restore click    | (nodeIds: number[])   |
| handleBulkPurge      | Trash purge click      | (nodeIds: number[])   |
| onEmptyTrash         | Empty-trash icon click | -                     |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Box/IconButton/Button/Menu/MenuItem/Radio/RadioGroup/FormControlLabel/Divider/Typography, VIEW_MODES, SORT_MODES, Move/Copy/Download/Delete icons from @mui/icons-material
- **Reference implementation:** `client/src/components/file-manager/FileManagerControls.js`

Notes:

- The control should keep its own transient menu-open state (such as the sort menu anchor) instead of pushing that shell-chrome state up into `FileManager`.

### 2.5 i18n Keys

- `fileManager.sort`, `fileManager.sortByName`, `fileManager.sortByDate`, `fileManager.asc`, `fileManager.desc`
- `fileManager.selectionMode`, `fileManager.selectAll`, `fileManager.deselectAll`, `fileManager.selectedCount`, `fileManager.selectedCountFull`
- `fileManager.viewMode`, `fileManager.listView`, `fileManager.gridView`, `fileManager.detailView`, `fileManager.listViewTitle`, `fileManager.gridViewTitle`, `fileManager.detailViewTitle`
- `fileManager.readOnlyInSelection` – warning when hasReadOnlyInSelection
- `actions.move`, `actions.copy`, `actions.download`, `actions.delete` – bulk action titles
- `actions.restore`, `actions.purge` – trash bulk action titles (DEF-16 P9)
- `actions.emptyTrash` – empty-trash icon button title/aria-label (DEF-16 P9)

### 2.6 Conditional Rendering

- **selectionMode:** Hide sort button, sort menu, and view mode. Show: select all, deselect all, selected count (desktop only; hidden on mobile to save space), move, copy, download, delete (single row). downloadOnly hides move, copy, delete. bulkWritePermission disables move/delete. bulkActionsDisabled disables all bulk actions. hasReadOnlyInSelection: on desktop shows inline caption; on mobile shows gray-background banner below the toolbar row. **Download on mobile:** On mobile, when multiple items are selected (`selectedFiles.size > 1`), the download button is disabled (grayed out); only single-item download is allowed on mobile.
- **!selectionMode:** Show sort button, sort menu, view mode (direct icon buttons). No select all/deselect all, no bulk action buttons.
- **Trash mode (DEF-16 P9):**
  - selectionMode: select all / deselect all / count stay; Move, Copy, Download, Delete are hidden; Restore (`data-testid="trash-bulk-restore"`) and Permanent delete (`data-testid="trash-bulk-purge"`, `color="error"`) icon buttons render instead, gated by `bulkActionsDisabled`/`bulkWritePermission` (row-level write permission from the trash selection).
  - !selectionMode: the Empty-trash admin icon button (`data-testid="trash-empty"`, `color="error"`, `actions.emptyTrash` title) renders next to the sort/view-mode toggles when `onEmptyTrash` is provided; ≥44px touch target.
- !isMobile: detail view option; select all/deselect as Button with icon
- isMobile: select all/deselect as IconButton; no detail view

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Sort menu opens from the control itself and sort options change `sortMode`
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
- [ ] Trash mode: trash-bulk-restore / trash-bulk-purge disabled by bulkActionsDisabled or no row write permission
- [ ] Empty-trash icon renders only when onEmptyTrash is provided and triggers it on click
- [ ] On mobile with multiple items selected, download button is disabled

### 2.8 Edge Cases

- Detail view only on desktop
