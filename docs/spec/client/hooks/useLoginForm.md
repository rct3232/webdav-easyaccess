# useLoginForm Spec

## 1. Overview

| Item    | Description                                                                       |
| ------- | --------------------------------------------------------------------------------- |
| Role    | Controller hook for the Login form (state + submit orchestration).                |
| Used by | `client/src/pages/Login.js` (page shell) and modal `LoginDialog` via `LoginForm`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/Login/hooks/useLoginForm.js`
- **Test file:** `client/src/pages/Login/hooks/__tests__/useLoginForm.test.js`

### 2.2 Input Parameters

| Name                 | Type                    | Required | Description                                                                                |
| -------------------- | ----------------------- | -------- | ------------------------------------------------------------------------------------------ |
| `redirectAfterLogin` | `boolean`               | Y        | When `true`, navigate to the user's home route on success; when `false`, call `onSuccess`. |
| `onSuccess`          | `(result: any) => void` | N        | Called on login success when `redirectAfterLogin` is `false`.                              |

### 2.3 Return Value / State

| Key                    | Type                   | Meaning                                                                                          |
| ---------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `username`             | `string`               | Current username input value.                                                                    |
| `password`             | `string`               | Current password input value.                                                                    |
| `error`                | `string`               | Error message shown in an `Alert` severity `error`.                                              |
| `warning`              | `string`               | Warning message shown in an `Alert` severity `warning`.                                          |
| `loading`              | `boolean`              | Submit in-flight state.                                                                          |
| `settingsLoading`      | `boolean`              | Public settings fetch in-flight state.                                                           |
| `registrationEnabled`  | `boolean`              | Derived from `getPublicSettings().registration_enabled`.                                         |
| `registerPath`         | `string`               | Route target for the Register affordance rendered by the view.                                   |
| `onNavigateToRegister` | `(event) => void`      | Handles SPA navigation for the register affordance without pushing router imports into the view. |
| `onUsernameChange`     | `(e) => void`          | Sets `username` from input events.                                                               |
| `onPasswordChange`     | `(e) => void`          | Sets `password` from input events.                                                               |
| `handleSubmit`         | `(e) => Promise<void>` | Prevents default, validates inputs, calls auth `login`, and updates state / navigation.          |
| `viewModel`            | `object`               | Prepared strings/labels for `LoginFormView` (logo alt, field labels, button text, etc.).         |

### 2.4 Dependencies

- Services called: `getPublicSettings` (registration toggle)
- Other hooks: `useAuth` (login), `useNavigate`, `useTranslation`
- Boundaries:
  - Owns route target preparation for secondary navigation affordances.
  - Must not push router imports into `LoginFormView`.

### 2.5 Side Effects

- Loads public settings on mount to set `registrationEnabled`.
- Calls `login(username, password)` on submit.
- Navigates to user home on successful login when `redirectAfterLogin` is `true`.

### 2.6 Error Handling

- Validation: sets `error` using `validateRequired` + `getValidationMessage`.
- Auth failures:
  - `status === 'pending'`: sets `warning`
  - `status === 'rejected'`: sets `error`
  - otherwise: sets `error`

### 2.7 Verification Scenarios

- Initial state verification (settings loading -> form loading indicator)
- Settings toggle updates `registrationEnabled`
- Empty submit sets an error alert
- Pending login sets a warning alert
- Approved/normal success navigates to the correct route
