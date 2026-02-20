# FileManagerControls Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Toolbar for sort, selection mode toggle, select all/deselect all, view mode (list/grid/detail). Menus for sort and view mode. |
| Used in | FileManager |
| Related components | VIEW_MODES, SORT_MODES constants |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerControls.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerControls.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isMobile | boolean | Y | - | Mobile layout |
| selectionMode | boolean | Y | - | Selection mode active |
| handleToggleSelectionMode | function | Y | - | Toggle selection mode |
| handleSelectAll | function | Y | - | Select all |
| handleDeselectAll | function | Y | - | Deselect all |
| selectedFiles | Set | Y | - | Selected count |
| setSortMenuAnchor | function | Y | - | Open/close sort menu |
| sortMenuAnchor | element | Y | - | Sort menu anchor |
| sortMode | string | Y | - | SORT_MODES value |
| setSortMode | function | Y | - | Set sort mode |
| saveSortMode | function | N | - | Persist sort mode |
| setViewModeMenuAnchor | function | Y | - | View mode menu anchor setter |
| viewModeMenuAnchor | element | Y | - | View mode menu anchor |
| viewMode | string | Y | - | VIEW_MODES value |
| setViewMode | function | Y | - | Set view mode |
| saveViewMode | function | N | - | Persist view mode |
| selectionActionsDisabled | boolean | N | false | Disable selection actions |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| handleToggleSelectionMode | Selection toggle click | - |
| handleSelectAll | Select all click | - |
| handleDeselectAll | Deselect all click | - |
| setSortMode / saveSortMode | Sort option selected | (mode) |
| setViewMode / saveViewMode | View option selected | (mode) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Box/IconButton/Button/Menu/MenuItem/Radio/RadioGroup/FormControlLabel/Divider/Typography, VIEW_MODES, SORT_MODES
- **Reference implementation:** `client/src/components/file-manager/FileManagerControls.js`

### 2.5 i18n Keys

- `fileManager.sort`, `fileManager.sortByName`, `fileManager.sortByDate`, `fileManager.asc`, `fileManager.desc`
- `fileManager.select`, `fileManager.selectionMode`, `fileManager.selectAll`, `fileManager.deselectAll`, `fileManager.selectedCount`, `fileManager.selectedCountFull`
- `fileManager.viewMode`, `fileManager.listView`, `fileManager.gridView`, `fileManager.detailView`, `fileManager.listViewTitle`, `fileManager.gridViewTitle`, `fileManager.detailViewTitle`

### 2.6 Conditional Rendering

- selectionMode: select all/deselect all buttons; view mode as menu (mobile) or direct buttons (desktop)
- !selectionMode: view mode as direct icon buttons
- !isMobile: detail view option; select all/deselect as Button with icon
- isMobile: select all/deselect as IconButton; view mode as menu; no detail view

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Sort menu opens, sort options change sortMode and call saveSortMode
- [ ] Selection toggle, select all, deselect all
- [ ] View mode buttons/menu
- [ ] selectionActionsDisabled disables selection actions
- [ ] Detail view hidden on mobile

### 2.8 Edge Cases

- saveSortMode/saveViewMode optional
- Detail view only on desktop
