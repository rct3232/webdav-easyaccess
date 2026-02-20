# FolderTreeActionBar Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Action bar above the folder tree (desktop sidebar): Create folder, Upload, or (share link mode) Add to shared / Login |
| Used in | FileManager (inserted directly in the sidebar layout, not inside FolderTree) |
| Related components | FolderTree, FileManager |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/FolderTreeActionBar.js`
- **Test file:** `client/src/components/folder-tree/__tests__/FolderTreeActionBar.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| showShareLinkActions | boolean | N | false | When true, show Add to shared / Login instead of Create folder / Upload |
| shareLinkActions | object | N | - | `{ user, onLoginClick, onAddToSharedClick }` when showShareLinkActions |
| onCreateFolder | function | N | - | Create folder callback |
| onUploadFile | function | N | - | Upload callback |
| hasWritePermission | boolean | N | - | Disable Create folder / Upload when false |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onCreateFolder | Create folder button click | - |
| onUploadFile | Upload button click | - |
| onLoginClick | Login button click (share link mode) | - |
| onAddToSharedClick | Add to shared button click (share link mode) | - |

### 2.4 Dependencies

- **imports:** useTranslation, MUI Box, IconButton, Button, CreateNewFolder, Upload, Login, AddLink icons
- **Reference implementation:** `client/src/components/folder-tree/FolderTree.js` (extracted section)

### 2.5 i18n Keys

- `nav.addToShared`, `nav.login`
- `fileManager.createFolder`, `fileManager.uploadFile`

### 2.6 Conditional Rendering

- When `showShareLinkActions` and `shareLinkActions`: show Add to shared (if user) or Login (if not)
- Otherwise: show Create folder + Upload (disabled when `!hasWritePermission`)

### 2.7 Verification Scenarios

- [ ] Create folder / Upload buttons invoke callbacks
- [ ] Buttons disabled when `!hasWritePermission`
- [ ] Share link mode: Add to shared when user, Login when not
- [ ] Share link callbacks invoked on click

### 2.8 Edge Cases

- `showShareLinkActions` true but no `shareLinkActions` – fallback to Create folder / Upload
