# RegisterFormView Spec

## 1. Overview

| Item               | Description                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- |
| Role               | Pure view for the registration form UI. Renders prepared state and callbacks only. |
| Used in            | `client/src/pages/Register.js`                                                     |
| Related components | `EmailNotificationMessage`                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/Register/RegisterFormView.js`
- **Test file:** Covered primarily through `client/src/pages/__tests__/Register.test.js`

### 2.2 Props

| Name                      | Type       | Required | Default | Description                                                           |
| ------------------------- | ---------- | -------- | ------- | --------------------------------------------------------------------- |
| `username`                | `string`   | Y        | -       | Current username value.                                               |
| `email`                   | `string`   | Y        | -       | Current email value.                                                  |
| `password`                | `string`   | Y        | -       | Current password value.                                               |
| `confirmPassword`         | `string`   | Y        | -       | Current confirmation value.                                           |
| `error`                   | `string`   | N        | `''`    | Error alert content.                                                  |
| `success`                 | `boolean`  | Y        | -       | Whether the pending-success block is visible.                         |
| `loading`                 | `boolean`  | Y        | -       | Submit in-flight state.                                               |
| `emailEnabled`            | `boolean`  | Y        | -       | Whether email follow-up messaging should be shown on pending success. |
| `settingsLoading`         | `boolean`  | Y        | -       | Public settings loading state.                                        |
| `loginPath`               | `string`   | Y        | -       | Route target for the login affordance.                                |
| `onNavigateToLogin`       | `function` | Y        | -       | Click handler that performs SPA navigation to the login route.        |
| `onUsernameChange`        | `function` | Y        | -       | Username change handler.                                              |
| `onEmailChange`           | `function` | Y        | -       | Email change handler.                                                 |
| `onPasswordChange`        | `function` | Y        | -       | Password change handler.                                              |
| `onConfirmPasswordChange` | `function` | Y        | -       | Confirm password change handler.                                      |
| `onSubmit`                | `function` | Y        | -       | Form submit handler.                                                  |
| `viewModel`               | `object`   | Y        | -       | Prepared labels and copy for the view.                                |

### 2.3 Callback Signatures

| Callback                  | When invoked                   | Arguments |
| ------------------------- | ------------------------------ | --------- |
| `onUsernameChange`        | Username field changes         | `(event)` |
| `onEmailChange`           | Email field changes            | `(event)` |
| `onPasswordChange`        | Password field changes         | `(event)` |
| `onConfirmPasswordChange` | Confirm password field changes | `(event)` |
| `onNavigateToLogin`       | Login affordance clicked       | `(event)` |
| `onSubmit`                | Form submit                    | `(event)` |

### 2.4 Dependencies

- **imports:** MUI components and `EmailNotificationMessage`
- **Must not import:** router modules, services, gateways, storage helpers, browser globals

### 2.5 i18n Keys

- Provided through `viewModel`; the view does not own translation lookups for form copy

### 2.6 Conditional Rendering

- Show a spinner while `settingsLoading` is true
- Show the success block only when `success` is true
- Show `EmailNotificationMessage` only when `success` and `emailEnabled` are both true
- Always render the login affordance from `loginPath`

### 2.7 Verification Scenarios

- [ ] Renders registration fields and submit button
- [ ] Shows spinner while `settingsLoading`
- [ ] Shows success state and email follow-up copy when applicable
- [ ] Shows error alert from props
- [ ] Uses `loginPath` without importing router modules directly

### 2.8 Edge Cases

- `success=true`: submit button disabled
- Empty `error`: no error alert rendered
