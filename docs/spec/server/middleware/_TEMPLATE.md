# [middlewareName] Spec

## 1. Overview

| Item                 | Description                            |
| -------------------- | -------------------------------------- |
| Role                 | (Middleware's role)                    |
| Pipeline position    | (e.g. after Auth, before requireUser)  |
| Preceding middleware | (What must run before this middleware) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/[middlewareName].js`
- **Test file:** `server/middleware/__tests__/[middlewareName].test.js`

### 2.2 Input Conditions

- Whether req.user exists
- req.principalId, etc.

### 2.3 Side Effects

- req modifications
- When res.status().json() is called

### 2.4 Error Cases

| Condition          | Behavior               |
| ------------------ | ---------------------- |
| Unauthenticated    | 401, next(error), etc. |
| Forbidden          | 403                    |
| Resource not found | 404                    |
| Other              | next(error)            |

### 2.5 Mock Targets

- User.findById, Settings, etc. (for unit tests)

### 2.6 Verification Scenarios

For unit tests: assertions based on mock req/res/next

- [ ] next() called on valid request
- [ ] req modification verification
- [ ] status/body verification per error case
