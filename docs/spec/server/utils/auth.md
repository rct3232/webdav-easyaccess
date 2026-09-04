# auth Spec

## 1. Overview

| Item | Description                                                                                             |
| ---- | ------------------------------------------------------------------------------------------------------- |
| Role | JWT auth: generateToken, verifyToken, authenticateToken middleware. Refresh token store and validation. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/auth.js`
- **Test file:** `server/utils/__tests__/auth.test.js`

### 2.2 Functions / Exports

| Function                      | Signature                              | Description                             |
| ----------------------------- | -------------------------------------- | --------------------------------------- |
| generateToken                 | (user) => string                       | JWT sign                                |
| verifyToken                   | (token) => object \| null              | JWT verify                              |
| authenticateToken             | (req, res, next) => void               | Middleware: req.user from Authorization |
| addRefreshToken               | (tokenId, userId, expiresAtMs) => void | Add refresh token                       |
| validateRefreshToken          | (tokenId) => Promise\<user \| null\>   | Validate refresh token                  |
| deleteRefreshToken            | (tokenId) => void                      | Remove token                            |
| deleteAllRefreshTokensForUser | (userId) => void                       | Remove all for user                     |

### 2.3 Input / Output

- JWT payload: id, username, token_version, is_admin
- authenticateToken: 401 when no token; 401 when invalid or expired token

### 2.4 Dependencies

- jwt, crypto, userStore
- JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN_DAYS

`JWT_SECRET` is a boot-frozen env read site: it is read once at module load into a frozen
module constant that both `generateToken` (sign) and `verifyToken` (verify) use. Resolution
rule:

- env value **set** (legacy placeholder `'your-secret-key-change-in-production'` included) →
  used verbatim as the signing key; the placeholder only triggers a "change it" warning,
  never an error.
- env value **unset or empty** → an ephemeral random secret is generated at module load for
  that process. Restart → new secret → all existing sessions invalid (full re-login).
  Multi-instance deployments must set one unified `JWT_SECRET`.
- The production fail-fast / setup-mode detour is removed: no environment requires
  `JWT_SECRET` for boot or for `setup_complete`.

### 2.5 Mock Targets

- userStore.findById
- process.env.JWT_SECRET

### 2.6 Verification Scenarios

- [ ] generateToken, verifyToken
- [ ] authenticateToken: 401 when no/invalid token
- [ ] Refresh token add/validate/delete
