# RecentFilesSection Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Collapsible section for recent files. Header selects /__recent__. Children: recent file list with file icon, click navigates to parent folder or opens file. Width-sensitive truncation must be sourced from a hook/adapter boundary rather than direct `ResizeObserver` usage in the component. |
| Used in | FolderTree |
| Related components | getFileIcon |

> **Phase 5 note (stays path-based):** `RecentFilesSection` intentionally remains path-based through Phase 4/5. Recent entries carry a path, and clicks go through a temporary `resolve-path` shim — `POST /files/resolve-path { path } → { nodeId }` — which converts the recent item's path into a nodeId for navigation (pending implementation in C2.3). The shim is removed in **Phase 5.4**, when the recent-files API returns nodeIds and this section moves to the nodeId end-state.

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
| onFileClick | function | N | - | File click. If omitted, file click falls back to `onPathClick(parentPath)` |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| handleRecentToggle | Expand/collapse | - |
| handleRecentClick | Section click | - |
| onPathClick | Folder click | (path) |
| onFileClick | File click | (file) |

> **Click shim:** recent item clicks (folder navigation or the file-click fallback to the parent folder) are routed through the temporary `resolve-path` shim to obtain a nodeId for the nodeId-first navigation (pending implementation in C2.3; removed in Phase 5.4).

### 2.4 Dependencies

- **imports:** `getFileIcon`, `pixelMiddleTruncate`, a width-observation hook for prepared container width
- **Reference implementation:** `client/src/components/folder-tree/RecentFilesSection.js`
- **Boundary:** This component must not instantiate `ResizeObserver` directly. Width measurement belongs to a reusable hook/adapter seam that exposes the current container width as render-ready state.

### 2.5 i18n Keys

- fileManager.recentItems (section header), fileManager.recentItemsEmpty (empty state)

### 2.6 Conditional Rendering

- Selected when currentPath === '/__recent__'
- Collapse for file list
- Empty: recentItemsEmpty message
- List limited to first 10 items (slice 0–10)

### 2.7 Verification Scenarios

- [ ] Section click, expand
- [ ] File/folder click (folder clicks resolve through the `resolve-path` shim — pending implementation in C2.3)
- [ ] Empty state
- [ ] File click when onFileClick is undefined falls back to `onPathClick(parentPath)` (through the shim)
- [ ] List shows max 10 items

### 2.9 UI Enhancements

- **Middle-Truncation:** Long filenames should be truncated in the middle (e.g., `abc...jk.docx`) to fit the component width while preserving the start and the extension.
- **Dynamic Width:** Truncation should adapt to the component's width and consider character widths (e.g., CJK).
- **Tooltip:** Full filename should be visible via tooltip on hover.
- **A11y/testing note:** Tooltip content may be exposed via ARIA attributes; tests should verify user-observable full-name access and should not require a static `title` attribute on the text node.
- **Observation boundary:** Width changes should stay observable after the refactor, but tests should assert truncation outcomes rather than `ResizeObserver` implementation details.
