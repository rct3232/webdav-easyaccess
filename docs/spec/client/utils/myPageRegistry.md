# MyPage Registry Spec

## 1. Overview

| Item | Description                                                                  |
| ---- | ---------------------------------------------------------------------------- |
| Role | Pure MyPage category registry + normalization helpers (ids/icons/visibility) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/myPageRegistry.js`
- **Test file:** `client/src/utils/__tests__/myPageRegistry.test.js`

### 2.2 Function Signatures

| Function                                     | (input) => return                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------- |
| `resolveMyPageCategory(categoryId, isAdmin)` | `(string \| undefined, boolean) => string`                                        |
| `getMyPageSidebarCategories(isAdmin)`        | `(boolean) => Array<{ id: string, icon: React.ComponentType, labelKey: string }>` |
| `getMyPageContentDescriptor(input)`          | `(object) => { categoryIcon, onBack, ContentComponent, contentProps }`            |

Module-private helpers: `isMyPageMultiCategory` / `getMyPageCategoryIcon` (and the `MY_PAGE_MULTI_CATEGORIES` list) — used only by `getMyPageContentDescriptor`; their behavior is verified through the descriptor's `onBack`/`categoryIcon` outputs.

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
- `getMyPageContentDescriptor`:
  - returns the expected content component and props for each supported category
  - includes `onBack` only for multi-item detail state
  - returns a safe empty descriptor for unknown categories
