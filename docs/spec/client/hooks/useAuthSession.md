# useAuthSession Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Auth session controller hook. Owns session-backed user state (`user`, `loading`) and exposes public auth actions (`login`, `register`, `logout`). |
| Used by | `AuthContext` provider. |
| Does not own | Auth `401/403` navigation/refresh behavior (belongs to `apiClient`). It only reacts to `getMe` failures and token-refreshed events. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/hooks/useAuthSession.js`
- **Test file:** `client/src/hooks/__tests__/useAuthSession.test.js`

### 2.2 Input Parameters

- `useAuthSession()` has no input parameters.

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| `user` | `object | null` | Current user or null. |
| `loading` | `boolean` | Initial auth-check status. |
| `login` | `(username: string, password: string) => Promise<{ success: boolean, user?: object, error?: string, status?: string, message?: string }>` | Login action. |
| `register` | `(username: string, email: string, password: string) => Promise<{ success: boolean, status?: string, error?: string, message?: string }>` | Register action. |
| `logout` | `() => void` | Clears tokens and user state. |
| `isAuthenticated` | `boolean` | `!!user`. |

### 2.4 Dependencies

- `authService.getMe/login/register`
- `authTokenStore` for token read/write/remove helpers
- `normalizeAuthUser` (for `getMe` and `login` normalization)
- React hooks (`useState`, `useEffect`, `useCallback`)

Must not own:
- Auth navigation/redirect/back rules

### 2.5 Side Effects

On init:
- Read the access token via `authTokenStore.getAccessToken()`.
- Legacy cleanup: remove `localStorage['token']` on init.
- If token exists: call `authService.getMe()` and set `loading=false` when done.

Event subscription:
- Subscribe to `window` `token-refreshed` event.
- When event arrives with `{ token }`:
  - update the stored token state,
  - do not necessarily refetch `getMe` if `user` is already present.

On auth actions:
- `login` stores tokens via `authTokenStore` and updates `user`.
- `register` stores tokens via `authTokenStore` and updates `user` on non-pending success.
- `logout` clears tokens via `authTokenStore.removeTokens()` and also removes legacy local storage tokens.

### 2.6 Error Handling

- `getMe` failure must clear auth state by calling `logout()` and set `loading=false`.
- `login` and `register` return failure results rather than throwing uncontrolled errors (callers receive `{ success:false }`).

### 2.7 Verification Scenarios

Verify observable outcomes to match existing `AuthContext` behavior:
- [ ] Unauthenticated init: `loading` becomes false and `user` remains null when no `sessionStorage.token` exists.
- [ ] Authenticated init: when token exists and `getMe` resolves, `user` is set and `isAuthenticated` becomes true.
- [ ] Loading: when token exists and `getMe` is pending, `loading` stays true.
- [ ] `getMe` failure: calls `logout()` and clears `user`.
- [ ] `login` success: tokens are stored, `user` is set, `isAuthenticated` becomes true.
- [ ] `login` failure: returns `{ success:false }` and does not crash the component tree.
- [ ] `register` pending: returns `{ success:true, status:'pending' }` and does not store token/user.
- [ ] `token-refreshed` keeps user authenticated: user remains unchanged and no crash occurs.

### 2.8 Edge Cases

- SessionStorage write errors during `login`/`register` are handled defensively so the hook returns a failure result and the app does not crash.
