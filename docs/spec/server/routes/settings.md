# settings routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/settings` |
| Role | Public settings (registration_enabled, email_enabled). No auth. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/settings.js`
- **Test file:** `server/routes/__tests__/settings.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/public` | None | Public settings. |

### 2.3 Middleware Used

- None (public)

### 2.4 Request/Response Spec

- **GET /public:** 200: `{ registration_enabled, email_enabled, ... }`

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] GET /public returns settings without auth
