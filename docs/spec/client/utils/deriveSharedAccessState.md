# deriveSharedAccessState Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that derives UI-ready sharing permission state for `SharedManageDialog` / `SharedPermissionList`. Transforms raw permission check results and optional override flags into the `hasReadPermission`, `hasWritePermission`, `pathPermission`, and `filePermissionLevel` fields expected by the view layer. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/deriveSharedAccessState.js`
- **Test file:** `client/src/utils/__tests__/deriveSharedAccessState.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| deriveSharedAccessState | (params) => derived state object |

**Input parameters**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| isDirectory | boolean | Y | Whether the target is a folder. |
| permissionCheck | object | Y | Result from `checkPermission(targetPath)`. For file targets this includes `source` (`'file'` or `'path'`). For directory targets only `hasRead`/`hasWrite` are used. |
| parentPermissionCheck | object \| null | N | Only used for file targets. Result from `checkPermission(parentPath)` to derive `pathPermission`. |
| directHasReadPermission | boolean \| undefined | N | Optional override for `hasReadPermission` when the caller already knows direct read (e.g. from optimistic state). |
| pendingRequest | object | N | Pending request state (passed-through, not mutated). |
| ownerExists | boolean \| null | N | Owner existence state (passed-through, not mutated). |

**Return value**

| Key | Type | Meaning |
|-----|------|---------|
| hasReadPermission | boolean | Effective read access. Uses `directHasReadPermission` when provided. |
| hasWritePermission | boolean | Effective write access. |
| pathPermission | `'none' \| 'read' \| 'write' \| null` | For file targets: derived from `parentPermissionCheck`. For directory targets: `null`. |
| filePermissionLevel | `'read' \| 'write' \| null` | For file targets: derived from `permissionCheck` when `permissionCheck.source === 'file'`. For directory targets or `source !== 'file'`: `null`. |
| pendingRequest | object | Passed-through from input. |
| ownerExists | boolean \| null | Passed-through from input. |

### 2.3 Dependencies

- None (pure computation only)

### 2.4 Verification Scenarios

- For directory targets:
  - `hasReadPermission` equals (permissionCheck.hasRead, unless overridden by `directHasReadPermission`)
  - `hasWritePermission` equals permissionCheck.hasWrite
  - `pathPermission` is `null` and `filePermissionLevel` is `null`
- For file targets:
  - `hasReadPermission` equals `directHasReadPermission` when provided; otherwise it equals `permissionCheck.hasRead`
  - `pathPermission` derives from `parentPermissionCheck`:
    - parent hasWrite => `write`
    - else parent hasRead => `read`
    - else => `none`
  - `filePermissionLevel`:
    - when permissionCheck.source === `'file'`: permissionCheck.hasWrite => `write` else `read`
    - when permissionCheck.source !== `'file'`: `null`

### 2.5 Edge Cases

- `permissionCheck` missing or missing fields => treat as no access (`hasRead=false`, `hasWrite=false`)
- `parentPermissionCheck === null` for file targets => `pathPermission` becomes `none`
- `directHasReadPermission` explicitly set to `false` must override computed permission read

