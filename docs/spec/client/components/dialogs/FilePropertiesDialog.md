# FilePropertiesDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog showing file/folder properties: thumbnail, type, size, modified date, path, and permissions. Fetches permissions via getFolderPermissions. For directories, fetches recursive statistics (fileCount, totalSize) via getFolderStats and shows a default banner/layout (gradient, icon+name block). |
| Used in | FileManager (Properties from context menu) |
| Related components | getFileIcon, getThumbnail, formatFileSize, formatDate, getFolderPermissions, getFolderStats (fileService), getParentPath (shared pathUtils) |

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

- **imports:** getFolderPermissions, getFolderStats (fileService), getFileIcon, getThumbnail, formatFileSize, formatDate, getPermissionLabels, getParentPath (shared pathUtils)
- **Reference implementation:** `client/src/components/dialogs/FilePropertiesDialog.js`

### 2.5 i18n Keys

- `dialogs.type`, `dialogs.size`, `dialogs.modifiedDate`, `dialogs.path`, `dialogs.permissions`, `actions.folder`, `actions.file`, `fileManager.folderStatsFormat` (for directory stats: count, size)
- Locale requirement: `fileManager.folderStatsFormat` must exist in all supported locales (currently `en`, `ko`) to avoid rendering raw key text.

### 2.6 Conditional Rendering

- **Directory:** `getFolderStats(file.path)` called when open; folderStats and statsLoading state; Skeleton while stats loading; size row shows folderStatsFormat (`fileCount`, `totalSize`) or placeholder (`-`).
- **File:** size, mime; no folder stats.
- **Top block:** Thumbnail/gradient banner; icon + name block (e.g. minHeight 120); gradient overlay when no thumbnail.
- Permission groups by PERMISSION_ORDER
- Async fallback: permission/stats API failures are non-fatal. UI falls back to empty permissions and placeholder size without crashing.

### 2.7 Verification Scenarios

- [ ] Renders properties, permissions
- [ ] `getFolderPermissions` called when open and returns Promise-based result
- [ ] `getFolderStats` called when open and file is directory
- [ ] Directory: Skeleton or folderStats (fileCount, totalSize) displayed; folderStatsFormat i18n used
- [ ] Permission/stats request failure still renders dialog (fallback values shown)
- [ ] Returns null when !file

### 2.8 Edge Cases

- !file – return null
