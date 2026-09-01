# FolderPickerDialog Spec

## 1. Overview

| Item               | Description                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Role               | Dialog to select a destination folder. Shows breadcrumbs, folder list from useFolderPicker, home/shared toggle for copy/move. |
| Used in            | Move, copy, share target selection                                                                                            |
| Related components | useFolderPicker, useResponsive, MUI Dialog/List/Breadcrumbs                                                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderPickerDialog/FolderPickerDialog.js`
- **Test file:** `client/src/components/dialogs/FolderPickerDialog/__tests__/FolderPickerDialog.test.js`

### 2.2 Props

| Name          | Type           | Required | Default                        | Description                                                  |
| ------------- | -------------- | -------- | ------------------------------ | ------------------------------------------------------------ |
| open          | boolean        | Y        | -                              | Whether dialog is open                                       |
| onClose       | function       | Y        | -                              | Close handler                                                |
| onSelect      | function       | Y        | -                              | Called with selectedNodeId when Select clicked               |
| title         | string         | N        | t('dialogs.folderSelectTitle') | Dialog title                                                 |
| currentNodeId | number \| null | N        | -                              | Initial/current folder nodeId                                |
| user          | object         | N        | -                              | User object (for home/shared toggle visibility)              |
| action        | string         | N        | -                              | 'copy' or 'move' – affects toggle and destination validation |
| sourceNodeId  | number         | N        | -                              | Single source nodeId (for move/copy)                         |
| sourceNodeIds | array          | N        | -                              | Multiple source nodeIds                                      |

### 2.3 Callback Signatures

| Callback | When invoked           | Arguments                        |
| -------- | ---------------------- | -------------------------------- |
| onClose  | Cancel or dialog close | -                                |
| onSelect | Select button click    | (selectedNodeId: number \| null) |

### 2.4 Dependencies

- **imports:** React, useTranslation, useFolderPicker, useResponsive, MUI Dialog/List/Breadcrumbs/Box/Typography/CircularProgress/IconButton/Tooltip, folder/home/share icons
- **Reference implementation:** `client/src/components/dialogs/FolderPickerDialog/FolderPickerDialog.js`

### 2.5 i18n Keys

- `dialogs.folderSelectTitle` – default title
- `dialogs.currentPathLabel` – label above breadcrumbs
- `nav.breadcrumb` – aria-label
- `nav.home` – home crumb name
- `dialogs.noSubfolders` – empty state
- `dialogs.select` – select button
- `common.cancel` – cancel button
- `dialogs.switchToShared` / `dialogs.switchToHome` – toggle tooltip

### 2.6 Conditional Rendering

- Home/Shared toggle shown when (action === 'copy' \|\| action === 'move') && user && !user.is_admin
- Select disabled when at the shared root (`getCurrentPathType() === 'shared' && selectedNodeId == null`) or (copy/move && !hasWritePermission) or isInvalidDestination()
- Hidden folders (isHidden, basename starts with '.') rendered with reduced opacity
- Folders without read permission disabled

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Breadcrumbs render, nodeId click navigates
- [ ] Folder list from useFolderPicker, folder click updates selection
- [ ] Select disabled for the shared root and invalid destinations
- [ ] onSelect called with selectedNodeId, then onClose
- [ ] Home/Shared toggle visible for non-admin in copy/move
- [ ] Loading state shows CircularProgress
- [ ] Empty folders shows noSubfolders message

### 2.8 Edge Cases

- Shared root (selectedNodeId null while `getCurrentPathType() === 'shared'`) – Select disabled, handleSelect returns early
- isInvalidDestination – from useFolderPicker (e.g. source nodeId === destination nodeId)
- fullScreen on mobile via useResponsive
- Admin home root (selectedNodeId null while `getCurrentPathType() === 'home'`) remains selectable
