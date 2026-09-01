# ShareLinkSingleFileView Spec

## 1. Overview

| Item       | Description                                                                                                                                                                  |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route path | N/A directly; rendered by `ShareLinkLoader` for `/share/:token` when the token resolves to a single file                                                                     |
| Role       | Full-screen single-file public-share preview/download surface. Reuses `FilePreviewDialog` without a close button and intentionally stays narrower than directory-share mode. |

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

- Display the shared file preview at full viewport height.
- Keep the preview open without a close button; leaving the screen is handled by browser/navigation context, not an in-view dismiss action.
- Support the same preview/download behavior regardless of whether the visitor is anonymous or already authenticated.
- Do **not** expose directory-share-specific overlay actions here:
  - no "Login" CTA
  - no "Add to my permissions" CTA
  - no "Leave share" flow

### 2.6 Browser-visible contract

- `ShareLinkLoader` owns token lookup and the "directory versus single file" branching decision before this component renders.
- Once this component renders, the user-visible contract is intentionally narrow:
  - the shared file can be previewed and downloaded
  - the screen is full-viewport
  - there is no directory explorer shell
  - there are no authenticated upgrade/overlay actions layered into this view
- If product behavior later adds authenticated actions for single-file public shares, this spec and the E2E plan must be updated together before implementation work proceeds.

### 2.7 Integration Test Scenarios

- [ ] Renders FilePreviewDialog with correct props
- [ ] File object derived from linkInfo
- [ ] shareToken passed to preview
- [ ] Full-screen single-file rendering does not expose directory-share-only actions such as Login or Add to my permissions
- [ ] Logged-in and anonymous visitors see the same single-file preview/download surface

### 2.8 Conditional Rendering

- mediaFiles always empty (single file context)
- hideCloseButton true
- No explorer toolbar, share-mode FAB actions, or leave-share controls are rendered by this page-level view
