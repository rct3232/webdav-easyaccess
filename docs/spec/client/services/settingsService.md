# settingsService Spec

## 1. Overview

| Item | Description                                                                                         |
| ---- | --------------------------------------------------------------------------------------------------- |
| Role | Public settings API (no auth). Used by Login/Register to check registration_enabled, email_enabled. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/settingsService.js`
- **Test file:** `client/src/services/__tests__/settingsService.test.js`

### 2.2 Main Functions

| Function          | Input | Return            | API called               |
| ----------------- | ----- | ----------------- | ------------------------ |
| getPublicSettings | ()    | Promise\<Object\> | GET /api/settings/public |

- Response: `{ registration_enabled, email_enabled, ... }`

### 2.3 Error Handling

- Errors propagated; Login/Register show default (registration disabled, etc.)

### 2.4 Verification Scenarios

- [ ] getPublicSettings returns object with registration_enabled
- [ ] No auth required (public endpoint)
