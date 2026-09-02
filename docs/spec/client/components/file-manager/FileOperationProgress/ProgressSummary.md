# ProgressSummary Spec

## 1. Overview

| Item               | Description                                                                                                                                                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Compact progress summary chip: shows status icon, primary label, secondary label. Used in shrink state of FileOperationProgress—either in AppBar slot (variant="appbar") or as legacy floating Paper. Click opens the progress drawer. |
| Used in            | FileOperationProgress                                                                                                                                                                                                                  |
| Related components | FileOperationProgress, useResponsive                                                                                                                                                                                                   |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FileOperationProgress/ProgressSummary.js`
- **Test file:** Covered by FileOperationProgress tests (colocated or parent)

### 2.2 Props

| Name             | Type     | Required | Default | Description                                                                                                               |
| ---------------- | -------- | -------- | ------- | ------------------------------------------------------------------------------------------------------------------------- |
| variant          | string   | N        | -       | When `'appbar'`, renders compact chip for AppBar (icon + primary + secondary + chevron). Otherwise legacy floating Paper. |
| onExpand         | function | N        | -       | Click handler (legacy).                                                                                                   |
| onOpenDrawer     | function | N        | -       | Click handler to open drawer; takes precedence over onExpand when present.                                                |
| renderStatusIcon | function | N        | -       | Returns React node for status icon.                                                                                       |
| primaryLabel     | string   | N        | -       | Primary line text (e.g. operation status).                                                                                |
| secondaryLabel   | string   | N        | -       | Secondary line text (e.g. item count or detail).                                                                          |

### 2.3 Callback Signatures

| Callback | When invoked           | Arguments                                 |
| -------- | ---------------------- | ----------------------------------------- |
| (click)  | User clicks chip/Paper | none; handler is onOpenDrawer ?? onExpand |

### 2.4 Dependencies

- **imports:** React, MUI (Box, Paper, Typography, IconButton), ChevronRightIcon, useResponsive (isMobile for legacy layout)
- **Reference implementation:** `client/src/components/file-manager/FileOperationProgress/ProgressSummary.js`

### 2.5 Conditional Rendering

- **variant === 'appbar':** Box as button, compact horizontal layout (icon, labels, chevron), no fixed position.
- **Default:** Fixed-position Paper (bottom-right on desktop, bottom-left on mobile), same content; click opens drawer.

### 2.6 Verification Scenarios

- [ ] Renders status icon, primaryLabel, secondaryLabel.
- [ ] variant="appbar" renders AppBar-style chip; default renders floating Paper.
- [ ] Click invokes onOpenDrawer or onExpand.

### 2.7 Edge Cases

- renderStatusIcon, primaryLabel, secondaryLabel optional; component still renders.
