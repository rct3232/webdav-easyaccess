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
- **Test file:** `client/src/components/folder-tree/__tests__/RecentFilesSection.test.js`

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

- fileManager.recentItems (section header), fileManager.recentItemsEmpty (empty state)

### 2.6 Conditional Rendering

- Selected when currentPath === '/__recent__'
- Collapse for file list
- Empty: recentItemsEmpty message
- List limited to first 10 items (slice 0–10)

### 2.7 Verification Scenarios

- [ ] Section click, expand
- [ ] File/folder click
- [ ] Empty state
- [ ] File click when onFileClick undefined: falls back to onPathClick(parentPath)
- [ ] List shows max 10 items

### 2.9 UI Enhancements

- **Middle-Truncation:** Long filenames should be truncated in the middle (e.g., `abc...jk.docx`) to fit the component width while preserving the start and the extension.
- **Dynamic Width:** Truncation should adapt to the component's width and consider character widths (e.g., CJK).
- **Tooltip:** Full filename should be visible via tooltip on hover.
