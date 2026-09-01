# authService Spec

## 1. Overview

| Item | Description                                                                                                                  |
| ---- | ---------------------------------------------------------------------------------------------------------------------------- |
| Role | Auth API: get current user, login, register. Used by `useAuthSession` and login/register pages through auth session actions. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/authService.js`
- **Test file:** `client/src/services/__tests__/authService.test.js`

### 2.2 Main Functions

| Function | Input                       | Return                    | API called              |
| -------- | --------------------------- | ------------------------- | ----------------------- |
| getMe    | ()                          | Promise\<Object\>         | GET /api/auth/me        |
| login    | (username, password)        | Promise\<Object \| null\> | POST /api/auth/login    |
| register | (username, email, password) | Promise\<Object \| null\> | POST /api/auth/register |

- Login/register responses include `user`, `token`; may include `status` (pending, rejected).
- When `apiClient` skips auth policy for excluded `401` requests and resolves `null`, `authService` forwards `null` to the caller.

### 2.3 Error Handling

- Errors thrown with response data; AuthContext and pages use getServerErrorDisplay
- status: 'pending' → warning; status: 'rejected' → error
- `401` from login/register is not redirected by `apiClient`; callers must handle a `null` result defensively.

### 2.4 Verification Scenarios

- [ ] getMe returns user object
- [ ] login success returns user, token
- [ ] register success returns user or pending status
- [ ] login/register forward `null` when the underlying excluded `401` request resolves `null`
- [ ] Error response propagated for display
