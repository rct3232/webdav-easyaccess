# normalizePathParam Spec

> **⚠ DEPRECATED** — This middleware (`server/middleware/normalizePathParam.js`) and its test have been deleted as part of Phase 4 Wave 3 integration. Routes now accept `nodeId` exclusively with no path-based fallback (PLAN.md Rule 13). This spec is retained for historical reference only.

## 1. Overview

| Item                 | Description                                               |
| -------------------- | --------------------------------------------------------- |
| Role                 | Normalize path params in req.query, req.body, req.params. |
| Pipeline position    | Before route handlers                                     |
| Preceding middleware | body-parser (for req.body)                                |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/normalizePathParam.js`
- **Test file:** `server/middleware/__tests__/normalizePathParam.test.js`

### 2.2 Input Conditions

- req.query.path, req.body.path, req.body.sourcePath, req.body.destinationPath
- req.body.oldPath, req.body.folderPath, req.query.folderPath

### 2.3 Side Effects

- Mutates req.query.path, req.body.path, etc. with normalizePath result
- Always calls next()

### 2.4 Error Cases

- None

### 2.5 Mock Targets

- shared pathUtils.normalizePath

### 2.6 Verification Scenarios

- [ ] next() called
- [ ] Paths normalized
- [ ] All path fields covered
