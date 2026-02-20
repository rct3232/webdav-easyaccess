# permissions routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/permissions` |
| Role | Folder and file permissions: grant, revoke, list by user/folder, check effective permission. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/permissions.js`
- **Test file:** `server/routes/__tests__/permissions.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/grant` | Token | Grant permission. Body: folderPath, userId, permission, target? |
| DELETE | `/revoke` | Token | Revoke. Query: userId, folderPath, includeSubfolders?, scope? |
| GET | `/user/:userId` | Token | List permissions for user. |
| GET | `/folder` | Token | List permissions for folder. Query: path, includeSubfolders, filePath? |
| GET | `/check` | Token | Check current user permission. Query: path. |
| POST | `/file/grant` | Token | Grant file-level permission. |
| DELETE | `/file/revoke` | Token | Revoke file-level permission. |
| PATCH | `/file` | Token | Update file-level permission. |
| GET | `/file/check` | Token | Check file permission. |
| GET | `/file/list` | Token | List file permissions. |

### 2.3 Middleware Used

- `authenticateToken`, `requireUser`, `normalizePathParam`

### 2.4 Request/Response Spec

- grant: body folderPath, userId, permission; optional target ('file')
- revoke: query userId, folderPath; optional scope ('pathOnly') for file
- check: returns hasRead, hasWrite, source

### 2.4.1 Validation

- grant: folderPath, userId, permission 필수; 없으면 400
- check: path 필수; 없으면 400
- grant 자기 자신: 허용 (no-op에 가깝거나 동일 권한)

### 2.5 Related Documents

- [api.md](../../../api.md)

### 2.6 Integration Test Scenarios

- [ ] Grant/revoke require ownership or admin
- [ ] Check returns correct hasRead, hasWrite
- [ ] grant folderPath/userId 누락 → 400
- [ ] check path 누락 → 400
- [ ] revoke 직후 check → 권한 즉시 제거
