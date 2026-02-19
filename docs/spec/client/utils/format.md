# format Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Locale-aware formatting for file size (formatFileSize), date-time (formatDate), and date-only (formatDateOnly). Uses i18n.language to choose en-US or ko-KR. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/format.js`
- **Test file:** `client/src/utils/__tests__/format.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| formatFileSize | (bytes) => string (e.g. '1.5 MB') |
| formatDate | (dateString) => string (locale date-time; '-' if empty) |
| formatDateOnly | (dateString) => string (locale date only) |

### 2.3 Dependencies

- `client/src/i18n` (i18n.language for getLocale)
- getLocale: en* → en-US, else ko-KR

### 2.4 Verification Scenarios

- [ ] formatFileSize: 0 → '0 B'; 1024 → '1 KB'; 1536 → '1.5 KB'
- [ ] formatDate: valid ISO string → localized date-time; null/empty → '-'
- [ ] formatDateOnly: valid ISO → date string; null/empty → ''
- [ ] Invalid date string → passthrough (dateString or String(dateString))

### 2.5 Edge Cases

- bytes null/undefined → '0 B'
- Invalid date throws → fallback to input
