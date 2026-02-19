# AuthContext Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | AuthProvider: manages authentication state (user, token), login, register, logout. Session-only auth (sessionStorage). Auto-logout on 401/403. Listens for token-refreshed event. |
| Used in | App root, PrivateRoute, Login, Register, FileManager, etc. |
| Related | authService, apiClient, axios |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/contexts/AuthContext.js`
- **Test file:** `client/src/contexts/__tests__/AuthContext.test.js`

### 2.2 Provided Value

| Key | Type | Description |
|-----|------|-------------|
| user | object \| null | Current user (username, email, is_admin, etc.) |
| loading | boolean | Initial/auth check in progress |
| login | (username, password) => Promise<{ success, user?, error?, status?, message? }> | Login |
| register | (username, email, password) => Promise<{ success, status?, error? }> | Register |
| logout | () => void | Clear token and user |
| isAuthenticated | boolean | !!user |

### 2.3 useAuth Hook

- `useAuth()` – returns context value; throws if used outside AuthProvider

### 2.4 Dependencies

- React (createContext, useState, useContext, useEffect, useCallback)
- axios (defaults.headers, interceptors)
- authService (getMe, login, register)
- HTTP_STATUS from shared/constants

### 2.5 Behavior

- Token: sessionStorage ('token', 'refreshToken'); legacy localStorage cleaned on init
- On token: set Authorization header, fetch user via getMe
- Axios interceptor: 401/403 + token present → logout, reject
- token-refreshed custom event: update token and header
- login/register: store token, set user; on error return { success: false, ...errorData }
- register status 'pending' → return { success: true, status: 'pending' } (no token/user)

### 2.6 Verification Scenarios

- [ ] Unauthenticated: user null, isAuthenticated false, loading false after init
- [ ] Authenticated: user set, isAuthenticated true after fetchUser
- [ ] Loading: loading true while token present and user not yet fetched
- [ ] login success: token stored, user set, Authorization header set
- [ ] login failure: returns { success: false, error, status, message }
- [ ] 401/403 interceptor: calls logout, clears user
- [ ] token-refreshed: updates token and header

### 2.7 Edge Cases

- useAuth outside provider throws
- getMe fails → logout, loading false
