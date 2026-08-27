# UserManagementContent Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | User management for admins: list users, approve/reject pending, delete, create user, open ShareDialog for permissions. Direct content. Admin only. |
| Used in | MyPageContentArea (when selectedCategory is 'admin-users') |
| Related components | adminService, ShareDialog (mode admin for user permissions) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/UserManagementContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/UserManagementContent.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| user | object | Y | - | Current user (admin) |
| onMessage | function | N | - | Message handler for feedback |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onMessage | Feedback from actions | (object) – { type, text } |

### 2.4 Dependencies

- **imports:** useTranslation, usePageHeader (PageHeaderContext), adminService, ShareDialog, validation utils, formatDate, getServerErrorDisplay
- **Header:** Uses `usePageHeader()` to set title `admin.users` and Add button (`common.add`) as actions. Resets on unmount.
- **Origin:** extracted from the earlier admin detail panel (removed as dead code).

### 2.5 i18n Keys

- `admin.users`, `admin.statusPending`, `admin.statusApproved`, `admin.statusRejected`
- `admin.adminRole`, `admin.normalRole`, `admin.joinedAtLabel`
- `admin.approve`, `admin.reject`, `admin.deleteUser`, `admin.deleteUserConfirmTitle`, `admin.deleteUserConfirmBody`, `admin.deleteUserConfirmNote`, `admin.deleteUserConfirmItem1`, `admin.deleteUserConfirmItem2`, `admin.deleteUserConfirmWebdavNote`
- `admin.newUserTitle`, `admin.newUserDesc`, `admin.username`, `admin.email`, `admin.confirmPassword`, `admin.add`, `admin.passwordMinLength`
- `common.add`, `common.cancel`, `common.delete`, `login.password`

### 2.6 Conditional Rendering

- Add button (in header via usePageHeader): opens create user dialog.
- Loading: CircularProgress while fetching users.
- Empty: "No users" message.
- User cards: pending (approve, reject), approved (delete, ShareDialog on click).
- ShareDialog, delete dialog, create dialog, Snackbar.

### 2.7 Verification Scenarios

- [ ] Renders Add button and user list
- [ ] Approve, reject for pending users
- [ ] Delete for non-admin approved users
- [ ] Create user opens dialog and validates
- [ ] ShareDialog opens when non-pending, non-admin user card clicked

### 2.8 Edge Cases

- No pending users – approve/reject not shown for non-pending.
- Delete confirmation – dialog before delete.
- Create user validation – username, email, password, confirm; show validation errors.
