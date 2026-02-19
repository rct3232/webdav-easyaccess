# FolderShareSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Section wrapping folder tree in ShareDialog. Handles loading, empty state, and conditional root (user home vs children only). |
| Used in | ShareDialog |
| Related components | ShareFolderTree (via renderFolderTreeWrapper) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/FolderShareSection.js`
- **Test file:** `client/src/components/__tests__/FolderShareSection.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| loadingAllFolders | boolean | Y | - | Loading |
| folderTree | Map | Y | - | Folder tree |
| isAdminMode | boolean | Y | - | Admin mode |
| startFromUserHome | boolean | Y | - | Start from user home |
| username | string | N | - | Username |
| isShareMode | boolean | Y | - | Share mode |
| isReviewMode | boolean | Y | - | Review mode |
| user | object | N | - | User |
| rootPath | string | Y | - | Root path |
| renderFolderTreeWrapper | function | Y | - | Renders tree (path, level) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| renderFolderTreeWrapper | Render tree | (path, level) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Box/Typography/CircularProgress
- **Reference implementation:** `client/src/components/dialogs/FolderShareSection.js`

### 2.5 i18n Keys

- `dialogs.loadingFolders`, `dialogs.noSubfolders`

### 2.6 Conditional Rendering

- loadingAllFolders: spinner
- folderTree.size === 0: loading text
- User home case: show children only, skip user base node

### 2.7 Verification Scenarios

- [ ] Loading, empty states
- [ ] renderFolderTreeWrapper called with correct path/level

### 2.8 Edge Cases

- User base node no children: noSubfolders
