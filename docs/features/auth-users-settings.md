# Auth, Users, and Public Settings

This document describes authentication (register, login, refresh, me), user management APIs (list, approved, profile, password/email/permissions), and public settings. Use it together with [api.md](../api.md) and [shared-contracts.md](../shared-contracts.md).

---

## Overview

The application uses JWT-based authentication. Users sign up (when registration is enabled), may wait for admin approval, then log in to receive an access token (and optional refresh token).

This feature deliberately separates responsibilities:

- **Auth/session policy**: what the client considers a session, when it retries refresh, and what it does on 401/403.
- **Transport**: how HTTP requests are performed (headers, retries) without owning product navigation decisions.
- **Storage**: where tokens live (session-scoped) and how token changes are persisted.
- **Page UI**: how login/register screens present errors and use public settings, without implementing refresh or storage rules.

The `/api/auth/me` endpoint provides the current user. User APIs support listing users (e.g. for share dialogs), updating one’s own profile fields (password/email), and managing permissions. Public settings (e.g. whether signup is enabled) are exposed without authentication for the login/register UI.

---

## Specification

### Auth APIs

| Endpoint | Method | Auth | Input | Output / Notes |
|----------|--------|------|-------|----------------|
| `/api/auth/register` | POST | None | `username`, `email`, `password` | On success: `{ messageCode, status: 'pending' }` or `{ token, refreshToken?, user }` if auto-approved. Duplicate username/email → 400 with `errorCode`. Registration disabled → 403. |
| `/api/auth/login` | POST | None | `username`, `password` | Returns `{ user, token, refreshToken? }`. Rate limited (429); pending/rejected status → 403 with `errorCode`. |
| `/api/auth/refresh` | POST | None | `refreshToken` (body) | Returns `{ token }`. Invalid/expired refresh → 401. |
| `/api/auth/me` | GET | Token | — | Returns current user object. 401 if invalid/expired. |

**Input rules (validation):**

- Username, email, password: required on register/login where applicable. Validation uses `shared/validation.js` (e.g. `validateUsername`, `validateEmail`, `validatePassword`). Server returns 400 with appropriate `errorCode` for invalid input.
- Passwords: minimum/maximum length enforced; password change requires `currentPassword` and `newPassword`.

**Rate limit (login):**

- In-memory, per-process. Keyed by client IP (or `X-Forwarded-For`).
- Env: `LOGIN_RATE_LIMIT_WINDOW_MS` (default 15m), `LOGIN_RATE_LIMIT_MAX` (default 20).
- When exceeded: 429 with `errorCode` (e.g. `serverErrors.auth.loginRateLimit`), `Retry-After` header.

---

## Client responsibility boundaries (auth/session vs transport vs storage vs UI)

### Auth/session policy (behavioral rules)

The client treats a "session" as valid only while an access token exists and is accepted by the server.

- **Token lifetime and refresh**:
  - On an authenticated request returning **401**, the client may attempt **one** refresh flow (when a refresh token is available) and then retry the original request.
  - If refresh fails (refresh endpoint returns 401, is missing a refresh token, or refresh cannot be performed), the client clears auth session state and routes the user to login.
- **401 handling**:
  - Interpreted as "authentication failed" (missing/invalid/expired token).
  - Results in refresh-once behavior as above, then logout + login navigation on failure.
- **403 handling**:
  - Interpreted as "authorization denied" for the current user.
  - Navigation behavior is a **policy**, not a transport concern:
    - For failures that happen immediately after a deliberate route transition to a protected page (e.g. admin-only pages, user list), the client may navigate back (`history.back()`) or route to a safe default (e.g. `/`).
    - For failures in-place (e.g. a forbidden action within an already-open page), the client should not automatically redirect; the error is surfaced to the caller/UI.
- **Logout**:
  - Clearing the session is the single source of truth for "logged out".
  - Closing the browser should effectively log the user out because tokens are stored in session-scoped storage.

### Transport (HTTP request mechanics)

Transport is responsible for making HTTP requests and attaching auth headers, but it does not define product navigation or storage rules.

- **Attach auth header**: authenticated requests include `Authorization: Bearer <token>`.
- **Retry orchestration hook**: transport may expose a way for auth/session policy to retry the original request after refresh succeeds.
- **Rate limit surface**: 429 responses should be surfaced with `Retry-After` so the UI can render an actionable message.

### Storage (token persistence)

Storage is responsible for persisting and retrieving tokens. It must not decide when to refresh or how to route.

