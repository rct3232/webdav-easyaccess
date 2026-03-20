# normalizeAuthUser Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that normalizes auth user objects for consistent client-side role checks (e.g. converts `is_admin` to a boolean). |
| Used by | `useAuthSession` (for user values derived from `getMe` and `login`). |
| Does not own | Storage, IO, or side effects. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/normalizeAuthUser.js`
- **Test file:** `client/src/utils/__tests__/normalizeAuthUser.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `normalizeAuthUser` | `(user: object | null | undefined) => object | null` |

Normalization rules:
- Returns `null` when input is null/undefined.
- If input is an object:
  - keeps all fields,
  - normalizes `is_admin` to `Boolean(user.is_admin)`.
- Must not mutate the original input object.

### 2.3 Dependencies

- None (pure function).

### 2.4 Verification Scenarios

- [ ] When `user.is_admin` is falsy, `normalized.is_admin === false`.
- [ ] When `user.is_admin` is truthy, `normalized.is_admin === true`.
- [ ] Returns `null` for null/undefined input.
- [ ] Does not mutate the input object.
