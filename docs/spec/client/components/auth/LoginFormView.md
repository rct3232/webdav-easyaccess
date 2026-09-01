# LoginFormView Spec

## 1. Overview

| Item               | Description                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| Role               | Pure view for the reusable login form UI. Renders prepared state and callbacks only.           |
| Used in            | `client/src/pages/Login.js` via `LoginForm` and `client/src/components/dialogs/LoginDialog.js` |
| Related components | `LoginForm`, `LoginDialog`                                                                     |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/Login/LoginFormView.js`
- **Test file:** Covered primarily through `client/src/pages/__tests__/Login.test.js` and `client/src/components/dialogs/__tests__/LoginDialog.test.js`

### 2.2 Props

| Name                   | Type       | Required | Default | Description                                                       |
| ---------------------- | ---------- | -------- | ------- | ----------------------------------------------------------------- |
| `username`             | `string`   | Y        | -       | Current username input value.                                     |
| `password`             | `string`   | Y        | -       | Current password input value.                                     |
| `error`                | `string`   | N        | `''`    | Error alert content.                                              |
| `warning`              | `string`   | N        | `''`    | Warning alert content.                                            |
| `loading`              | `boolean`  | Y        | -       | Submit in-flight state.                                           |
| `settingsLoading`      | `boolean`  | Y        | -       | Public settings loading state.                                    |
| `registrationEnabled`  | `boolean`  | Y        | -       | Whether to show the register affordance.                          |
| `registerPath`         | `string`   | Y        | -       | Route target for the register affordance.                         |
| `onNavigateToRegister` | `function` | Y        | -       | Click handler that performs SPA navigation to the register route. |
| `onUsernameChange`     | `function` | Y        | -       | Username input change handler.                                    |
| `onPasswordChange`     | `function` | Y        | -       | Password input change handler.                                    |
| `onSubmit`             | `function` | Y        | -       | Form submit handler.                                              |
| `viewModel`            | `object`   | Y        | -       | Prepared labels and copy for the view.                            |

### 2.3 Callback Signatures

| Callback               | When invoked                | Arguments |
| ---------------------- | --------------------------- | --------- |
| `onUsernameChange`     | Username field changes      | `(event)` |
| `onPasswordChange`     | Password field changes      | `(event)` |
| `onNavigateToRegister` | Register affordance clicked | `(event)` |
| `onSubmit`             | Form submit                 | `(event)` |

### 2.4 Dependencies

- **imports:** MUI components only
- **Must not import:** router modules, services, gateways, storage helpers, browser globals

### 2.5 i18n Keys

- Provided through `viewModel`; the view does not own translation lookups for form copy

### 2.6 Conditional Rendering

- Show a spinner while `settingsLoading` is true
- Show the register affordance only when `registrationEnabled` is true
- Render error and warning alerts when non-empty strings are provided

### 2.7 E2E Selector Contract

- Keep the username field addressable by `input[name="username"]`.
- Keep the password field addressable by `input[name="password"]`.
- Keep the submit action reachable through the login form submit button (`form button[type="submit"]`).
- Shared Playwright auth helpers may rely on these selectors for admin login, approved-user login, and anonymous-route setup checks.

### 2.8 Verification Scenarios

- [ ] Renders username/password fields and submit button
- [ ] Shows spinner while `settingsLoading`
- [ ] Shows error and warning alerts from props
- [ ] Shows register affordance only when `registrationEnabled`
- [ ] Uses `registerPath` without importing router modules directly

### 2.9 Edge Cases

- Empty `error`/`warning` strings: no alert rendered
- `registrationEnabled=false`: no secondary navigation affordance
