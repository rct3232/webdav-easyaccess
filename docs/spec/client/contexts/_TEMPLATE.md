# [ContextName] Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | (Provider's role, e.g. auth state, theme) |
| Used in | (Components/pages that consume it) |
| Related | (authService, apiClient, etc.) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/contexts/[ContextName].js`
- **Test file:** `client/src/contexts/__tests__/[ContextName].test.js`

### 2.2 Provided Value

| Key | Type | Description |
|-----|------|-------------|
| (key) | (type) | (description) |

### 2.3 Hook

- use[ContextName]() – returns context value; throws if outside provider

### 2.4 Dependencies

- React, services, etc.

### 2.5 Verification Scenarios

- [ ] Unauthenticated / initial state
- [ ] Authenticated / loaded state
- [ ] Loading state
- [ ] Hook outside provider throws

### 2.6 Edge Cases

- (Specific edge cases)
