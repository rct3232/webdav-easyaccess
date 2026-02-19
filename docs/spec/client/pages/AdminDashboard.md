# AdminDashboard Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/admin` |
| Role | Admin-only dashboard: user management (approve, reject, delete, create), settings (registration, show hidden files, cleanup), and permission cleanup. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/AdminDashboard.js`
- **Test file:** `client/src/pages/__tests__/AdminDashboard.test.js`

### 2.2 Hooks Used

- useNavigate
- useTranslation
- useResponsive (isMobile)

### 2.3 Main Child Components

- AppBar, Paper, Tabs, Table/Card (desktop vs mobile), Switch, Dialog
- ShareDialog (mode admin for user permissions)

### 2.4 Route Protection

- Wrapped by PrivateRoute; requires auth and admin role (enforced server-side and via route/UI).

### 2.5 Main User Flows

- Users tab: list users (pending + approved), approve/reject pending, delete non-admin, create user
- Settings tab: toggle registration_enabled, show hidden files (localStorage), run orphan cleanup, run permission cleanup
- User click (non-pending, non-admin): open ShareDialog in admin mode for permissions

### 2.6 Integration Test Scenarios

- [ ] Users list loads and displays
- [ ] Approve/reject pending users
- [ ] Delete user with confirmation
- [ ] Create user with validation
- [ ] Settings: toggle registration, save
- [ ] Cleanup dialogs and actions

### 2.7 Conditional Rendering

- Mobile: Card layout instead of Table
- Pending users: approve/reject buttons
- Non-admin users: delete button and permission dialog click
