# RecentFilesSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Collapsible section for recent files. Header selects /__recent__. Children: recent file list with file icon, click navigates to parent folder or opens file. |
| Used in | FolderTree |
| Related components | getFileIcon |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/folder-tree/RecentFilesSection.js`
- **Test file:** `client/src/components/__tests__/RecentFilesSection.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| recentExpanded | boolean | Y | - | Section expanded |
| handleRecentToggle | function | Y | - | Toggle expand |
| handleRecentClick | function | Y | - | Section header click |
| currentPath | string | Y | - | Current path |
| recentFilesList | array | Y | - | Recent files |
| onPathClick | function | Y | - | Path click (folder) |
| onFileClick | function | Y | - | File click |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| handleRecentToggle | Expand/collapse | - |
| handleRecentClick | Section click | - |
| onPathClick | Folder click | (path) |
| onFileClick | File click | (file) |

### 2.4 Dependencies

- **imports:** getFileIcon
- **Reference implementation:** `client/src/components/folder-tree/RecentFilesSection.js`

### 2.5 i18n Keys

- nav.recentFiles, fileManager.noRecentFiles

### 2.6 Conditional Rendering

- Selected when currentPath === '/__recent__'
- Collapse for file list
- Empty: noRecentFiles message

### 2.7 Verification Scenarios

- [ ] Section click, expand
- [ ] File/folder click
- [ ] Empty state

### 2.8 Edge Cases

- recentFilesList empty
