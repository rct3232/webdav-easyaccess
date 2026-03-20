# ConfirmDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Reusable confirmation dialog. Shows centered popup with title, message, and confirm/cancel buttons. Supports loading variant (spinner only). |
| Used in | Delete confirmations, operation confirmations |
| Related components | MUI Dialog, ConfirmDialog does not use BaseDialog (uses raw MUI Dialog) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/ConfirmDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/ConfirmDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Whether dialog is open |
| onClose | function | Y | - | Close handler |
| onConfirm | function | N | - | Confirm handler |
| title | string | N | t('common.confirm') | Dialog title |
| message | string | N | - | Message text |
| confirmText | string | N | t('common.confirm') | Confirm button label |
| cancelText | string | N | t('common.cancel') | Cancel button label |
| confirmColor | string | N | 'primary' | MUI color for confirm button |
| loading | boolean | N | false | Disables buttons, shows loading state |
| variant | string | N | - | 'loading' = spinner only, no title/message/buttons |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Cancel button click or dialog close | - |
| onConfirm | Confirm button click | - |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI Dialog/DialogTitle/DialogContent/DialogContentText/DialogActions/Button/Box/CircularProgress
- **Reference implementation:** `client/src/components/dialogs/ConfirmDialog.js`

### 2.5 i18n Keys

- `common.confirm` – default title and confirm button
- `common.cancel` – default cancel button

### 2.6 Conditional Rendering

- `variant === 'loading'` – shows only Dialog with CircularProgress, no title/message/buttons
- `loading` – disables both buttons
- E2E selector contract:
  - the confirm and cancel buttons expose stable `data-testid` values for destructive flow tests
  - tests should still prefer the visible dialog outcome over implementation-specific internal state

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders title, message, confirm/cancel buttons when variant !== 'loading'
- [ ] onConfirm called when confirm clicked
- [ ] onClose called when cancel clicked or dialog closed
- [ ] variant='loading' shows only spinner
- [ ] loading=true disables both buttons
- [ ] Custom title/confirmText/cancelText override defaults

### 2.8 Edge Cases

- variant='loading' with no onConfirm – confirm not applicable
- Empty message – DialogContentText may render empty
- confirmColor – MUI color prop (primary, error, etc.)
