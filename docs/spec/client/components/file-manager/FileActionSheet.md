# FileActionSheet Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                   |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Mobile bottom sheet for file actions. Replaces context menu with touch-friendly list: preview, properties, download, rename, move, copy, share, delete. Opens only via More (⋮) button tap on each file item; long-press does not open it (long-press enters selection mode). |
| Used in            | FileManager (mobile)                                                                                                                                                                                                                                                          |
| Related components | SwipeableDrawer, getFileIcon                                                                                                                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileActionSheet.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileActionSheet.test.js`

### 2.2 Props

| Name               | Type     | Required | Default | Description              |
| ------------------ | -------- | -------- | ------- | ------------------------ |
| open               | boolean  | Y        | -       | Drawer open              |
| onClose            | function | Y        | -       | Close handler            |
| file               | object   | Y        | -       | File object              |
| onDownload         | function | N        | -       | Download handler         |
| onRename           | function | N        | -       | Rename handler           |
| onMove             | function | N        | -       | Move handler             |
| onCopy             | function | N        | -       | Copy handler             |
| onDelete           | function | N        | -       | Delete handler           |
| onShare            | function | N        | -       | Share handler            |
| onPreview          | function | N        | -       | Preview handler          |
| onProperties       | function | N        | -       | Properties handler       |
| hasWritePermission | boolean  | N        | true    | Default write permission |
| user               | object   | N        | -       | User                     |

### 2.3 Callback Signatures

| Callback     | When invoked    | Arguments                   |
| ------------ | --------------- | --------------------------- |
| onClose      | Drawer close    | -                           |
| handleAction | List item click | calls action() then onClose |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI SwipeableDrawer/List/ListItem/ListItemIcon/ListItemText/Divider/Box/Typography/Avatar, getFileIcon
- **Reference implementation:** `client/src/components/file-manager/FileActionSheet.js`

### 2.5 i18n Keys

- `actions.preview`, `actions.properties`, `actions.download`, `actions.rename`, `actions.move`, `actions.copy`, `actions.share`, `actions.delete`, `actions.folder`, `actions.file`

### 2.6 Conditional Rendering

- Returns null when !file
- Preview only when file.canPreview && onPreview
- Rename, move, delete only when fileWritePermission
- file.hasWritePermission overrides hasWritePermission
- Delete with divider above, error color
- E2E selector contract:
  - action rows that must be shared with the desktop context-menu flow expose stable `data-testid` values (for example rename/delete)
  - this keeps mobile and desktop action selection aligned even though the rendered component differs
  - mobile CRUD flow tests may rely on these stable action rows to verify rename/delete through the action sheet without depending on localized list text

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] File header with icon, basename, folder/file label
- [ ] Each action invokes callback then onClose
- [ ] Rename/move/delete hidden when !fileWritePermission
- [ ] Preview shown only when canPreview

### 2.8 Edge Cases

- Safe area inset padding
- file.basename \|\| file.name for display
