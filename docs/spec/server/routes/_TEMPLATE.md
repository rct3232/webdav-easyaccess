# [routeName] routes Spec

## 1. Overview

| Item       | Description                  |
| ---------- | ---------------------------- |
| Mount path | (e.g. /api/auth, /api/files) |
| Role       | (Endpoint group role)        |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/[routeName].js`
- **Test file:** `server/routes/__tests__/[routeName].test.js`

### 2.2 Route List (sync with api.md)

| Method   | Path   | Auth                | Description   |
| -------- | ------ | ------------------- | ------------- |
| (METHOD) | (path) | (required/optional) | (description) |

### 2.3 Middleware Used

- authenticateToken, requireUser, permissions, etc.

### 2.4 Request/Response Spec

- **METHOD path:** Body/Query params. Success status: response body. Errors: status codes and errorCode.

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)

### 2.6 Integration Test Scenarios

- [ ] Success case
- [ ] Auth failure
- [ ] Validation error
- [ ] Other flow verification
