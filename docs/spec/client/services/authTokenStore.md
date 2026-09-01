# authTokenStore Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                  |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | SessionStorage-backed token persistence and refresh. Provides helpers for reading/writing tokens, applying `x-new-token`, and performing the `/api/auth/refresh` call used for 401 recovery. |
| Used by      | `apiClient` and `useAuthSession` (for session initialization and auth action token persistence).                                                                                             |
| Does not own | Auth navigation/redirect/back rules. Those belong to `authNavigationPolicy`.                                                                                                                 |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/authTokenStore.js`
- **Test file:** `client/src/services/__tests__/authTokenStore.test.js`

### 2.2 Main Functions

| Function                   | Input            | Return            |
| -------------------------- | ---------------- | ----------------- | ---------------------------- |
| `getAccessToken`           | none             | `string           | null`                        |
| `getRefreshToken`          | none             | `string           | null`                        |
| `setAccessToken`           | `(token)`        | `void`            |
| `setRefreshToken`          | `(refreshToken)` | `void`            |
| `removeTokens`             | none             | `void`            |
| `applyNewTokenFromHeaders` | `(headers)`      | `string           | null` (new token if present) |
| `refreshAccessToken`       | none             | `Promise<string>` |

Token keys:

- Access token key: `sessionStorage['token']`
- Refresh token key: `sessionStorage['refreshToken']`

Event:

- When a new access token is applied (either from `x-new-token` headers or from refresh response), dispatch:
  - `window.dispatchEvent(new CustomEvent('token-refreshed', { detail: { token } }))`

Refresh call:

- `refreshAccessToken()` performs:
  - POST `${origin}/api/auth/refresh`
  - body: `{ refreshToken }` as JSON
  - expects JSON response containing `{ token }`
- On success:
  - stores the new access token via `setAccessToken`
  - dispatches `token-refreshed`
  - resolves with the new token
- On failure:
  - removes tokens (`removeTokens`)
  - throws an error (caller decides whether to navigate)

### 2.3 Side Effects

- Writes/clears `sessionStorage` token keys.
- Dispatches `token-refreshed` event on token changes.
- Does not own auth navigation decisions; callers handle redirect/back policy separately.

### 2.4 Error Handling

- `refreshAccessToken()` throws when:
  - no refresh token exists,
  - refresh endpoint responds without `{ token }`,
  - network/transport fails.

### 2.5 Verification Scenarios

- [ ] `getAccessToken` / `getRefreshToken` read from the correct sessionStorage keys.
- [ ] `removeTokens` clears both `token` and `refreshToken`.
- [ ] `applyNewTokenFromHeaders` detects `x-new-token` and dispatches `token-refreshed`.
- [ ] `refreshAccessToken` posts the current refresh token and stores the returned token.
- [ ] `refreshAccessToken` failure removes tokens and throws (no redirect behavior).
