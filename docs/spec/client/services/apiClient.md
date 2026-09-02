# apiClient Spec

## 1. Overview

| Item                      | Description                                                                                                                                                               |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                      | Centralized API client (fetch-based) that unifies request/response parsing, auth token injection, auth error handling (401 refresh + 403 navigation), and retry behavior. |
| Used by                   | `services/*` modules (e.g. `authService`) and any client code that needs consistent `/api/*` request behavior.                                                            |
| Depends on (split target) | `httpClient` (transport + retry + parsing), `authTokenStore` (token persistence + refresh + x-new-token application), `authNavigationPolicy` (redirect/back rules).       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/apiClient.js`
- **Test file:** `client/src/services/__tests__/apiClient.test.js`

### 2.2 Main Functions

The exported API is stable:

| Function  | Input                 | Return                                                                                       | API called        |
| --------- | --------------------- | -------------------------------------------------------------------------------------------- | ----------------- |
| `get`     | `(url, config)`       | `Promise<{ data: any, status: number, statusText: string, headers: Record<string,string> }>` | GET `/api/url`    |
| `post`    | `(url, data, config)` | same as above                                                                                | POST `/api/url`   |
| `put`     | `(url, data, config)` | same as above                                                                                | PUT `/api/url`    |
| `del`     | `(url, config)`       | same as above                                                                                | DELETE `/api/url` |
| `request` | `(config)`            | same as above                                                                                | custom config     |

Shared request defaults:

- Base URL: `/api`
- Timeout: `300000` ms (5 minutes)

### 2.3 Responsibilities

`apiClient` is responsible for orchestrating the following behaviors:

1. **Transport & parsing**: delegate to `httpClient` to perform the actual fetch, parse the response, and throw structured errors that preserve `error.response` and `error.config`.
2. **Token injection**: before each request attempt, if an access token exists, add `Authorization: Bearer <token>` (from `authTokenStore`).
3. **x-new-token application**: after each successful transport request, if response headers include `x-new-token`, apply it via `authTokenStore` and dispatch the `token-refreshed` custom event.
4. **401 handling (unauthorized)**:
   - **Excluded endpoints** (no refresh, no redirect): auth login/register attempts and share-related requests:
     - requests whose `config.url` includes `/auth/login` or `/auth/register`, or
     - requests that include `X-Share-Token` header, or
     - requests whose `config.url` includes `/share/` and `/check-my-permission`.
     - In excluded cases, `apiClient` **rethrows the `401`** (no redirect, no refresh, no retry). The error is rethrown so callers preserve the server's `errorCode` (e.g. `invalidCredentials`) for user-facing messages.
     - Callers treat the thrown `401` as the observable "auth policy skipped" result for those request families.
   - For non-excluded requests:
     - attempt a refresh once (POST to `/api/auth/refresh` with `{ refreshToken }` via `authTokenStore`),
     - on refresh success: retry the original request once using the new token,
     - on refresh failure (or missing refresh token): remove tokens and navigate to `/login` via `authNavigationPolicy`,
     - after refresh failure, the original `401` is not rethrown; observable behavior is session clear + login navigation + resolved `null`.
5. **403 handling (forbidden)**:
   - **Excluded endpoints** (no navigation, rethrow): same exclusion rules as for 401.
   - **Redirectable GET requests**:
     - method must be `GET`, and
     - URL must match:
       - `/api/files/list`, or
       - `/api/admin/*`.
     - For redirectable requests: perform `history.back()` when possible; otherwise navigate to `/`.
     - For redirectable requests, `apiClient` does not throw after navigation (observable behavior is redirect/back then resolution).
   - **Other 403 requests**: rethrow the error (no navigation).

### 2.4 Error Handling

- Client/display errors must preserve `error.response` so UI code can read the server payload.
- For network/timeout errors, transport throws with:
  - `error.code = 'ERR_NETWORK'` for network failures
  - `error.code = 'ECONNABORTED'` for timeout aborts
- Retry applies only to network failures and 5xx statuses (4xx never triggers transport retry).
- Timeout aborts (`ECONNABORTED`) are surfaced immediately and are not retried.

### 2.5 Dependencies (split target)

- `httpClient`: transport + retry + parsing
- `authTokenStore`: sessionStorage persistence, `x-new-token` application, refresh endpoint
- `authNavigationPolicy`: redirect/back rules, excluded-endpoint decisions

### 2.6 Verification Scenarios

Verify observable outcomes (what callers see), not internal implementation:

- [ ] When an access token exists in `sessionStorage`, requests include `Authorization: Bearer <token>`.
- [ ] When a response includes `x-new-token`, the new token is stored and a `token-refreshed` event is dispatched.
- [ ] On `401` for a non-excluded endpoint: refresh succeeds, token is updated, and the original request is retried.
- [ ] On `401` refresh failure for a non-excluded endpoint: tokens are removed, navigation to `/login` occurs, and the request resolves to `null`.
- [ ] On `401` for excluded endpoints: no refresh and no redirect; `apiClient` rethrows the `401` (error preserved).
- [ ] On redirectable `403` (GET `/api/files/list` or GET `/api/admin/*`): history/back-or-`/` navigation occurs without throwing.
- [ ] On non-redirectable `403` or excluded endpoints: `apiClient` rethrows the error.
- [ ] Retry behavior: network failures and 5xx retry with exponential backoff; 4xx and timeout aborts are not retried.
