# shareLinkStore Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Share links: create, get, update, delete. Stored as JSON under /.wea/share-links/{token}.json. Supports expiration and download count. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/store/shareLinkStore.js`
- **Test file:** `server/store/__tests__/shareLinkStore.test.js`

### 2.2 Main Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| createShareLink | (linkData) => Promise\<object\> | Create link; token provided by caller |
| getShareLink | (token) => Promise\<object \| null\> | Fetch by token |
| getUserShareLinks | (userId) => Promise\<Array\> | All links by createdBy |
| updateShareLink | (token, updates) => Promise\<object\> | Partial update; throws 404 if not found |
| deleteShareLink | (token) => Promise\<void\> | Remove file |
| incrementDownloadCount | (token) => Promise\<object\> | Increment downloadCount |
| isLinkExpired | (link) => boolean | Check expiresAt vs now |

### 2.3 Storage Paths

- `/.wea/share-links/{token}.json`
- Link shape: token, filePath, createdBy, createdAt, expiresAt, downloadCount

### 2.4 Dependencies

- storage (ensureDirSafe, exists, readFile, writeFile, deletePath, listDir)
- metaPaths.normalizeWebdavPath
- errorHandler, SERVER_ERROR_CODES

### 2.5 Verification Scenarios

- [ ] createShareLink writes JSON; existing token returns existing link
- [ ] getShareLink returns link or null (ENOENT → null)
- [ ] getUserShareLinks filters by createdBy, sorts by createdAt desc
- [ ] updateShareLink merges updates; 404 when not found
- [ ] isLinkExpired: no expiresAt → false; past date → true
