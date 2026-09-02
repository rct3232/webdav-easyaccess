# MainLayout Spec

## 1. Overview

| Item               | Description                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Role               | Global layout: fixed app bar gradient background, Outlet for page content. Preserves gradient animation across page navigation. |
| Used in            | App routing                                                                                                                     |
| Related components | Outlet (react-router-dom)                                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/layout/MainLayout.js`
- **Test file:** `client/src/components/layout/__tests__/MainLayout.test.js`

### 2.2 Props

| Name | Type | Required | Default | Description |
| ---- | ---- | -------- | ------- | ----------- |
| None | -    | -        | -       | No props    |

### 2.3 Callback Signatures

None.

### 2.4 Dependencies

- **imports:** Outlet, Box
- **Reference implementation:** `client/src/components/layout/MainLayout.js`

### 2.5 i18n Keys

- None

### 2.6 Conditional Rendering

- Fixed gradient box (dynamic-appbar-gradient, gradient-bg-green)
- Outlet for nested routes
- Height: xs 56, sm 64
- zIndex: appBar - 1

### 2.7 Verification Scenarios

- [ ] Renders Outlet
- [ ] Gradient background box
- [ ] Layout structure

### 2.8 Edge Cases

- pointerEvents: none on gradient
