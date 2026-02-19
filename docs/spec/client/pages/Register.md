# Register Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/register` |
| Role | User registration form. Validates username, email, password; on success either shows pending message or navigates to `/files`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/Register.js`
- **Test file:** `client/src/pages/__tests__/Register.test.js`

### 2.2 Hooks Used

- useAuth (register)
- useNavigate
- useTranslation

### 2.3 Main Child Components

- Paper, TextField, Button, Alert
- EmailNotificationMessage (when email_enabled)

### 2.4 Route Protection

- No PrivateRoute; public page.

### 2.5 Main User Flows

- Enter username, email, password, confirm password
- Validation: required, username format, email format, password strength, match
- Submit: register via authService
- Success: pending → show success + EmailNotificationMessage if enabled; otherwise navigate to /files

### 2.6 Integration Test Scenarios

- [ ] Form renders with validation
- [ ] Invalid inputs show error
- [ ] Successful register navigates or shows pending success
- [ ] EmailNotificationMessage shown when email_enabled

### 2.7 Conditional Rendering

- Settings loading: CircularProgress
- Success alert with EmailNotificationMessage when email_enabled and status is pending
