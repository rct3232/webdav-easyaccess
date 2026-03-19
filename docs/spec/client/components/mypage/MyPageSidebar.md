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
| categories | array | Y | - | Prepared visible category items, already filtered for the current user role. Each item contains `id`, `icon`, and `labelKey`. |
| selectedCategory | string | Y | - | Currently selected category id (e.g. 'account', 'sharing', 'admin-users', 'admin-settings', 'preferences') |
| onSelectCategory | function | Y | - | Handler when a category is clicked |
| isMobile | boolean | N | false | Whether in mobile layout (affects styling if needed) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onSelectCategory | Category item clicked | (categoryId) – string, e.g. 'account', 'sharing', 'admin-users', 'admin-settings', 'preferences' |

### 2.4 Dependencies

- **imports:** useTranslation, MUI (List, ListItemButton, ListItemText, ListItemIcon, etc.)
- **Reference implementation:** `client/src/components/mypage/MyPageSidebar.js`
- **Must not own:** admin-role checks or visibility filtering logic

### 2.5 i18n Keys

- `mypage.accountInfo` – Account category label
- `mypage.shareManage` – Sharing category label
- `admin.users` – User management category label
- `admin.settingsTab` – System settings category label
- `mypage.language` – Preferences category label (or dedicated key like `mypage.preferences`)

### 2.6 Conditional Rendering

- The parent/controller decides which categories are included in `categories`.
- **Selected state:** Highlight the list item for `selectedCategory`.
- Categories shown depend on the prepared `categories` prop.

### 2.7 Verification Scenarios

- [ ] Renders category list (Account, Preferences)
- [ ] When `isMobile` is true, renders the drawer logo at top
- [ ] Renders only the prepared category items it receives
- [ ] Clicking a category calls `onSelectCategory(categoryId)`
- [ ] Selected category is visually highlighted

### 2.8 Edge Cases

- Empty `categories` array – render no category items without crashing
- Unknown `selectedCategory` – no item highlighted; still render all provided categories
