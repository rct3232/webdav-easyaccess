# FAB Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Floating Action Button: SpeedDial for create folder and upload. shareLinkMode: single Fab for login or add-to-shared. Shown on all viewports (mobile and desktop). Hidden when no write permission. |
| Used in | FileManager |
| Related components | MUI Fab, SpeedDial, SpeedDialAction |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/FAB.js`
- **Test file:** `client/src/components/file-manager/__tests__/FAB.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| onUpload | function | N | - | Upload handler |
| onCreateFolder | function | N | - | Create folder handler |
| hasWritePermission | boolean | N | true | Write permission |
| disabled | boolean | N | false | Disable Fab |
| shareLinkMode | object | N | - | { user, onLoginClick, onAddToSharedClick } |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| onUpload | Upload action | - |
| onCreateFolder | Create folder action | - |
| shareLinkMode.onLoginClick | Login (when not logged in) | - |
| shareLinkMode.onAddToSharedClick | Add to shared (when logged in) | - |

### 2.4 Dependencies

- **imports:** MUI Fab, SpeedDial, SpeedDialAction, SpeedDialIcon
- **Reference implementation:** `client/src/components/file-manager/FAB.js`

### 2.5 i18n Keys

- `fileManager.createFolder`, `fileManager.uploadFile`, `fileManager.fileActions`, `nav.addToShared`, `nav.login`

### 2.6 Conditional Rendering

- shareLinkMode: single Fab (Login or AddLink icon)
- Default: SpeedDial with create folder, upload (filtered by hasWritePermission)
- Returns null when !hasWritePermission or actions.length === 0
- E2E selector contract:
  - the SpeedDial root exposes a stable `data-testid` for opening file actions without relying on localized tooltip text
  - once the SpeedDial is open, flow tests may target the visible create-folder and upload entries through their rendered `menuitem` accessible names when that surface is stable
  - any action-root `data-testid` values are a secondary seam and should not replace `data-file-path` for file items

### 2.7 Verification Scenarios

- [ ] SpeedDial actions: create folder, upload
- [ ] shareLinkMode: login vs add-to-shared
- [ ] Returns null when no write permission
- [ ] disabled disables Fab

### 2.8 Edge Cases

- Safe area inset for iOS
- **PC: Click-to-open only** — On desktop, the SpeedDial opens only on click (reason `'toggle'`). Hover (`'mouseEnter'`) and focus triggers are ignored to prevent unintended opens and flaky test behavior.
- mobile trigger taps must open the controlled SpeedDial through the trigger click path; do not rely on hover/focus-only transitions
- tabIndex=-1 on Fab
