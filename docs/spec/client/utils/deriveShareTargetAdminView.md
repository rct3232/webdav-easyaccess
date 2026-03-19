# deriveShareTargetAdminView Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Pure helper that shapes admin-side user search and permission response data for `ShareTargetDialog` so the dialog stays focused on composition and save wiring. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/deriveShareTargetAdminView.js`
- **Test file:** `client/src/utils/__tests__/deriveShareTargetAdminView.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| `buildShareTargetAccessList` | `({ permissions, isDirectory }) => Array<accessEntry>` |
| `filterShareTargetUsers` | `({ users, searchQuery }) => Array<user>` |
| `sortShareTargetAccessList` | `(accessList) => Array<accessEntry>` |

### 2.3 Dependencies

- `PERMISSIONS`

### 2.4 Verification Scenarios

- [ ] Gateway permission results are mapped into the expected access-list shape for folders and files
- [ ] Admin entries are excluded from the editable access list
- [ ] Search filtering matches username and email case-insensitively
- [ ] Sorted access entries preserve the current visible ordering rules used by the dialog
