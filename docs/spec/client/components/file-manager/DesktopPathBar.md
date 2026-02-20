# DesktopPathBar Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | *(Deprecated in FileManager)* Presentational bar: single button with label and optional icon. Previously used for share-link root, home, shared, recent, parent navigation. Replaced by Breadcrumb on all viewports. FileManager no longer renders this. |
| Used in | FileManager |
| Related components | MUI Box, Button |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/DesktopPathBar.js`
- **Test file:** `client/src/components/file-manager/__tests__/DesktopPathBar.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| label | string | Y | - | Button label |
| startIcon | ReactNode | N | - | Button start icon |
| disabled | boolean | N | - | Button disabled |
| onClick | function | N | - | Click handler |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onClick | Button click | - |

### 2.4 Dependencies

- **imports:** React, MUI Box, Button
- **Reference implementation:** `client/src/components/file-manager/DesktopPathBar.js`

### 2.5 i18n Keys

- None (label passed as prop)

### 2.6 Conditional Rendering

- startIcon optional
- disabled, onClick optional

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Renders label and optional startIcon
- [ ] onClick called on click
- [ ] disabled state

### 2.8 Edge Cases

- No onClick – button may be non-interactive when disabled
