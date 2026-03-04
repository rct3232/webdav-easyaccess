# MyPageSidebar Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Category list for MyPage. On PC: fixed left panel (always visible). On mobile: renders inside parent SwipeableDrawer. |
| Used in | MyPage |
| Related components | MyPageContentArea, SwipeableDrawer (parent wraps this on mobile) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/MyPageSidebar.js`
- **Test file:** `client/src/components/mypage/__tests__/MyPageSidebar.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| selectedCategory | string | Y | - | Currently selected category id (e.g. 'account', 'sharing', 'admin-users', 'admin-settings', 'preferences') |
| onSelectCategory | function | Y | - | Handler when a category is clicked |
| user | object | N | - | Current user; used for `user?.is_admin` to show/hide Admin and Sharing |
| isMobile | boolean | N | false | Whether in mobile layout (affects styling if needed) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onSelectCategory | Category item clicked | (categoryId) – string, e.g. 'account', 'sharing', 'admin-users', 'admin-settings', 'preferences' |

### 2.4 Dependencies

- **imports:** useTranslation, MUI (List, ListItemButton, ListItemText, ListItemIcon, etc.)
- **Reference implementation:** `client/src/components/mypage/MyPageSidebar.js`

### 2.5 i18n Keys

- `mypage.accountInfo` – Account category label
- `mypage.shareManage` – Sharing category label
- `admin.users` – User management category label
- `admin.settingsTab` – System settings category label
- `mypage.language` – Preferences category label (or dedicated key like `mypage.preferences`)

### 2.6 Conditional Rendering

- **Admin categories (admin-users, admin-settings):** Visible only when `user?.is_admin` is true.
- **Sharing category:** Hidden when `user?.is_admin` is true.
- **Selected state:** Highlight the list item for `selectedCategory`.
- Categories shown: Account (always), Sharing (non-admin only), User Management (admin only), System Settings (admin only), Preferences (always).

### 2.7 Verification Scenarios

- [ ] Renders category list (Account, Preferences)
- [ ] When `isMobile` is true, renders logo at top (same as AppBar)
- [ ] Admin categories (User Management, System Settings) shown when `user?.is_admin`, hidden otherwise
- [ ] Sharing category shown when not admin, hidden when admin
- [ ] Clicking a category calls `onSelectCategory(categoryId)`
- [ ] Selected category is visually highlighted

### 2.8 Edge Cases

- `user` is null/undefined – assume non-admin (hide Admin categories, show Sharing).
- Unknown `selectedCategory` – no item highlighted; still render all visible categories.
