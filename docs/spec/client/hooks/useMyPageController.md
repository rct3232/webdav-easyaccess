# useMyPageController Spec

## 1. Overview

| Item                     | Description                                                    |
| ------------------------ | -------------------------------------------------------------- |
| Role                     | Controller hook for MyPage layout state + navigation callbacks |
| Used by components/pages | `client/src/pages/MyPage.js`                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/MyPage/hooks/useMyPageController.js`
- **Test file:** `client/src/pages/MyPage/hooks/__tests__/useMyPageController.test.js`

### 2.2 Input Parameters

| Name     | Type    | Required | Description                                                   |
| -------- | ------- | -------- | ------------------------------------------------------------- |
| isMobile | boolean | Y        | Whether the current layout uses the mobile drawer category UI |

### 2.3 Return Value / State

| Key                   | Type                                                                 | Meaning                                                                           |
| --------------------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| user                  | object \| null                                                       | Current user object from `useAuth()` (controls admin-only category normalization) |
| selectedCategory      | string                                                               | Currently selected MyPage category id                                             |
| selectedContentItem   | string \| null                                                       | For multi-item categories: `null` = list view, non-null = detail view             |
| categoryDrawerOpen    | boolean                                                              | Mobile category drawer visibility                                                 |
| `sidebarItems`        | `Array<{ id: string, icon: React.ComponentType, labelKey: string }>` | Visible category items prepared for the current role                              |
| onSelectCategory      | (categoryId: string) => void                                         | Updates selected category and resets `selectedContentItem` to list view           |
| onSelectContentItem   | (itemId: string \| null) => void                                     | Switches between list and detail view for multi-item categories                   |
| onOpenCategoryDrawer  | () => void                                                           | Opens the category drawer (mobile)                                                |
| onCloseCategoryDrawer | () => void                                                           | Closes the category drawer (mobile)                                               |
| onCloseMyPage         | () => void                                                           | Navigates to `/` (AppBar close icon)                                              |

### 2.4 Dependencies

- Hooks:
- `useAuth()` for `user`
- `useLocation()` for `location.state?.category` bootstrapping
- `useNavigate()` for `onCloseMyPage`
- Pure helpers/constants:
- `resolveMyPageCategory()`, `getMyPageSidebarCategories()`, and `DEFAULT_MY_PAGE_CATEGORY` from `client/src/utils/myPageRegistry.js`

### 2.5 Side Effects

- When `location.state?.category` changes, controller normalizes it based on `user?.is_admin`, then updates:
- `selectedCategory`
- resets `selectedContentItem` to `null`
- Prepares `sidebarItems` for the current role so the sidebar view does not need role logic
- When `user?.is_admin` changes (e.g. auth refresh), controller re-normalizes the category derived from route state.

### 2.6 Error Handling

- No network calls are made by this hook.
- Invalid/unknown route category values fall back to `DEFAULT_MY_PAGE_CATEGORY` only for:
- missing category id
- legacy `admin` mapping
- admin-only categories for non-admin users
- Unknown category ids are preserved (no category highlighting) to match existing UI edge-case behavior.

### 2.7 Verification Scenarios

- Initial state:
- `location.state?.category` initializes `selectedCategory`
- legacy `admin` maps to `admin-users` for admins and to default for non-admins
- Category selection:
- calling `onSelectCategory('sharing')` resets `selectedContentItem` to `null`
- when `isMobile` is true, selecting a category closes the drawer
- Content item selection:
- calling `onSelectContentItem(null)` returns to list view (for multi-item categories)
- calling `onSelectContentItem('inbox')` switches to detail view
- Navigation:
- calling `onCloseMyPage()` navigates to `/`

### 2.8 Edge Cases

- `user` is `null` during auth resolution: hook returns `user: null`; caller may render loading/empty state.
- `location.state` is missing: controller uses `DEFAULT_MY_PAGE_CATEGORY`.
- Unknown `selectedCategory` values: views render with no item highlighted (no crash).

---

## 3. AI-platform registry additions (AI platform)

Addendum to §2.3/§2.4: three `myPageRegistry` categories flow through the existing pipeline unchanged (`resolveMyPageCategory`, `getMyPageSidebarCategories`, admin normalization; no new controller state). Entry shape per CODING_STYLE.md Express Patterns / `StorageDashboard.md` §2.5:

| Category                    | Entry                                                                                             | Visibility | Content                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------- |
| `collections` (Collections) | `{ id: 'collections', icon, labelKey: 'mypage.collectionsOverview', visibility: 'nonAdminOnly' }` | Non-admins | Direct → `CollectionsOverview`.                                      |
| `storage` (Storage)         | `{ id: 'storage', icon, labelKey: 'mypage.storage', visibility: 'nonAdminOnly' }`                 | Non-admins | Direct → `StorageDashboard`.                                         |
| AI-ops (admin)              | `{ id: 'admin-ai', icon, labelKey: 'mypage.adminAiOps', visibility: 'adminOnly' }`                | Admin only | Direct → `AiAdminContent`; regular users: row ABSENT (not disabled). |

- **No sidebar status chip.** The sidebar is a pure view with no chip renderer and this controller performs no network reads (§2.4). The five-state `ai.<role>` display stays in `SystemSettingsContent`; the AI panel renders the fuller operations readiness inside its content.
- Deep-link bootstrapping (`location.state.category`) accepts `collections`, `storage` and `admin-ai`; admin-only normalization falls back to the default category for non-admins, legacy `admin` still maps to `admin-users`.
- Operator rule (admin is a pure operator): both `collections` and `storage` deep-links fall back to the default section for admins (`resolveMyPageCategory` normalization, mirroring the `sharing` precedent) — the personal surfaces are hidden / never invoked for admin.
