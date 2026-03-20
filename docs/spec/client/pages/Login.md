# Login Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/login` |
| Role | Login form page. Supports redirect-after-login or modal-style success via LoginForm props. |

---

## 2. Implementation Spec

### 2.1 File Path
- **Source (page shell):** `client/src/pages/Login.js`
- **Test file:** `client/src/pages/__tests__/Login.test.js`

### 2.2 Hooks Used
- `useLoginForm` (controller hook)
  - useAuth (login)
  - useNavigate
  - useTranslation
- (View) `LoginFormView` does not call hooks and does not import router modules

### 2.3 Main Child Components
- `LoginForm` (controller wrapper, exported from `client/src/pages/Login.js`)
- `LoginFormView` (pure view)
  - See `docs/spec/client/components/auth/LoginFormView.md`

### 2.4 Route Protection

- No PrivateRoute; public page. Authenticated users may be redirected by PrivateRoute elsewhere.

### 2.5 Main User Flows

- Enter username/password and submit
- Success: redirect to `/files` or user home
- Failure: show error (rejected, failed) or warning (pending approval)
- Link to Register if registration_enabled
  - Route target is prepared by the shell/controller layer and passed into the pure view as props

### 2.6 Integration Test Scenarios

- [ ] Form renders with logo and fields
- [ ] Submit with valid credentials navigates
- [ ] Submit with invalid credentials shows error
- [ ] Pending status shows warning
- [ ] Registration link visible when registration_enabled

### 2.7 Conditional Rendering

- Settings loading: CircularProgress while fetching public settings
- Registration link shown only when registration_enabled from getPublicSettings
