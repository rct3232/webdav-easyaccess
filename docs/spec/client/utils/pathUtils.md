# pathUtils Spec

## 1. Overview

| Item | Description                                                                                                                                                                                                                      |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role | Path utilities: re-export from shared with client-specific options (VIRTUAL_ROOTS); local helpers for UI (getFolderName, getFileName, getPathParts, joinPath, toFilesPath). Supports virtual roots `/__shared__`, `/__recent__`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/utils/pathUtils.js`
- **Test file:** `client/src/utils/__tests__/pathUtils.test.js`

### 2.2 Function Signatures

| Function       | (input) => return                                                       |
| -------------- | ----------------------------------------------------------------------- |
| normalizePath  | (path) => string (re-export from shared)                                |
| getParentPath  | (path) => string (with treatAsRoot: VIRTUAL_ROOTS)                      |
| isRootPath     | (path) => boolean (with VIRTUAL_ROOTS)                                  |
| getBasename    | (path) => string (re-export)                                            |
| getParentPaths | (path) => string[] (re-export)                                          |
| isSubPath      | (child, parent) => boolean (alias of isPathUnder)                       |
| getFolderName  | (path, t?) => string (UI display name; when t provided, uses i18n keys) |
| getFileName    | (path) => string (basename, no i18n)                                    |
| getPathParts   | (path) => string[] (split path segments)                                |
| joinPath       | (...parts) => string (join with leading slash)                          |
| toFilesPath    | (filePath) => string (e.g. `/files/a/b`)                                |

### 2.2.1 getFolderName i18n Keys

When `t` is provided: `/` → `t('nav.root')`, `/__shared__` → `t('nav.shared')`, `/__recent__` → `t('nav.recentShort')`. Fallback when `t` is not a function: `'Root'`, `'Shared'`, `'Recent'`.

### 2.3 Dependencies

- `@webdav-easyaccess/shared/pathUtils` (normalizePath, getParentPath, isRootPath, getBasename, isPathUnder, getParentPaths)
- VIRTUAL_ROOTS: `['/__shared__', '/__recent__']`

### 2.4 Verification Scenarios

- [ ] getFolderName: without t → 'Root', 'Shared', 'Recent' for /, /**shared**, /**recent**; with t → t('nav.root'), t('nav.shared'), t('nav.recentShort')
- [ ] getPathParts('/a/b/c') → ['a','b','c']; empty path → []
- [ ] joinPath('a','b','c') → '/a/b/c'
- [ ] toFilesPath('/foo') → '/files/foo'; invalid → '/files'
- [ ] getParentPath respects VIRTUAL_ROOTS (parent of /**shared** is root)
- [ ] Empty and boundary inputs handled

### 2.5 Edge Cases

- `path` null/undefined/'' → appropriate fallbacks
- `toFilesPath` with non-string or invalid input → '/files'