- **Session-scoped storage**: client stores `token` (and optionally `refreshToken`) in **sessionStorage** only.
- **No localStorage for auth**: the app should not persist auth tokens across browser restarts.
- **Token update semantics**: updating tokens is atomic from the perspective of request orchestration (e.g. after refresh, subsequent requests use the new token).

### Page UI (login/register/settings screens)

Pages and UI components present states and trigger actions; they should not implement transport or storage details.

- **Login UI**:
  - Collects credentials and calls login.
  - Renders errors based on `errorCode` (e.g. invalid credentials, pending approval, rejected, rate limit).
- **Register UI**:
  - Calls public settings to determine whether signup is enabled.
  - Submits registration, then renders either "pending approval" success or immediate login success if auto-approved.
- **Public settings usage**:
  - `GET /api/settings/public` is used to conditionally render registration affordances (and related messaging) without requiring an auth token.

### User APIs

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/users` | GET | Token | List users (e.g. for share dialogs). |
| `/api/users/approved` | GET | Token | List approved users only. |
| `/api/users/:id` | GET | Token | Get user by id. |
| `/api/users/:id/password` | PUT | Token | Change password. Body: `currentPassword`, `newPassword`. Only self (or admin) allowed; success invalidates other sessions via `token_version`. |
| `/api/users/:id/email` | PUT | Token | Update email. Only self (or admin) allowed. |
| `/api/users/:id/permissions` | PUT | Token | Update current user's own permissions (e.g. home folder). |

See [api.md](../api.md) for exact body/query shapes.

### Public Settings

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/settings/public` | GET | None | Returns public settings (e.g. `signupEnabled`). Used by login/register pages. |

---

## Flows

### Registration

```mermaid
sequenceDiagram
    participant C as Client
    participant S as Server
    
    C->>S: POST /api/auth/register { username, email, password }
    alt Registration disabled
        S-->>C: 403 errorCode: registrationDisabled
    else Duplicate username/email
        S-->>C: 400 errorCode: usernameTaken | emailTaken
    else Success
        S->>S: Create user (status: pending)
        S->>S: Send pending email (if configured)
        S-->>C: 201 { messageCode, status: 'pending' }
    end
```

- If admin has enabled “auto-approve” or equivalent, response may include `token`, `user` and client can log in immediately.

### Login (with rate limit and approval check)

```mermaid
flowchart TD
    A["POST /api/auth/login"] --> B{Valid body?}
    B -->|No| C[400 requiredFields]
    B -->|Yes| D{Rate limit OK?}
    D -->|No| E[429 loginRateLimit + Retry-After]
    D -->|Yes| F{User exists?}
    F -->|No| G[401 invalidCredentials]
    G --> H[recordLoginFailure]
    F -->|Yes| I{Password valid?}
    I -->|No| G
    I -->|Yes| J{Status approved?}
    J -->|pending| K[403 pendingApproval]
    J -->|rejected| L[403 rejected]
    K --> H
    L --> H
    J -->|approved| M[clearLoginFailures]
    M --> N[Return token, refreshToken?, user]
```

### Token refresh

- Client sends `POST /api/auth/refresh` with `{ refreshToken }`.
- Server validates refresh token; if valid, returns new `{ token }`. Client stores new token and may dispatch a `token-refreshed` event for axios header update.
- Invalid or expired refresh → 401; client should redirect to login or clear session.

### 401/403 and logout

- **401**: authentication failed (missing/invalid/expired token). Attempt refresh once; on failure, clear session and route to `/login`.
- **403**: authorization denied. For protected-route transitions, navigate back or route to a safe default; otherwise surface the error without forced redirect.

---

## Testing

When implementing or reviewing tests for auth and users, cover at least:

- **Duplicate username/email:** Register with existing username or email → 400 with appropriate `errorCode`.
- **Pending/rejected login:** User with status `pending` or `rejected` → 403 with corresponding `errorCode`; no token returned.
- **Rate limit:** Excessive login attempts from same IP → 429 with `errorCode` for rate limit and `Retry-After` header; after successful login, failures for that key are cleared.
- **Password change invalidates tokens:** After changing password (server increments `token_version`), existing tokens no longer valid; next request with old token gets 401 and client logs out.
- **Self-only updates:** Only the authenticated user (or admin) can change their own password/email; others get 403.
- **Public settings:** `GET /api/settings/public` returns without auth and includes signup-enabled flag; register page uses it to show/hide signup.

Use [TESTING_STRATEGY.md](../TESTING_STRATEGY.md) for unit vs integration and mocking (e.g. MSW for client, test JWT for server).
