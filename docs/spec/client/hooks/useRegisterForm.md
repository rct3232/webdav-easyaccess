# useRegisterForm Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Controller hook for the Register form (state + submit orchestration). |
| Used by | `client/src/pages/Register.js` (page shell). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/Register/hooks/useRegisterForm.js`
- **Test file:** `client/src/pages/Register/hooks/__tests__/useRegisterForm.test.js`

### 2.2 Input Parameters

| Name | Type | Required | Description |
|------|------|----------|-------------|
| None | - | - | The hook manages form state internally. |

### 2.3 Return Value / State

| Key | Type | Meaning |
|-----|------|---------|
| `username` | `string` | Current username input value. |
| `email` | `string` | Current email input value. |
| `password` | `string` | Current password input value. |
| `confirmPassword` | `string` | Current confirm password input value. |
| `error` | `string` | Error message shown in an `Alert` severity `error`. |
| `success` | `boolean` | Whether the success message should be shown (pending approval). |
| `loading` | `boolean` | Submit in-flight state. |
| `emailEnabled` | `boolean` | Derived from `getPublicSettings().email_enabled`. |
| `settingsLoading` | `boolean` | Public settings fetch in-flight state. |
| `loginPath` | `string` | Route target for the Login affordance rendered by the view. |
| `onNavigateToLogin` | `(event) => void` | Handles SPA navigation for the login affordance without pushing router imports into the view. |
| `onXChange` | `(e) => void` | Sets each input field from input events. |
| `handleSubmit` | `(e) => Promise<void>` | Prevents default, validates inputs, calls auth `register`, and updates state / navigation. |
| `viewModel` | `object` | Prepared strings/labels for `RegisterFormView`. |

### 2.4 Dependencies

- Services called: `getPublicSettings` (email notification toggle)
- Other hooks: `useAuth` (register), `useNavigate`, `useTranslation`
- Boundaries:
  - Owns route target preparation for the Login affordance.
  - Must not push router imports into `RegisterFormView`.

### 2.5 Side Effects

- Loads public settings on mount to set `emailEnabled`.
- Calls `register(username, email, password)` on submit.
- Navigates to `/files` on success when the returned `status` is not `pending`.

### 2.6 Error Handling

- Validation: sets `error` using `validate*` + `getValidationMessage`.
- Auth failures: sets `error` using `getServerErrorDisplay`.

### 2.7 Verification Scenarios

- Initial state verification (settings loading -> form loading indicator)
- Invalid inputs show an error alert
- Pending register success shows success alert and EmailNotificationMessage (when email enabled)
- Approved/normal success navigates to `/files`

