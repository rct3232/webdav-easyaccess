# settings routes Spec

## 1. Overview

| Item       | Description                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/settings` (public) and `/api/admin` (admin routes, same router)                                                      |
| Role       | Public settings (`registration_enabled`, `email_enabled`, `setup_complete`) — no auth; admin settings GET/PUT — admin auth |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/routes/settings.js` (merged into admin domain)
- **Test file:** `server/domains/admin/routes/__tests__/settings.test.js`

### 2.2 Route List

| Method | Path              | Auth          | Description                                                |
| ------ | ----------------- | ------------- | ---------------------------------------------------------- |
| GET    | `/public`         | None          | Public settings.                                           |
| GET    | `/admin/settings` | Token + Admin | Get all system settings.                                   |
| PUT    | `/admin/settings` | Token + Admin | Update system settings (currently `registration_enabled`). |

### 2.3 Middleware Used

- Public routes: none.
- Admin routes: `authenticateToken` + `isAdmin` (`server/domains/admin/routes/settings.js:24-30`).

### 2.4 Request/Response Spec

- **GET /public:** 200: `{ registration_enabled, email_enabled, setup_complete }`
  - `setup_complete: boolean` reports whether the first-run setup wizard has been
    completed (`server/domains/admin/routes/settings.js:13-21`); consumed by the login
    page to redirect to `/setup` when `false` (`client/src/pages/Login/hooks/useLoginForm.js`).
- **GET /admin/settings:** 200: all settings rows.
- **PUT /admin/settings:** body `{ registration_enabled?: boolean }`; 200:
  `{ messageCode, settings }`.

### 2.5 Related Documents

- [api.md](../../../api.md)
- [setup-wizard.md](../../../features/setup-wizard.md)

### 2.6 Integration Test Scenarios

- [ ] GET /public returns settings without auth (including `setup_complete`)
- [ ] GET /admin/settings requires token + admin
- [ ] PUT /admin/settings updates `registration_enabled` and returns updated settings
