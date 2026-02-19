# ShareLinkSingleFileView Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | N/A (rendered by ShareLinkLoader for single-file share links) |
| Role | Full-screen single-file preview for share links. FilePreviewDialog without close button. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/ShareLinkSingleFileView.js`
- **Test file:** `client/src/pages/__tests__/ShareLinkSingleFileView.test.js`

### 2.2 Hooks Used

- None (presentational)

### 2.3 Main Child Components

- FilePreviewDialog (open, hideCloseButton, file, mediaFiles, shareToken)
- Box

### 2.4 Route Protection

- N/A; rendered within ShareLinkLoader (public share link).

### 2.5 Main User Flows

- Display file preview at full viewport height
- No close button; preview fills screen

### 2.6 Integration Test Scenarios

- [ ] Renders FilePreviewDialog with correct props
- [ ] File object derived from linkInfo
- [ ] shareToken passed to preview

### 2.7 Conditional Rendering

- mediaFiles always empty (single file context)
- hideCloseButton true
