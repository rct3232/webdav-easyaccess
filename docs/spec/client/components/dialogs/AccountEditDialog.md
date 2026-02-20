# AccountEditDialog Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Dialog for editing account: email, password, confirm password. Uses BaseDialog. Controlled form; parent manages state. |
| Used in | MyPage |
| Related components | BaseDialog |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/AccountEditDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/AccountEditDialog.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| open | boolean | Y | - | Dialog open |
| onClose | function | Y | - | Close handler |
| email | string | Y | - | Email value |
| onEmailChange | function | Y | - | Email change |
| password | string | Y | - | Password value |
| onPasswordChange | function | Y | - | Password change |
| confirmPassword | string | Y | - | Confirm value |
| onConfirmPasswordChange | function | Y | - | Confirm change |
| loading | boolean | N | false | Loading |
| canSave | boolean | N | false | Save enabled |
| onSave | function | Y | - | Save handler |
| message | object | N | - | { text, type } |
| onClearMessage | function | N | - | Clear message |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClose | Close | - |
| onSave | Save button | - |
| onEmailChange, onPasswordChange, onConfirmPasswordChange | Input change | (value) |

### 2.4 Dependencies

- **imports:** BaseDialog
- **Reference implementation:** `client/src/components/dialogs/AccountEditDialog.js`

### 2.5 i18n Keys

- `dialogs.accountEditTitle`, `dialogs.email`, `register.password`, `common.cancel`, `common.save`

### 2.6 Conditional Rendering

- passwordMismatch: confirm !== password shows error
- Save disabled when !canSave or loading
- message: Alert with severity

### 2.7 Verification Scenarios

- [ ] Form submit calls onSave
- [ ] Password mismatch handling
- [ ] canSave, loading disable save
- [ ] message display

### 2.8 Edge Cases

- passwordMismatch when confirmPassword length > 0

### 2.9 API Error Behavior

- **On API success:** Parent calls onClose; dialog closes.
- **On API failure (4xx/5xx, network error):** Dialog **stays open**. Error shown via message prop (Alert). User can correct input, retry, or close. Same pattern as RenameDialog, CreateFolderDialog, LoginDialog.
