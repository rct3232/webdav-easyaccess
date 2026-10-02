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

## 3. AI-platform registry additions (AI platform; P0/P4 as noted)

Addendum to §2.3/§2.4: two new `myPageRegistry` categories flow through the existing pipeline unchanged (`resolveMyPageCategory`, `getMyPageSidebarCategories`, admin normalization; no new controller state). Entry shape per CODING_STYLE.md Express Patterns / `CollectionDashboard.md` §2.5:

| Category            | Entry                                                                                      | Visibility | Content                                                                              |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------ |
| `storage` (Storage) | `{ id: 'storage', icon, labelKey: 'mypage.storage', visibility: 'nonAdminOnly' }`          | Non-admins | Direct → `CollectionDashboard`.                                                      |
| AI-ops (admin)      | `{ id: 'admin-ai', icon, labelKey: 'mypage.adminAiOps', visibility: 'admin', statusChip }` | Admin only | Direct → admin AI governance panel; regular users: row ABSENT (not disabled, §4.12). |

- **`statusChip`:** plain serializable `{ labelKey, tone }` produced by a registry helper from `settings/public.ai` flags + admin `GET /api/admin/health` — 4 states `not_configured | probe_failed(reason) | partial | ok` (per-role); no JSX in registry data, sidebar renders it. Data re-read via the existing MyPage settings seam; no fetch inside this controller (§2.4 "no network calls" preserved — inputs are props/service results).
- Deep-link bootstrapping (`location.state.category`) accepts the two new ids; legacy/unknown handling (§2.6) unchanged.
- Operator rule (admin is a pure operator — PLAN §14 client half): the `storage` deep-link falls back to the default section for admins (`resolveMyPageCategory` normalization, mirroring the `sharing` precedent) — the dashboard is hidden / never invoked for admin.
