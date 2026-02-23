# FileManagerHeader Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Sticky header with logo and mypage. Search bar is in FloatingSearchBar (bottom, left of FAB). Logout is shown only on MyPage AppBar. |
| Used in | FileManager |
| Related components | MUI AppBar, Toolbar, Box, IconButton; FloatingSearchBar |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileManagerHeader.js`
- **Test file:** `client/src/components/file-manager/__tests__/FileManagerHeader.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| isMobile | boolean | Y | - | Mobile layout |
| user | object | N | - | User |
| navigate | function | Y | - | Navigation (mypage) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| navigate | MyPage click | (path) |

### 2.4 Dependencies

- **imports:** React, useTranslation, MUI AppBar/Toolbar/Box/IconButton, Person icon
- **Reference implementation:** `client/src/components/file-manager/FileManagerHeader.js`

### 2.5 i18n Keys

- `nav.logoAlt` – logo alt text
- `nav.mypage` – mypage link title

### 2.6 Layout and Slot

- Toolbar layout: Logo | `#file-progress-slot` (flexGrow: 1, flex-end) | Person icon
- The slot (`id="file-progress-slot"`) is used by FileOperationProgress to portal the shrink chip when progress items exist. Do not remove this slot.

### 2.7 Conditional Rendering

- Logo size: mobile 27px, desktop 33.75px

### 2.8 Verification Scenarios

- [ ] Logo, mypage render
- [ ] navigate('/mypage')
- [ ] #file-progress-slot present in Toolbar
