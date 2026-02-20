# BaseDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Base dialog component with common structure and responsive behavior. Provides standardized layout for all dialogs. |
| Used in | CreateFolderDialog, ShareDialog, and other dialogs that extend this pattern |
| Related components | MUI Dialog, DialogTitle, DialogContent, DialogActions |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/BaseDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/BaseDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Whether dialog is open |
| onClose | function | Y | - | Close handler |
| title | string | N | - | Dialog title |
| children | ReactNode | N | - | Dialog content |
| actions | ReactNode | N | - | Dialog actions (buttons) |
| maxWidth | 'xs' \| 'sm' \| 'md' \| 'lg' \| 'xl' | N | 'sm' | Max width of dialog |
| fullWidth | boolean | N | true | Whether dialog should be full width |
| disableRestoreFocus | boolean | N | true | Whether to disable restore focus |
| sx | object | N | {} | Additional MUI sx styles |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | When user closes dialog (backdrop click, escape) | - |

### 2.4 Dependencies

- **imports:** React, MUI Dialog/DialogTitle/DialogContent/DialogActions, useResponsive
- **Reference implementation:** `client/src/components/dialogs/BaseDialog.js`

### 2.5 i18n Keys

- None (title and content passed as props)

### 2.6 Conditional Rendering

- `title && <DialogTitle>` – only renders title when provided
- `children && <DialogContent>` – only renders content when provided
- `actions && <DialogActions>` – only renders actions when provided
- `fullScreen={isMobile}` – full-screen on mobile via useResponsive

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders when open=true, hides when open=false
- [ ] onClose called on dialog close
- [ ] Title, children, actions render when provided
- [ ] fullScreen applied on mobile breakpoint
- [ ] maxWidth, fullWidth, disableRestoreFocus passed to Dialog

### 2.8 Edge Cases

- Empty title/children/actions – optional sections not rendered
- sx override – additional styles merged with dialog
