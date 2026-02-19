# metaPathGuard Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Guard meta paths (/.wea): block non-admin. For share context: block meta and paths outside share root. |
| Pipeline position | After requireUser / requireAuth |
| Preceding middleware | authenticateTokenOrShare, requireAuth |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/middleware/metaPathGuard.js`
- **Test file:** `server/middleware/__tests__/metaPathGuard.test.js`

### 2.2 Input Conditions

- req.user (full or minimal)
- req.shareContext (share mode)
- req.query.path, req.body.path, req.params.path, req.body.sourcePath, req.body.destinationPath, req.body.paths

### 2.3 Side Effects

- forbiddenError when meta path + !admin
- Share context: isPathUnder check

### 2.4 Error Cases

| Condition | Behavior |
|-----------|----------|
| Meta path, non-admin | forbiddenError, 403 |
| Share: path outside root | forbiddenError, 403 |
| Admin or valid path | next() |

### 2.5 Mock Targets

- isMetaPath, isPathUnder

### 2.6 Verification Scenarios

- [ ] next() when admin
- [ ] 403 when meta + non-admin
- [ ] checkMetaPath factory
- [ ] Share context path check
