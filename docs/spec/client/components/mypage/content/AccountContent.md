# AccountContent Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Account info display, Edit (opens AccountEditDialog), Logout at bottom. Single-item category content. |
| Used in | MyPageContentArea (when selectedCategory is 'account') |
| Related components | AccountEditDialog, userService |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/AccountContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/AccountContent.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| user | object | Y | - | Current user (username, email, status, is_admin) |
| onMessage | function | N | - | Message handler for success/error feedback |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onMessage | API success/failure, validation error | ({ type, text }) |

### 2.4 Dependencies

- **imports:** useTranslation, useNavigate, useAuth, usePageHeader (PageHeaderContext), AccountEditDialog, userService (updateEmail, updatePassword), validation utils
- **Header:** Uses `usePageHeader()` to set title `mypage.accountInfo` and Edit IconButton as actions. Resets on unmount.
- **Reference implementation:** `client/src/components/mypage/content/AccountContent.js`, `client/src/pages/MyPage.js` (account section logic)

### 2.5 i18n Keys

- `mypage.accountInfo` – Section title
- `mypage.editAccountInfo` – Edit button aria-label
- `login.username` – Username label
- `dialogs.email` – Email label
- `mypage.accountStatus` – Status label
- `mypage.permission` – Permission label
- `mypage.approvedStatus`, `mypage.pending`, `mypage.rejected` – Status values
- `mypage.admin`, `mypage.normalUser` – Permission values
- `nav.logout` – Logout button

### 2.6 Conditional Rendering

- Display user info (username, email, status, permission). No inline title; title and Edit IconButton rendered in MyPageContentPanel header via usePageHeader.
- Edit IconButton (in header) opens AccountEditDialog.
- Logout Button at bottom; on click: logout() and navigate to '/login'.
- Message Alert when onMessage has been called with type/text.

### 2.7 Verification Scenarios

- [ ] Displays user info (username, email, status, permission)
- [ ] Edit button opens AccountEditDialog
- [ ] AccountEditDialog: save calls update APIs; password change triggers logout + navigate
- [ ] Logout button calls logout and navigates to /login
- [ ] Message display when onMessage provides feedback

### 2.8 Edge Cases

- `user` null/undefined – show loading or empty state.
- Password change success – close dialog, show success message, then logout and redirect.
