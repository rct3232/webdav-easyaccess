# MyPage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/mypage` |
| Role | User profile and share management: account info, edit email/password, share links, permission requests (inbox/outbox). |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/MyPage.js`
- **Test file:** `client/src/pages/__tests__/MyPage.test.js`

### 2.2 Hooks Used

- useAuth (user, logout)
- useNavigate
- useTranslation

### 2.3 Main Child Components

- AppBar, Paper, Tabs, Stack, Chip, Button
- ShareDialog (mode share, mode review)
- AccountEditDialog

### 2.4 Route Protection

- Wrapped by PrivateRoute; auth required.

### 2.5 Main User Flows

- View account info (username, email, status, permission)
- Edit account (email, password) via AccountEditDialog
- Manage share links: list, copy URL, extend expiry, delete
- Permission requests: inbox (approve/reject), outbox (cancel)
- Language switch via Menu
- Back to home

### 2.6 Integration Test Scenarios

- [ ] Account info displays for current user
- [ ] Account edit: email/password update, password change logs out
- [ ] Share links tab: list, copy, delete, extend
- [ ] Inbox requests: approve, reject
- [ ] Outbox requests: cancel

### 2.7 Conditional Rendering

- Share management section hidden for admin users
- Links tab visible only for non-admin
- Loading states for share links and permission requests
