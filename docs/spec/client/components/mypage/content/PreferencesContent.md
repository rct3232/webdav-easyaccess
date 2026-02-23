# PreferencesContent Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Language selector (Menu: ko/en). Single-item category content. Moved from AppBar. |
| Used in | MyPageContentArea (when selectedCategory is 'preferences') |
| Related components | i18n, getFlagEmoji utility |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mypage/content/PreferencesContent.js`
- **Test file:** `client/src/components/mypage/content/__tests__/PreferencesContent.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| (minimal) | - | - | - | No required props; can accept optional styling props if needed |

### 2.3 Callback Signatures

None. Language change is handled internally via `i18n.changeLanguage(code)`.

### 2.4 Dependencies

- **imports:** useTranslation, usePageHeader (PageHeaderContext), Box, Typography, IconButton, Menu, MenuItem, getFlagEmoji, i18n
- **Header:** Uses `usePageHeader()` to set title `mypage.preferences`. No action buttons. Resets on unmount.
- **Layout:** Same Box-based flex layout as SystemSettingsContent (title + description left, control right).

### 2.5 i18n Keys

- `mypage.language` – Section/label for language selector
- `mypage.languageDesc` – Description for language setting

### 2.6 Conditional Rendering

- Single row using Box flex layout (mt: 3, display: flex, justifyContent: space-between, alignItems: flex-start).
- Left: Box (flex: 1) with Typography body1 (mypage.language) and Typography body2 (mypage.languageDesc).
- Right: IconButton with current language flag emoji (ml: 2).
- Flag emoji is clickable; opens Menu dropdown with ko, en options.
- Menu items show flag + label; selected state via `i18n.language === code || i18n.language?.startsWith(code)`.
- On select: `i18n.changeLanguage(code)` and close menu.

### 2.7 Verification Scenarios

- [ ] Renders title and description on left, current language flag button on right
- [ ] Clicking flag opens Menu with ko, en
- [ ] Selecting option calls i18n.changeLanguage and closes menu
- [ ] Current language is visually indicated as selected in menu

### 2.8 Edge Cases

- i18n.language is 'ko-KR' – 'ko' option should show as selected (startsWith check).
- Minimal props – component works with no props.
