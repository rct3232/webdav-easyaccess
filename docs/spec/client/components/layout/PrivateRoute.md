# PrivateRoute Spec

## 1. Overview

| Item               | Description                                                                                                      |
| ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Role               | Route guard: renders children when authenticated, else redirects to /login. Shows CircularProgress when loading. |
| Used in            | App routing                                                                                                      |
| Related components | useAuth, Navigate                                                                                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/layout/PrivateRoute.js`
- **Test file:** `client/src/components/layout/__tests__/PrivateRoute.test.js`

### 2.2 Props

| Name     | Type      | Required | Default | Description       |
| -------- | --------- | -------- | ------- | ----------------- |
| children | ReactNode | Y        | -       | Protected content |

### 2.3 Callback Signatures

None.

### 2.4 Dependencies

- **imports:** useAuth, Navigate, CircularProgress, Box
- **Reference implementation:** `client/src/components/layout/PrivateRoute.js`

### 2.5 i18n Keys

- None

### 2.6 Conditional Rendering

- loading: CircularProgress centered
- isAuthenticated: children
- !isAuthenticated: Navigate to="/login" replace

### 2.7 Verification Scenarios

- [ ] Renders children when authenticated
- [ ] Redirects to /login when not authenticated
- [ ] Shows loading spinner when loading

### 2.8 Edge Cases

- minHeight: var(--app-height) for loading container
