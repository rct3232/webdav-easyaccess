# settings routes Spec

## 1. Overview

| Item       | Description                                                                                                                |
| ---------- | -------------------------------------------------------------------------------------------------------------------------- |
| Mount path | `/api/admin` (admin settings router) and `/api/settings` (public router only)                                              |
| Role       | Public settings (`registration_enabled`, `email_enabled`, `setup_complete`) — no auth; admin settings GET/PUT — admin auth |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/admin/routes/settings.js` (merged into admin domain; exports the
  admin settings router plus a `publicRouter` named export). The file exports two routers so
  each is mounted under a single prefix — mounting one router on both prefixes created bogus
  aliases (`/api/settings/settings`, `/api/admin/public`) which were retired in the dead-code
  cleanup.
- **Test file:** `server/domains/admin/routes/__tests__/settings.test.js`

### 2.2 Route List

| Method | Path                   | Mount        | Auth          | Description                                                |
| ------ | ---------------------- | ------------ | ------------- | ---------------------------------------------------------- |
| GET    | `/api/settings/public` | publicRouter | None          | Public settings.                                           |
| GET    | `/api/admin/settings`  | router       | Token + Admin | Get all system settings.                                   |
| PUT    | `/api/admin/settings`  | router       | Token + Admin | Update system settings (currently `registration_enabled`). |

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
