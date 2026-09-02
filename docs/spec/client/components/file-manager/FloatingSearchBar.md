# FloatingSearchBar Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                         |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Floating search bar positioned to the left of the FAB. Unified behavior for mobile and desktop: always visible, no toggle. Styled with AppBar/FAB-style layered radial + linear gradient outline, pill shape, matte light interior. |
| Used in            | FileManager                                                                                                                                                                                                                         |
| Related components | MUI TextField, InputAdornment, IconButton; FAB                                                                                                                                                                                      |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FloatingSearchBar.js`
- **Test file:** `client/src/components/file-manager/__tests__/FloatingSearchBar.test.js`

### 2.2 Props

| Name           | Type     | Required | Default                    | Description                                                              |
| -------------- | -------- | -------- | -------------------------- | ------------------------------------------------------------------------ |
| searchQuery    | string   | Y        | -                          | Search input value                                                       |
| setSearchQuery | function | Y        | -                          | Set search query                                                         |
| isMobile       | boolean  | Y        | -                          | Mobile layout (affects width)                                            |
| placeholder    | string   | N        | t('nav.searchPlaceholder') | Placeholder text (i18n)                                                  |
| fabVisible     | boolean  | N        | true                       | When false (e.g. selection mode), search bar expands to occupy FAB space |

### 2.3 Callback Signatures

| Callback       | When invoked | Arguments |
| -------------- | ------------ | --------- |
| setSearchQuery | Input change | (string)  |

### 2.4 Layout

- **Position:** `position: fixed`, bottom-aligned with FAB
- **When fabVisible:** Desktop: `width: 300px`, `right: offset + FAB_SIZE + GAP` (116px); Mobile: `left: offset`, `right: offset + FAB_SIZE + GAP` (84px)
- **When !fabVisible:** Search bar expands to occupy FAB space: `right: offset` (16px mobile, 48px desktop)
- **Bottom offset:** Same as FAB (16px mobile, 48px desktop)
- **Z-index:** 1045 (below FAB 1050)
- **Safe area:** `paddingBottom: env(safe-area-inset-bottom)` for iOS

### 2.5 Styling

- **Expand/collapse:** `transition: right 0.25s ease-out` when fabVisible changes
- **Outline:** AppBar/FAB-style layered radial + linear gradient border (same palette as FAB) via CSS mask (gradient only on border, interior cut out)
- **Pill shape:** `borderRadius: 9999px`
- **Interior:** Matte frosted glass `rgba(255,255,255,0.5)` with `backdrop-filter: blur(12px)`

### 2.6 Dependencies

- **imports:** React, useTranslation, MUI TextField, InputAdornment, IconButton, Box; Search, Close icons
- **Reference implementation:** `client/src/components/file-manager/FloatingSearchBar.js`

### 2.7 i18n Keys

- `nav.searchPlaceholder` – search placeholder

### 2.8 Verification Scenarios

- [ ] Renders search input with placeholder
- [ ] setSearchQuery called on input change
- [ ] Clear button appears when searchQuery non-empty; clears on click
- [ ] Desktop: fixed 300px width
- [ ] Mobile: full width between left margin and FAB area

### 2.9 Scroll Padding Coordination

- FileManager scroll container uses `padding-bottom` equal to floating area height (offset + FAB_SIZE) + safe-area when FloatingSearchBar is visible, so the last list item can scroll up above the search bar. See `FLOATING_BOTTOM_HEIGHT_MOBILE` / `FLOATING_BOTTOM_HEIGHT_DESKTOP` in `constants/fileManager.js`.

### 2.10 Edge Cases

- FAB hidden (selection mode): search bar expands to occupy FAB space (right: offset)
- Share link mode: shown whenever FileManager file list is visible
