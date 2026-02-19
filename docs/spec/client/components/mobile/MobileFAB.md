# MobileFAB Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Floating Action Button: SpeedDial for create folder and upload. shareLinkMode: single Fab for login or add-to-shared. Hidden when no write permission. |
| Used in | FileManager |
| Related components | MUI Fab, SpeedDial, SpeedDialAction |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/mobile/MobileFAB.js`
- **Test file:** `client/src/components/__tests__/MobileFAB.test.js`

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
- **Reference implementation:** `client/src/components/mobile/MobileFAB.js`

### 2.5 i18n Keys

- `fileManager.createFolder`, `fileManager.uploadFile`, `fileManager.fileActions`, `nav.addToShared`, `nav.login`

### 2.6 Conditional Rendering

- shareLinkMode: single Fab (Login or AddLink icon)
- Default: SpeedDial with create folder, upload (filtered by hasWritePermission)
- Returns null when !hasWritePermission or actions.length === 0

### 2.7 Verification Scenarios

- [ ] SpeedDial actions: create folder, upload
- [ ] shareLinkMode: login vs add-to-shared
- [ ] Returns null when no write permission
- [ ] disabled disables Fab

### 2.8 Edge Cases

- Safe area inset for iOS
- tabIndex=-1 on Fab
