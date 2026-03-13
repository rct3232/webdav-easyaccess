# useRecentFile Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Recent file integration: track clicks, path history, navigate to parent, open preview. Integrates getRecentFiles, removeRecentFile, listFiles. |
| Used by components/pages | FileManager |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useRecentFile.js`
- **Test file:** `client/src/hooks/__tests__/useRecentFile.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| setCurrentPath | function | Y | Set path |
| showError | function | Y | Show error |
| user | object | Y | User |
| currentPathRef | ref | N | Current path ref |
| setSelectedFile | function | N | Set selected file |
| setPreviewDialogOpen | function | N | Open preview |
| files | array | Y | Files list |
| loading | boolean | Y | Loading |
| currentPath | string | Y | Current path |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| trackRecentFileClick | (filePath, parentPath?) => void | Track recent file click |
| trackPathHistory | (path, previousPath) => void | Track path navigation history |
| clearTracking | (path) => void | Clear tracking for path |
| clearAllTracking | () => void | Clear all tracking |
| clearPathHistory | (path) => void | Clear path history for path |
| handleRecentFileError | (error, path) => Promise | Error handler: 404+recent → removeRecentFile; navigates on error |
| recentFileToPreview | object \| null | File pending preview open |
| setRecentFileToPreview | function | Set file to open in preview |
| recentFilePathsRef | ref | Map of path → recent file path |
| pathHistoryRef | ref | Map of path → previous path |
| processingErrorRef | ref | Set of paths with active error handling |

### 2.4 Dependencies

- getRecentFiles, removeRecentFile, listFiles
- determineErrorType, getErrorMessageByType, canPreview

### 2.5 Side Effects

- setCurrentPath on file click
- listFiles for parent when needed
- removeRecentFile on 404

### 2.6 Error Handling

- determineErrorType, getErrorMessageByType
- showError for user
- processingErrorRef to avoid duplicate toasts

### 2.7 Verification Scenarios

- [ ] trackRecentFileClick, trackPathHistory record correctly
- [ ] handleRecentFileError: 404 on recent file → removeRecentFile, showError
- [ ] handleRecentFileError: navigate to previousPath or default on error
- [ ] clearTracking, clearPathHistory, clearAllTracking

### 2.8 Edge Cases

- canPreview -> open preview
- processingErrorRef for dedup
