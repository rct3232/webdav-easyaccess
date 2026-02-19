# RenameDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Simple rename dialog with text input. Controlled component; parent manages value and confirm logic. |
| Used in | File/folder rename in context menu |
| Related components | MUI Dialog, TextField (no BaseDialog) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/RenameDialog.js`
- **Test file:** `client/src/components/__tests__/RenameDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Whether dialog is open |
| onClose | function | Y | - | Close handler |
| value | string | Y | - | Current name value (controlled) |
| onChange | function | Y | - | Value change handler |
| error | string | N | - | Validation error message |
| onClearError | function | N | - | Called when user edits (to clear error) |
| loading | boolean | N | false | Disables buttons during submit |
| onConfirm | function | Y | - | Confirm handler (rename submit) |
| fullScreen | boolean | N | false | Full-screen on mobile |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Cancel or dialog close | - |
| onChange | TextField change | (value: string) |
| onClearError | TextField change when error exists | - |
| onConfirm | Change button click | - |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Dialog/DialogTitle/DialogContent/DialogActions/Button/TextField
- **Reference implementation:** `client/src/components/dialogs/RenameDialog.js`

### 2.5 i18n Keys

- `dialogs.renameTitle` – dialog title
- `dialogs.newName` – input label
- `dialogs.change` – confirm button
- `common.cancel` – cancel button

### 2.6 Conditional Rendering

- Confirm button disabled when loading or value is empty/whitespace
- Cancel and Confirm disabled when loading
- Error cleared on onChange when onClearError provided
- Enter key triggers onConfirm when not loading

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Value and onChange controlled correctly
- [ ] onConfirm called when Change clicked (and value non-empty)
- [ ] onClose called on Cancel
- [ ] loading disables both buttons
- [ ] Empty/whitespace value disables Confirm
- [ ] Enter key triggers onConfirm
- [ ] Error and helperText displayed when error prop set
- [ ] onClearError called on change when error exists

### 2.8 Edge Cases

- value = '' – Confirm disabled
- helperText = ' ' (space) when no error – preserves layout
- fullScreen for mobile layouts
