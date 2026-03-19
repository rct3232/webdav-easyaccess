# MyPage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Route path | `/mypage` |
| Role | User profile and settings: Chrome-style layout with category sidebar (Account, Sharing, User Management, System Settings, Preferences). Account info, edit email/password, share links, permission requests (inbox/outbox), user management, system settings, language. |

---

## 2. Layout (Chrome Settings Style)

### 2.1 PC (Desktop) Layout

- **Left:** Category sidebar (always visible; no divider between sidebar and content). Categories: Account, Sharing, Preferences; User Management, System Settings (admin only).
- **Right:** Content area (flex: 1, scrollable) for selected category.
- **AppBar:** Logo (left, same as FileManager `/logo_white.png`), Close (X, right) → navigates to `/`. No menu button.

### 2.2 Mobile Layout

- **Drawer closed:** AppBar with Menu (left, opens drawer), Close (right). Content area fills screen.
- **Drawer open:** Category list slides in from left with dimmed overlay. Selecting a category closes the drawer.
- **AppBar:** Menu (left), Close (right).

### 2.3 Summary

| Area         | Desktop                           | Mobile                    |
|--------------|-----------------------------------|---------------------------|
| AppBar Left  | Logo (same as FileManager)        | Menu icon (opens drawer)  |
| AppBar Right | Close (X) → navigate to `/`       | Same                      |
| Left Panel   | Category sidebar (always visible) | Inside drawer only        |
| Center       | Content                           | Content                   |

---

## 3. Implementation Spec

### 3.1 File Path

- **Source:** `client/src/pages/MyPage.js`
- **Test file:** `client/src/pages/__tests__/MyPage.test.js`

### 3.2 Hooks Used

- useMyPageController (selected state + navigation callbacks)
- useTranslation
- useResponsive (isMobile)

### 3.3 Main Child Components

- **Inline in MyPage:** AppBar (do not extract)
- **Layout:** MyPageSidebar, MyPageContentArea, MyPageContentPanel
- **Content:** AccountContent, SharingContent, UserManagementContent, SystemSettingsContent, PreferencesContent
- **Dialogs:** ShareDialog (mode share, mode review), AccountEditDialog

### 3.4 Controller-provided State

| State               | Purpose                                                   |
|---------------------|-----------------------------------------------------------|
| selectedCategory    | Current category. Reset selectedContentItem when changed. |
| selectedContentItem | For multi-item categories: null = list view, non-null = detail view. |
| categoryDrawerOpen  | Mobile sidebar drawer visibility.                         |
| sidebarItems        | Prepared category items already filtered for the current role. |

Initial `selectedCategory` may come from `location.state?.category` (e.g. `navigate('/mypage', { state: { category: 'admin-users' } })`). Legacy `admin` maps to `admin-users`.

This normalization is handled by `useMyPageController`.

### 3.5 Categories and Content Flow

| Category      | Type     | Content |
|---------------|----------|---------|
| Account       | Direct   | Profile info, Edit (email, password), Logout at bottom |
| Sharing       | List→Detail | Sub-items: Inbox requests, Outbox requests, Share links. Hidden for admin. |
| User Management | Direct | UserManagementContent. Admin only. |
| System Settings | Direct | SystemSettingsContent. Admin only. |
| Preferences   | Direct   | Language selector (moved from AppBar) |

**List → Detail pattern (Sharing only):**

1. List view: show sub-items as clickable list.
2. On click → replace list with Back button + detail content.
3. Back → return to list. When category changes, reset to list view.

**Single-item (Account, Preferences):** Direct content, no list.

Boundary notes:

- `MyPageSidebar` is a pure view fed with prepared category items; it must not derive admin visibility from `user`.
- `MyPageContentArea` delegates category-to-content resolution to the MyPage registry/helper layer rather than owning inline category dispatch branches.

### 3.6 Route Protection

- Wrapped by PrivateRoute; auth required.

### 3.7 Main User Flows

- View account info (username, email, status, permission)
- Edit account (email, password) via AccountEditDialog
- Logout at bottom of Account content (removed from AppBar)
- Sharing: Inbox (approve/reject), Outbox (cancel), Share links (list, copy, extend, delete). Hidden for admin.
- User Management (approve, reject, delete, create), System Settings (registration, show hidden files, cleanup). Admin only.
- Preferences: Language switch (moved from AppBar)
- Close (X) → navigate to `/`

### 3.8 Integration Test Scenarios

- [ ] PC: Logo visible on AppBar left (same as FileManager)
- [ ] Category selection updates content; when category changes, reset to list view if multi-item
- [ ] Menu button visible only on mobile; toggles category drawer
- [ ] Close navigates to `/`
- [ ] Account info displays for current user
- [ ] Account edit: email/password update, password change logs out
- [ ] Logout at bottom of Account content
- [ ] Language rendered in Preferences content
- [ ] Multi-item (Sharing): List view shows sub-items; click item → Detail view (Back button + content); Back → List view
- [ ] User Management and System Settings visible only when `user.is_admin`; Sharing hidden when admin
- [ ] Share links, inbox/outbox flows work as before
- [ ] Tests must wait until authenticated user-driven layout is rendered before querying category controls or content headings (e.g. wait for AppBar Close button or visible category button). Avoid immediate synchronous `getBy*` right after render when AuthProvider still resolves `auth/me`.

### 3.9 Conditional Rendering

- Admin category visible only when `user.is_admin`
- Sharing category hidden when `user.is_admin`
- Share links tab (inside Sharing) visible only for non-admin
- Mobile: Menu button; categories inside SwipeableDrawer
- Desktop: No drawer; fixed left sidebar
