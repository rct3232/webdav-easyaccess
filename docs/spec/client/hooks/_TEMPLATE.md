# [HookName] Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | (Hook's role) |
| Used by components/pages | (Where it is used) |

---

## 2. Implementation Spec

### 2.1 File Path

Choose the scope according to [CODING_STYLE.md § Hook Placement](../../../../CODING_STYLE.md):

| Scope | Source path | Test path |
|-------|-------------|-----------|
| Global | `client/src/hooks/[HookName].js` | `client/src/hooks/__tests__/[HookName].test.js` |
| Page-local | `client/src/pages/[PageName]/hooks/[HookName].js` | `client/src/pages/[PageName]/hooks/__tests__/[HookName].test.js` |
| Dialog-local | `client/src/components/dialogs/[DialogName]/hooks/[HookName].js` | `client/src/components/dialogs/[DialogName]/hooks/__tests__/[HookName].test.js` |
| Component-family | `client/src/components/[family]/hooks/[HookName].js` | `client/src/components/[family]/hooks/__tests__/[HookName].test.js` |

- **Source:** `(fill in the path matching the scope above)`
- **Test file:** `(fill in the test path matching the scope above)`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| (paramName) | (type) | Y/N | (description) |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| (key) | (type) | (meaning) |

### 2.4 Dependencies

- Services called: (fileService, apiClient, etc.)
- Other hooks: (useAuth, useTranslation, etc.)

### 2.5 Side Effects

- When and under what conditions API is called
- Event subscriptions, etc.

### 2.6 Error Handling

- Behavior on error
- Display message (errorCode, etc.)

### 2.7 Verification Scenarios

Checklist for unit tests with renderHook:

- [ ] Initial state verification
- [ ] State change after action verification
- [ ] Error case verification
- [ ] Other behavior verification

### 2.8 Edge Cases

- Empty input
- Cancellation
- Retry
- Other edge cases
