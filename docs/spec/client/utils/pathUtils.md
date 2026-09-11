# pathUtils Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                                    |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Path utilities: re-export from shared with client-specific options (VIRTUAL_ROOTS); local helper for UI (toFilesPath). Supports virtual roots `/__shared__`, `/__recent__`, `/__trash__`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/pathUtils.js`
- **Test file:** `client/src/utils/__tests__/pathUtils.test.js`

### 2.2 Function Signatures

| Function      | (input) => return                                          |
| ------------- | ---------------------------------------------------------- |
| normalizePath | (path) => string (re-export from shared)                   |
| getParentPath | (path) => string (with treatAsRoot: VIRTUAL_ROOTS)         |
| getBasename   | (path) => string (re-export)                               |
| toFilesPath   | (filePath) => string (e.g. `/files/a/b`)                   |

### 2.3 Dependencies

- `@webdav-easyaccess/shared/pathUtils` (normalizePath, getParentPath, getBasename)
- VIRTUAL_ROOTS: `['/__shared__', '/__recent__', '/__trash__']` (DEF-16 P9: the trash view root
  is a virtual root like `__shared__`/`__recent__` — no FAB, no drag-drop, no folder-level write
  permission; `getParentPath('/__trash__')` resolves to the filesystem root).

### 2.4 Verification Scenarios

- [ ] toFilesPath('/foo') → '/files/foo'; invalid → '/files'
- [ ] getParentPath respects VIRTUAL_ROOTS (parent of /**shared** is root)
- [ ] Empty and boundary inputs handled

### 2.5 Edge Cases

- `path` null/undefined/'' → appropriate fallbacks
- `toFilesPath` with non-string or invalid input → '/files'
