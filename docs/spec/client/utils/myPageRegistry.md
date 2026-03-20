# MyPage Registry Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure MyPage category registry + normalization helpers (ids/icons/visibility) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/myPageRegistry.js`
- **Test file:** `client/src/utils/__tests__/myPageRegistry.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `resolveMyPageCategory(categoryId, isAdmin)` | `(string \| undefined, boolean) => string` |
| `getMyPageSidebarCategories(isAdmin)` | `(boolean) => Array<{ id: string, icon: React.ComponentType, labelKey: string }>` |
| `isMyPageMultiCategory(categoryId)` | `(string \| undefined) => boolean` |
| `getMyPageCategoryIcon(categoryId)` | `(string \| undefined) => React.ComponentType \| undefined` |
| `getMyPageContentDescriptor(input)` | `(object) => { categoryIcon, onBack, ContentComponent, contentProps }` |

### 2.3 Dependencies

- MUI icons used as category icon components
- Content component references may be resolved here as a deterministic registry/helper concern; no IO or browser access allowed

### 2.4 Verification Scenarios

Unit tests should verify:

- `resolveMyPageCategory`:
  - `undefined`/missing category falls back to `DEFAULT_MY_PAGE_CATEGORY`
  - legacy `admin` maps to `admin-users` for admins and to default for non-admins
  - admin-only categories map back to default when `isAdmin=false`
  - `sharing` maps to default when `isAdmin=true`
  - unknown categories are preserved
- `getMyPageSidebarCategories`:
  - admin-only categories are included only when `isAdmin=true`
  - sharing is included only when `isAdmin=false`
  - always-visible categories are always included
- `isMyPageMultiCategory` and `getMyPageCategoryIcon`:
  - `sharing` is multi-item; other known categories are not
  - icon lookup returns the expected icon component for known categories
- `getMyPageContentDescriptor`:
  - returns the expected content component and props for each supported category
  - includes `onBack` only for multi-item detail state
  - returns a safe empty descriptor for unknown categories

