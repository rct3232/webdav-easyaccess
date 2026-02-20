# FilePropertiesDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog showing file/folder properties: thumbnail, type, size, modified date, path, and permissions. Fetches permissions via getFolderPermissions. |
| Used in | FileManager (Properties from context menu) |
| Related components | getFileIcon, getThumbnail, formatFileSize, formatDate, getFolderPermissions |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FilePropertiesDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/FilePropertiesDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| file | object | Y | - | File object |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Dialog close | - |

### 2.4 Dependencies

- **imports:** getFolderPermissions, getFileIcon, getThumbnail, formatFileSize, formatDate, getPermissionLabels
- **Reference implementation:** `client/src/components/dialogs/FilePropertiesDialog.js`

### 2.5 i18n Keys

- `dialogs.type`, `dialogs.size`, `dialogs.modifiedDate`, `dialogs.path`, `dialogs.permissions`, `actions.folder`, `actions.file`

### 2.6 Conditional Rendering

- Directory: no size; folder type
- File: size, mime
- Permission groups by PERMISSION_ORDER

### 2.7 Verification Scenarios

- [ ] Renders properties, permissions
- [ ] getFolderPermissions called when open
- [ ] Returns null when !file

### 2.8 Edge Cases

- !file – return null
