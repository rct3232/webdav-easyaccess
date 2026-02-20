# [ComponentName] Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | (Component's role, e.g. bulk move/copy/download/delete for selected files) |
| Used in | (e.g. FileManager) |
| Related components | (Other components to reference) |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/{subdir}/[ComponentName].js` (subdir = dialogs, folder-tree, file-manager, layout, mobile, feedback 등 소스 위치)
- **Test file:** `client/src/components/{subdir}/__tests__/[ComponentName].test.js` (소스와 같은 디렉터리 내 `__tests__/`에 colocated)

### 2.2 Props

| Name | Type | Required | Default | Description |
|------|------|----------|---------|-------------|
| (propName) | (type) | Y/N | (default) | (description) |

### 2.3 Callback Signatures

| Callback | When invoked | Arguments |
|----------|--------------|-----------|
| (handleX) | (when it is called) | (argument list) |

### 2.4 Dependencies

- **imports:** useTranslation, MUI components, other libraries
- **Reference implementation:** (related file paths)

### 2.5 i18n Keys

- `(namespace).(key)` – purpose

### 2.6 Conditional Rendering

- Branching by props: (e.g. hide move/copy/delete buttons when `downloadOnly`; disable when `hasWritePermission` is false)

### 2.7 Verification Scenarios

Checklist for unit test writing:

- [ ] Selection count display
- [ ] Callback invocation on button/action click
- [ ] Disabled state based on permissions
- [ ] Other behavior verification

### 2.8 Edge Cases

- `selectedFiles.size === 0` – behavior
- `hasReadOnlyInSelection` – message display
- Other edge cases
