# AuthContext Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | AuthProvider: manages authentication state (user, token), login, register, logout. Session-only auth (sessionStorage). 401/403 상세 처리는 apiClient가 담당; AuthContext는 getMe 실패 등 일부 흐름만 처리. Listens for token-refreshed event. |
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
- apiClient에서 401/403 처리 (401: refresh 후 /login 리다이렉트; 403: URL 이동 직후 history.back() 또는 '/', 그 외 리다이렉트 없음). AuthContext는 getMe 실패 시 logout 등
- token-refreshed custom event: update token and header
- login/register: store token, set user; on error return { success: false, ...errorData }
- register status 'pending' → return { success: true, status: 'pending' } (no token/user)
- token-refreshed 이벤트 수신 시 새 토큰 적용 실패 → header만 갱신 시도; 실패 시 로그, 사용자 영향 없음 (다음 요청 시 401으로 처리)
- 동시 refresh 요청(다중 탭 등): 첫 요청만 refresh 시도; 나머지는 대기 후 새 토큰 사용. 경쟁 상태는 허용.

### 2.6 Verification Scenarios

- [ ] Unauthenticated: user null, isAuthenticated false, loading false after init
- [ ] Authenticated: user set, isAuthenticated true after fetchUser
- [ ] Loading: loading true while token present and user not yet fetched
- [ ] login success: token stored, user set, Authorization header set
- [ ] login failure: returns { success: false, error, status, message }
- [ ] register returns { success: true, status: 'pending' } when status pending (no token/user)
- [ ] getMe failure triggers logout, loading false
- [ ] useAuth outside AuthProvider throws
- [ ] 401/403: apiClient에서 처리; AuthContext는 getMe 실패 시 logout
- [ ] token-refreshed: updates token and header
- [ ] token-refreshed 수신 후 token 적용 실패 시 fallback 동작

### 2.7 Edge Cases

- useAuth outside provider throws
- getMe fails → logout, loading false
- 동시 refresh 요청 시 한 번만 refresh 시도
