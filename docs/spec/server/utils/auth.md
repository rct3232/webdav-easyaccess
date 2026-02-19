# auth Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | JWT auth: generateToken, verifyToken, authenticateToken middleware. Refresh token store and validation. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/utils/auth.js`
- **Test file:** `server/utils/__tests__/auth.test.js`

### 2.2 Functions / Exports

| Function | Signature | Description |
|----------|-----------|-------------|
| generateToken | (user) => string | JWT sign |
| verifyToken | (token) => object \| null | JWT verify |
| authenticateToken | (req, res, next) => void | Middleware: req.user from Authorization |
| addRefreshToken | (tokenId, userId, expiresAtMs) => void | Add refresh token |
| validateRefreshToken | (tokenId) => Promise\<user \| null\> | Validate refresh token |
| deleteRefreshToken | (tokenId) => void | Remove token |
| deleteAllRefreshTokensForUser | (userId) => void | Remove all for user |

### 2.3 Input / Output

- JWT payload: id, username, token_version, is_admin
- 401 when no token or invalid

### 2.4 Dependencies

- jwt, crypto, userStore
- JWT_SECRET, JWT_EXPIRES_IN, REFRESH_TOKEN_EXPIRES_IN_DAYS

### 2.5 Mock Targets

- userStore.findById
- process.env.JWT_SECRET

### 2.6 Verification Scenarios

- [ ] generateToken, verifyToken
- [ ] authenticateToken: 401 when no/invalid token
- [ ] Refresh token add/validate/delete
