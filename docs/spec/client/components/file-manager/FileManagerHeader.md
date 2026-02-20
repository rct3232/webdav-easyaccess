# FileManagerHeader Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Sticky header with logo, search, admin link (for admins), mypage, logout. Mobile: search icon toggles full-width search bar. |
| Used in | FileManager |
| Related components | MUI AppBar, Toolbar, TextField, IconButton |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerHeader.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerHeader.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isMobile | boolean | Y | - | Mobile layout |
| isSearchMode | boolean | Y | - | Search bar visible (mobile) |
| setIsSearchMode | function | Y | - | Toggle search mode |
| searchQuery | string | Y | - | Search input value |
| setSearchQuery | function | Y | - | Set search query |
| user | object | N | - | User (user.is_admin for admin icon) |
| navigate | function | Y | - | Navigation (admin, mypage) |
| handleLogout | function | Y | - | Logout handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| setIsSearchMode | Search mode toggle | (boolean) |
| setSearchQuery | Input change | (string) |
| navigate | Admin/MyPage click | (path) |
| handleLogout | Logout click | - |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI AppBar/Toolbar/Box/TextField/InputAdornment/IconButton, Search/Close/Admin/Person/Logout icons
- **Reference implementation:** `client/src/components/file-manager/FileManagerHeader.js`

### 2.5 i18n Keys

- `nav.searchPlaceholder` – search placeholder
- `nav.searchClose` – close search (mobile)
- `nav.logoAlt` – logo alt text
- `nav.adminDashboard` – admin link title
- `nav.mypage` – mypage link title
- `nav.logout` – logout title

### 2.6 Conditional Rendering

- isMobile && isSearchMode: full-width search bar, close button
- !isMobile: search bar always visible (300px width), optional endAdornment clear
- isMobile && !isSearchMode: search icon to open search
- user?.is_admin: admin icon
- Logo size: mobile 27px, desktop 33.75px

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Logo, search, admin (when admin), mypage, logout render
- [ ] setIsSearchMode(true) when search focused (desktop) or search icon (mobile)
- [ ] setSearchQuery on input change
- [ ] navigate('/admin'), navigate('/mypage')
- [ ] handleLogout on logout click
- [ ] Mobile search mode: full-width search, close clears query and exits mode

### 2.8 Edge Cases

- searchQuery non-empty: desktop shows clear button
- Admin icon hidden when !user?.is_admin
