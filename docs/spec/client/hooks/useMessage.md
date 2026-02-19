# useMessage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Unified message display: showMessage, showSuccess, showError, showWarning, showInfo, showErrorFromError, clearMessage. Auto-hide after duration. |
| Used by components/pages | FileManager, dialogs, pages |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useMessage.js`
- **Test file:** `client/src/hooks/__tests__/useMessage.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| options | object | N | {} |
| options.defaultDuration | number | N | 3000 |
| options.successDuration | number | N | 3000 |
| options.errorDuration | number | N | 5000 |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| message | { show, text, type } | Current message |
| showMessage | (text, type, duration?) => void | Show message |
| showSuccess | (text, duration?) => void | Success |
| showError | (text, duration?) => void | Error |
| showWarning | (text, duration?) => void | Warning |
| showInfo | (text, duration?) => void | Info |
| showErrorFromError | (error, defaultMsg?, duration?) => void | From error object |
| clearMessage | () => void | Clear |

### 2.4 Dependencies

- i18n, getServerErrorDisplay
- No API calls

### 2.5 Side Effects

- setTimeout to auto-hide message (duration > 0)
- showErrorFromError uses error.response.data.errorCode -> getServerErrorDisplay

### 2.6 Error Handling

- showErrorFromError: prefers errorCode, else data.error, else error.message, else defaultMsg

### 2.7 Verification Scenarios

- [ ] Initial message state
- [ ] showMessage, showSuccess, showError update state
- [ ] Auto-hide after duration
- [ ] clearMessage
- [ ] showErrorFromError with errorCode

### 2.8 Edge Cases

- duration = 0: no auto-hide
- error.response.data.errorCode -> getServerErrorDisplay
