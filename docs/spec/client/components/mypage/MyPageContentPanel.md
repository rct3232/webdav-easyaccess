# MyPageContentPanel Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Common wrapper for MyPage content: padding, overflow scroll, centered content with max-width (560px). Unified header row: [Back slot 40px] [Title] [Action buttons]. Back slot: Back button when `onBack` provided (detail view); category icon when not. Title and actions come from child content via PageHeaderContext. |
| Used in | MyPageContentArea (wraps all category content) |
| Related components | MyPageContentArea, PageHeaderContext, content components (AccountContent, SharingContent, etc.) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/MyPageContentPanel.js`
- **Test file:** `client/src/components/mypage/__tests__/MyPageContentPanel.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| children | node | Y | - | Content to render inside the panel |
| onBack | function | N | - | If provided, show Back button at top-left; clicking calls this handler |
| categoryIcon | component | N | - | Icon component to show in back slot when `onBack` is absent (e.g. PersonIcon for account) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onBack | Back button clicked | - |

### 2.4 Dependencies

- **imports:** Box, IconButton, Typography, ArrowBack icon (MUI), PageHeaderContext
- **Reference implementation:** `client/src/components/mypage/MyPageContentPanel.js`

### 2.5 i18n Keys

- `common.back` or equivalent for Back button aria-label (if needed)

### 2.6 Layout

- **Outer container:** Flex column with `flex: 1`, `minHeight: 0`, `p: 3`; no overflow on the outer Box so the header stays fixed.
- **Header row (fixed):** Non-scrollable; always visible at top. Single flex row with `display: flex`, `alignItems: center`, `minHeight: 40`, `mb: 1`, wrapped in centered `maxWidth: 560` box:
  - **Back slot:** Fixed 40x40 area, always reserved. Renders IconButton with ArrowBack when `onBack` provided; when absent, renders `categoryIcon` if provided; otherwise empty.
  - **Title:** Typography variant="h6", flex: 1, minWidth: 0, overflow hidden, value from PageHeaderContext.
  - **Actions:** Box on right, flexShrink: 0, renders actions from PageHeaderContext (e.g. Add, Save, Edit buttons).
- **Content container (scrollable):** Inner content is centered with `maxWidth: 560px`, `width: '100%'`, `margin: '0 auto'`. On narrow viewports, content uses available width with horizontal padding. Only the content area scrolls (`overflow: auto`, `flex: 1`, `minHeight: 0`); the header stays fixed when content overflows.

### 2.7 PageHeaderContext Integration

- Panel provides PageHeaderContext with state `{ title, actions, setTitle, setActions }`.
- Child content components use `usePageHeader()` to register their title and action buttons.
- Components reset title/actions on unmount (useEffect cleanup).

### 2.8 Conditional Rendering

- **onBack provided:** Show Back button (IconButton with ArrowBack) in the reserved back slot.
- **onBack absent, categoryIcon provided:** Show category icon in the back slot.
- **onBack absent, categoryIcon not provided:** Back slot remains empty (40px reserved); title and actions align consistently.
- Always: header row rendered, padding, fixed header, scrollable content area.

### 2.9 Verification Scenarios

- [ ] Renders children
- [ ] When onBack provided: Back button visible at top-left
- [ ] When onBack absent and categoryIcon provided: Category icon visible in back slot
- [ ] Clicking Back button calls onBack
- [ ] Content area is scrollable (overflow)
- [ ] Header stays visible when content scrolls (sticky header)

### 2.10 Edge Cases

- Empty children – panel still renders with correct layout.
- onBack provided but never called – no side effects.
