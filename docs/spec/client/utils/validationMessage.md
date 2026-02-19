# validationMessage Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Resolve validation result (from shared/validation) to a translated message. Supports key string or { key, ...params } object. Sets fieldName default from t('validation.field') when missing. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/validationMessage.js`
- **Test file:** `client/src/utils/__tests__/validationMessage.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| getValidationMessage | (result, t) => string \| null |

### 2.3 Input Types

- `null` / `undefined` → null
- `{ key: string, ...params }` → t(key, { ...params, fieldName: params.fieldName ?? t('validation.field') })
- `string` (key) → t(result)

### 2.4 Dependencies

- i18n t function

### 2.5 Verification Scenarios

- [ ] result null/undefined → null
- [ ] result string → t(result)
- [ ] result { key, fieldName } → t(key, params) with fieldName
- [ ] result { key } (no fieldName) → fieldName defaults to t('validation.field')

### 2.6 Edge Cases

- params shallow-copied, fieldName overridden when missing
