# auth routes Spec

## 1. Overview

| Item       | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| Mount path | `/api/auth`                                                        |
| Role       | Authentication: register, login, refresh token, current user (me). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/auth/routes.js`
- **Test file:** `server/domains/auth/routes/__tests__/auth.test.js`

### 2.2 Route List (sync with api.md)

| Method | Path        | Auth  | Description                               |
| ------ | ----------- | ----- | ----------------------------------------- |
| POST   | `/register` | None  | Sign up. Body: username, email, password. |
| POST   | `/login`    | None  | Login. Returns user, token, refreshToken. |
| POST   | `/refresh`  | None  | Refresh token. Body: refreshToken.        |
| GET    | `/me`       | Token | Current user info.                        |

### 2.3 Middleware Used

- `authenticateToken` for /me
- None for register, login, refresh

### 2.4 Architecture Notes

Business logic is extracted into `server/domains/auth/service.js`, which exports:

- `registerUser({ username, email, password })` — registration with validation
- `loginUser({ username, password }, req)` — authentication with rate limiting
- `refreshAccessToken(refreshToken)` — token refresh via token store
- `getAuthenticatedUser(userId, tokenVersion)` — user lookup with token version check
- `revokeAllUserTokens(userId)` — revoke all tokens for a user
- `checkLoginRateLimit(req)`, `recordLoginFailure(key)`, `clearLoginFailures(key)` — rate limit helpers
- `setRateLimitCacheAdapter(adapter)` — dependency injection for rate limit cache

Refresh token CRUD is managed by `server/domains/auth/tokenStore.js` using CacheAdapter internally. Rate limiting (`loginAttempts`) also uses CacheAdapter via the service layer.

### 2.5 Request/Response Spec

User objects returned by the auth API carry a `rootNodeId` field that resolves the user's home directory node (`file_nodes` row named after the username) via `createFileNodesStore().getUserRootNode(userId)`. It is a number when the home node exists, otherwise `null` (e.g. a freshly registered, still-pending user has no home node until approval). The client treats `null` as "no home yet".

- **POST /register:** Body: `{ username, email, password }`. 201: `{ messageCode, status, user }` where `user = { id, username, email, status, rootNodeId }` (`rootNodeId` is `null` for pending users). Errors: 403 (registration disabled), 400 (required, usernameTaken, emailTaken), 500.
- **POST /login:** Body: `{ username, password }`. 200: `{ token, refreshToken, user }` where `user = { id, username, email, is_admin, status, rootNodeId }`. Errors: 400, 401 (invalid credentials), 403 (pending/rejected), 429 (rate limit).
- **POST /refresh:** Body: `{ refreshToken }`. 200: `{ token }`. Errors: 401.
- **GET /me:** 200: user object including `id, username, email, is_admin, status, rootNodeId` (plus any `users` row fields). Errors: 401, 404, 500.

### 2.6 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.7 Integration Test Scenarios

- [ ] Register success returns 201 and user
- [ ] Register when disabled returns 403
- [ ] Register returns 400 when email already taken
- [ ] Login success returns token and user
- [ ] Login invalid credentials returns 401
- [ ] Login pending returns 403
- [ ] Login rejected returns 403 when user status is REJECTED
- [ ] Login returns 429 when rate limit exceeded
- [ ] Refresh returns 200 with token (string); token uniqueness not guaranteed within same second
- [ ] GET /me returns user when authenticated
- [ ] Register duplicate handling: username uniqueness is checked first (service.js:108-122); when both username and email are taken, `serverErrors.auth.usernameTaken` (400) is always returned — `emailTaken` is only returned after the username check passes
- [ ] Refresh 빈/잘못된 refreshToken → 401
- [ ] GET /me 만료 토큰 → 401
