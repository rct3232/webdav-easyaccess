# LoginDialog Spec

## 1. Overview

| Item               | Description                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Modal that shows LoginForm. On success, calls onClose (no navigation). Used when user is on share link and wants to log in without leaving. |
| Used in            | ShareLinkLoader, ShareLinkSingleFileView                                                                                                    |
| Related components | LoginForm                                                                                                                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/dialogs/LoginDialog.js`
- **Test file:** `client/src/components/dialogs/__tests__/LoginDialog.test.js`

### 2.2 Props

| Name    | Type     | Required | Default | Description                           |
| ------- | -------- | -------- | ------- | ------------------------------------- |
| open    | boolean  | Y        | -       | Dialog open                           |
| onClose | function | Y        | -       | Close handler; also called on success |

### 2.3 Callback Signatures

| Callback | When invoked                  | Arguments |
| -------- | ----------------------------- | --------- |
| onClose  | Dialog close or login success | -         |

### 2.4 Dependencies

- **imports:** LoginForm
- **Reference implementation:** `client/src/components/dialogs/LoginDialog.js`

### 2.5 i18n Keys

- From LoginForm

### 2.6 Conditional Rendering

- LoginForm with redirectAfterLogin=false, onSuccess=onClose

### 2.7 Verification Scenarios

- [ ] Renders LoginForm
- [ ] onClose on success
- [ ] onClose on backdrop click

### 2.8 Edge Cases

- redirectAfterLogin=false – no redirect after login

### 2.9 API Error Behavior

- **On API success:** onClose called; dialog closes.
- **On API failure (4xx/5xx, network error):** Dialog **stays open**. LoginForm shows error. User can correct credentials, retry, or close. Same pattern as RenameDialog, CreateFolderDialog, useFileOperations.
