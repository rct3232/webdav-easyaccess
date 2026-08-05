# shareManageMessageUtils Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Reusable helper for `useSharedManage` message composition and hide-duration policy so success/error feedback does not live as duplicated hook-local branching. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/shareManageMessageUtils.js`
- **Test file:** `client/src/utils/__tests__/shareManageMessageUtils.test.js`

### 2.2 Function Signatures

> **Phase 4 nodeId end-state** (pending implementation in C2.x): `buildShareManageSuccessMessage` uses `targetNodeId` instead of `targetPath`. The current source still accepts `targetPath`; that is transitional and is replaced below.

| Function | (input) => return |
|----------|-------------------|
| `buildShareManageSuccessMessage` | `({ kind, permission, displayName, isDirectory, targetNodeId, t }) => { show, text, type }` |
| `buildShareManageErrorMessage` | `({ error, fallbackKey, t }) => { show, text, type }` |
| `getShareManageHideDuration` | `(type) => number` |
| `HIDDEN_SHARE_MANAGE_MESSAGE` | hidden message payload |

### 2.3 Dependencies

- `PERMISSIONS`
- `getServerErrorDisplay`

### 2.4 Verification Scenarios

- [ ] Request, cancel, and revoke success messages keep their existing observable text and success type
- [ ] Error messages prefer server-provided display text and fall back to the expected translation key
- [ ] Success hide duration remains shorter than error hide duration
- [ ] Hidden payload preserves the existing cleared-message shape expected by callers
