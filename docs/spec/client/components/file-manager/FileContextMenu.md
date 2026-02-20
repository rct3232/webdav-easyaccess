# FileContextMenu Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Context menu for file actions: download, rename, move, copy, share, properties, delete. Positioned at mouse coordinates. |
| Used in | FileManager (desktop right-click) |
| Related components | MUI Menu, MenuItem |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileContextMenu.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileContextMenu.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| contextMenu | { mouseX, mouseY } \| null | Y | - | Position or null when closed |
| onClose | function | Y | - | Close handler |
| file | object | Y | - | File object |
| user | object | N | - | User |
| hasWritePermission | boolean | Y | - | Default write permission |
| onDownload | function | N | - | Download handler |
| onRename | function | N | - | Rename handler |
| onMove | function | N | - | Move handler |
| onCopy | function | N | - | Copy handler |
| onShare | function | N | - | Share handler |
| onProperties | function | N | - | Properties handler |
| onDelete | function | N | - | Delete handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Menu close | - |
| handleAction(callback) | Menu item click | calls onClose first, then callback(file) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Menu/MenuItem/ListItemIcon/ListItemText, action icons
- **Reference implementation:** `client/src/components/file-manager/FileContextMenu.js`

### 2.5 i18n Keys

- `actions.download`, `actions.rename`, `actions.move`, `actions.copy`, `actions.share`, `actions.properties`, `actions.delete`

### 2.6 Conditional Rendering

- Menu items only when corresponding callback provided
- Rename, move, delete disabled when !fileWritePermission (file.hasWritePermission ?? hasWritePermission)
- Returns null when !file

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Opens at contextMenu position
- [ ] Each action calls callback with file, then onClose
- [ ] Rename/move/delete disabled when no write permission
- [ ] file.hasWritePermission overrides hasWritePermission
- [ ] onClose on menu close

### 2.8 Edge Cases

- file null – returns null
- anchorReference="anchorPosition", anchorPosition from contextMenu
