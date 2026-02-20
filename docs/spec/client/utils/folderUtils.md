# folderUtils Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Folder path utilities: recursively collect folder and all subfolder paths under a given folder. Uses fileService.listFiles. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/folderUtils.js`
- **Test file:** `client/src/utils/__tests__/folderUtils.test.js`

### 2.2 Function Signatures

| Function | (input) => return |
|----------|-------------------|
| collectSubfolderPaths | (folderPath) => Promise<string[]> |

### 2.3 Return Value

- `[folderPath, ...subfolder paths]` – normalized, depth-first traversal

### 2.4 Dependencies

- `pathUtils.normalizePath`
- `listFiles` – imported from `client/src/services/fileService.js` (e.g. `import { listFiles } from '../services/fileService'`). Calls API to list files per path.

### 2.5 Verification Scenarios

- [ ] Returns [folderPath] for leaf folder
- [ ] Returns [folderPath, ...children] for nested structure
- [ ] Paths normalized
- [ ] On listFiles error: logs and skips that branch; continues traverse. **Skips that branch** = does not include the path that failed to list nor its descendants. Only paths we successfully listed are included.

### 2.6 Edge Cases

- Empty listFiles response → dirs=[]
- Traverse catches errors, continues with siblings
- Paths whose listFiles fails → excluded from result (per 2.5)
