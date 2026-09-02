# authNavigationPolicy Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                             |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Centralizes observable navigation side effects for auth failures (401 refresh failure and 403 forbidden). It also decides which requests are excluded from navigation rules (auth attempts and share-related requests). |
| Used by      | `apiClient` (to decide redirect/back behavior).                                                                                                                                                                         |
| Does not own | Token persistence/removal (belongs to `authTokenStore`).                                                                                                                                                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/authNavigationPolicy.js`
- **Test file:** `client/src/services/__tests__/authNavigationPolicy.test.js`

### 2.2 Main Functions

| Function                   | Input             | Return                          |
| -------------------------- | ----------------- | ------------------------------- |
| `is403RedirectableRequest` | `(config)`        | `boolean`                       |
| `shouldSkipAuthNavigation` | `(config)`        | `boolean`                       |
| `handle403`                | `(config, error)` | `void` (may throw)              |
| `handle401RefreshFailure`  | `(config)`        | `void` (navigation side effect) |

Excluded endpoints / requests (no navigation; rethrow or return null by caller):

- `config.url` includes `/auth/login` or `/auth/register`
- requests containing `X-Share-Token` header
- requests whose `config.url` includes `/share/` and `/check-my-permission`

403 redirectable requests:

- HTTP method must be `GET`
- URL must match:
  - `/api/files/list`, or
  - `/api/admin/*`
- Accepted examples:
  - `/api/files/list`
  - `/api/admin/users`
- Rejected examples:
  - `files/list`
  - `admin/users`
  - `/api/files/upload`
  - `POST /api/admin/users`

Redirect/back behavior (browser-only):

- `handle403` for redirectable requests performs:
  - `window.history.back()` when `window.history.length > 1`
  - otherwise `window.location.href = '/'`

401 refresh failure:

- `handle401RefreshFailure` navigates to `/login` (typically `window.location.href = '/login'`).

### 2.3 Side Effects

- Uses `window.history` and `window.location` (must guard for non-browser environments).
- Throws for excluded/non-redirectable 403 cases so callers can preserve error behavior.

### 2.4 Verification Scenarios

- [ ] `is403RedirectableRequest` returns true only for GET `/api/files/list` and GET `/api/admin/*`.
- [ ] `shouldSkipAuthNavigation` returns true for auth login/register, share-token requests, and share permission-check requests.
- [ ] `handle403` performs `history.back()` or `/` navigation for redirectable requests.
- [ ] `handle403` does not navigate and rethrows for excluded or non-redirectable 403 requests.
- [ ] `handle401RefreshFailure` navigates to `/login`.
