# clipboard Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Cross-context clipboard utility. Attempts `navigator.clipboard.writeText` first; falls back to `document.execCommand('copy')` for HTTP (non-secure) environments. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/clipboard.js`
- **Test file:** `client/src/utils/__tests__/clipboard.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `copyToClipboard` | `(text: string) => Promise<void>` — resolves on success, throws on failure |

### 2.3 Dependencies

- Browser APIs: `navigator.clipboard`, `document.execCommand`

### 2.4 Behavior

1. If `navigator.clipboard?.writeText` is available, call it first.
2. If it throws or is unavailable, fall back to creating a hidden `<textarea>`, selecting its content, and calling `document.execCommand('copy')`.
3. If `execCommand` returns `false`, throw an error.

### 2.5 Verification Scenarios

- [ ] Copies successfully via `navigator.clipboard.writeText` in secure context
- [ ] Falls back to `execCommand` when `navigator.clipboard` is unavailable
- [ ] Falls back to `execCommand` when `navigator.clipboard.writeText` throws
- [ ] Throws when both methods fail
- [ ] Throws when input is not a string
