# auth routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/auth` |
| Role | Authentication: register, login, refresh token, current user (me). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/auth.js`
- **Test file:** `server/routes/__tests__/auth.test.js`

### 2.2 Route List (sync with api.md)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | None | Sign up. Body: username, email, password. |
| POST | `/login` | None | Login. Returns user, token, refreshToken. |
| POST | `/refresh` | None | Refresh token. Body: refreshToken. |
| GET | `/me` | Token | Current user info. |

### 2.3 Middleware Used

- `authenticateToken` for /me
- None for register, login, refresh

### 2.4 Request/Response Spec

- **POST /register:** Body: `{ username, email, password }`. 201: `{ messageCode, status, user }`. Errors: 403 (registration disabled), 400 (required, usernameTaken, emailTaken), 500.
- **POST /login:** Body: `{ username, password }`. 200: `{ token, refreshToken, user }`. Errors: 400, 401 (invalid credentials), 403 (pending/rejected), 429 (rate limit).
- **POST /refresh:** Body: `{ refreshToken }`. 200: `{ token }`. Errors: 401.
- **GET /me:** 200: user object. Errors: 404, 500.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.6 Integration Test Scenarios

- [ ] Register success returns 201 and user
- [ ] Register when disabled returns 403
- [ ] Login success returns token and user
- [ ] Login invalid credentials returns 401
- [ ] Login pending/rejected returns 403
- [ ] Refresh returns new token
- [ ] GET /me returns user when authenticated
