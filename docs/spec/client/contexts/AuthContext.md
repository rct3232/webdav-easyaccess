# AuthContext Spec

## 1. Overview

| Item                      | Description                                                                                                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role                      | `AuthProvider`: exposes authentication/session state and public auth actions (`login`, `register`, `logout`) through React context. Session-only auth is backed by `sessionStorage`. |
| Used by                   | App root and any component needing `useAuth()` (e.g. `PrivateRoute`, login/register pages, `FileManager`).                                                                           |
| Depends on | `useAuthSession` (session state + actions, fully delegated). Auth error handling (`401`/`403`) remains the responsibility of `apiClient`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/contexts/AuthContext.js`
- **Test file:** `client/src/contexts/__tests__/AuthContext.test.js`

### 2.2 Provided Value

| Key               | Type                                                                                                                      | Description                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------ |
| `user`            | `object                                                                                                                   | null`                                              | Current user object (includes `is_admin`). |
| `loading`         | `boolean`                                                                                                                 | Initial auth check in progress.                    |
| `login`           | `(username, password) => Promise<{ success: boolean, user?: object, error?: string, status?: string, message?: string }>` | Logs in and populates session.                     |
| `register`        | `(username, email, password) => Promise<{ success: boolean, status?: string, error?: string }>`                           | Registers a new user; may return a pending status. |
| `logout`          | `() => void`                                                                                                              | Clears session tokens and resets user.             |
| `isAuthenticated` | `boolean`                                                                                                                 | `true` when `user` is non-null.                    |

### 2.3 `useAuth` Hook

- `useAuth()` returns the context value; throws if used outside an `AuthProvider`.

### 2.4 Dependencies

- React (`createContext`, `useState`, `useContext`, `useEffect`, `useCallback`)
- `useAuthSession` (session state + actions)

### 2.5 Behavior

Session storage and initialization:

- Tokens live in `sessionStorage`:
  - `token` (access token)
  - `refreshToken` (refresh token, if present)
- Legacy cleanup: on initialization, `localStorage.token` is removed.

Fetching user:

- If `token` exists, `loading` stays `true` until `authService.getMe()` resolves.
- On `getMe` failure: `logout()` is called and `loading` becomes `false`.

Token refresh events:

- `useAuthSession` listens to the `token-refreshed` custom event.
- When receiving `token-refreshed` with `{ token }`:
  - update the stored token state,
  - do not refetch the user if it is already present (observable behavior keeps the user authenticated).

Login/register:

- `login(username, password)`:
  - calls `authService.login`,
  - delegates token persistence to `useAuthSession` and `authTokenStore`,
  - sets `user` and `loading=false`,
  - returns `{ success: true, user }` on success.
  - on error: returns `{ success:false, ...errorData }` (caller receives a result; the component does not crash).
- `register(username, email, password)`:
  - calls `authService.register`,
  - if the server returns `status: 'pending'`, returns `{ success:true, status:'pending' }` and does not set token/user.
  - otherwise: persists tokens through `useAuthSession` and sets token/user from the response.

Logout:

- `logout()` clears `token` and `refreshToken` from `sessionStorage` and also removes legacy `token`/`refreshToken` from `localStorage` when possible.

401/403 navigation:

- `apiClient` owns all `401`/`403` behavior (refresh + redirect/back). `AuthContext` only reacts to `getMe` failures by calling `logout()`.

### 2.6 Verification Scenarios

These scenarios should be validated by unit tests through observable outcomes:

- [ ] Unauthenticated: `user` is `null`, `isAuthenticated` is `false`, and `loading` becomes `false` after init.
- [ ] Authenticated: when `sessionStorage.token` is present and `getMe` resolves, `user` is set and `isAuthenticated` becomes `true`.
- [ ] Loading: when token exists and `getMe` is pending, `loading` remains `true`.
- [ ] `login` success: tokens stored, `user` becomes defined, and `isAuthenticated` is `true`.
- [ ] `login` failure: `login()` resolves to `{ success:false }` (no crash; caller gets a result).
- [ ] `register` pending: returns `{ success:true, status:'pending' }` and does not set token/user.
- [ ] `getMe` failure: `logout()` occurs (user cleared) and `loading` becomes `false`.
- [ ] `useAuth` outside provider throws.
- [ ] `token-refreshed`: user remains authenticated and no crash occurs.

### 2.7 Edge Cases

- Storage write failures during `login()` should be handled defensively so the app does not crash; `login()` returns a failure result.
