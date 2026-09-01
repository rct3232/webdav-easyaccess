# requireUser Spec

## 1. Overview

| Item                 | Description                                                    |
| -------------------- | -------------------------------------------------------------- |
| Role                 | Require authenticated user, load full user into req.user.full. |
| Pipeline position    | After authenticateToken                                        |
| Preceding middleware | authenticateToken (or authenticateTokenOrShare)                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/requireUser.js`
- **Test file:** `server/middleware/__tests__/requireUser.test.js`

### 2.2 Exports

| Export      | Usage                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| requireUser | Default export. Use after authenticateToken. Loads req.user.full.                                                                                       |
| requireAuth | Named export. Use after authenticateTokenOrShare. Passes when req.principalId is set (share token). For JWT: loads req.user.full, sets req.principalId. |

### 2.3 Input Conditions

- req.user, req.user.id from authenticateToken
- req.principalId (optional, from authenticateTokenOrShare when using requireAuth)

### 2.4 Side Effects

- req.user.full = User object
- requireAuth: sets req.principalId from req.user.id
- 401 when !req.user or !req.user.id
- 404 (notFoundError) when user not found

### 2.5 Error Cases

| Condition                           | Behavior           |
| ----------------------------------- | ------------------ |
| No req.user / req.user.id           | 401                |
| User not found                      | notFoundError, 404 |
| User.findById throw (DB/Store 예외) | 500 (errorHandler) |
| Success                             | next()             |

### 2.6 Mock Targets

- User.findById

### 2.7 Verification Scenarios

- [ ] next() when user loaded
- [ ] 401 when no user
- [ ] 404 when User.findById returns null
- [ ] User.findById throw 시 500
- [ ] requireAuth: req.principalId set
