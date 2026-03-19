# MyPageContentArea Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Selects and renders the correct content panel based on `selectedCategory` and `selectedContentItem`. Handles List, Detail, and Direct content patterns. Content is displayed within MyPageContentPanel's centered, max-width layout. |
| Used in | MyPage |
| Related components | MyPageContentPanel, PageHeaderContext, AccountContent, SharingContent, UserManagementContent, SystemSettingsContent, PreferencesContent |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/MyPageContentArea.js`
- **Test file:** `client/src/components/mypage/__tests__/MyPageContentArea.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| selectedCategory | string | Y | - | Current category id ('account', 'sharing', 'admin-users', 'admin-settings', 'preferences') |
| selectedContentItem | string \| null | Y | - | For multi-item categories: null = list view, non-null = detail view (e.g. 'inbox', 'outbox', 'links') |
| onSelectContentItem | function | Y | - | Handler to switch between list and detail; pass `null` to return to list |
| user | object | Y | - | Current user; passed to content components |
| onMessage | function | N | - | Message handler (type, text) for child content feedback |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onSelectContentItem | User selects a sub-item or taps Back | (itemId \| null) – item id for detail, or null to show list |

### 2.4 Dependencies

- **imports:** MyPageContentPanel and MyPage registry helpers/constants (category icons, multi-category ids, and content render-model helpers)
- **Reference implementation:** `client/src/components/mypage/MyPageContentArea.js`
- **Must not own:** inline category-to-content dispatch trees

### 2.5 Header Content

- Header title and action buttons come from child content via PageHeaderContext. Each content component uses `usePageHeader()` to set its title and actions (e.g. Add, Save, Edit). No props passed from MyPageContentArea.

### 2.6 i18n Keys

- Delegated to child content components (AccountContent, SharingContent, UserManagementContent, SystemSettingsContent, PreferencesContent).

### 2.7 Conditional Rendering

- **Single-item categories (Account, Preferences):** Direct content. Render MyPageContentPanel with content; no Back button; pass `categoryIcon` for the current category.
- **Multi-item + selectedContentItem null:** List view. Render MyPageContentPanel with List component (e.g. SharingContent list); pass `categoryIcon`.
- **Multi-item + selectedContentItem non-null:** Detail view. Render MyPageContentPanel with `onBack` that calls `onSelectContentItem(null)`, no `categoryIcon`; Back button shown.

Mapping:
- `account` → AccountContent (direct)
- `preferences` → PreferencesContent (direct)
- `sharing` + null → SharingContent list
- `sharing` + 'inbox'|'outbox'|'links' → SharingContent detail
- `admin-users` → UserManagementContent (direct)
- `admin-settings` → SystemSettingsContent (direct)

The above mapping is produced by the MyPage registry/helper layer and consumed by the view. `MyPageContentArea` should render the prepared descriptor rather than embedding category `if` chains.

### 2.8 Verification Scenarios

- [x] Renders correct Content for selectedCategory (Account, Sharing, User Management, System Settings, Preferences)
- [x] Single-item categories show content directly, no list
- [x] Multi-item categories: null selectedContentItem shows list
- [x] Multi-item: non-null selectedContentItem shows detail with Back button
- [x] Back button calls onSelectContentItem(null)
- [x] List item click calls onSelectContentItem(itemId)

### 2.9 Edge Cases

- Unknown `selectedCategory` – render empty or fallback content.
- `selectedContentItem` non-null for single-item category – ignore; show direct content.
- `selectedContentItem` value not in category’s sub-items – render detail if valid, otherwise list.
