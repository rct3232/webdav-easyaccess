# ShareLink Model Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Share link model: create (generates token), findByToken, findByUserId, update, delete, incrementDownloadCount, isExpired. Wraps shareLinkStore. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/models/ShareLink.js`
- **Test file:** `server/models/__tests__/ShareLink.test.js`

### 2.2 Static Methods

| Method | Signature | Description |
|--------|-----------|-------------|
| create | (fileNodeId, createdBy, expiresInDays?) => Promise\<object\> | Generate token (crypto.randomBytes), shareLinkStore.createShareLink |
| findByToken | (token) => Promise\<object \| null\> | shareLinkStore.getShareLink |
| findByUserId | (userId) => Promise\<Array\> | shareLinkStore.getUserShareLinks |
| update | (token, updates) => Promise\<object\> | shareLinkStore.updateShareLink |
| delete | (token) => Promise\<void\> | shareLinkStore.deleteShareLink |
| incrementDownloadCount | (token) => Promise\<object\> | shareLinkStore.incrementDownloadCount |
| isExpired | (link) => boolean | shareLinkStore.isLinkExpired |

### 2.3 Dependencies

- shareLinkStore
- crypto (randomBytes, base64url token)

### 2.4 Verification Scenarios

- [ ] create generates unique token; passes fileNodeId to store
- [ ] findByToken, findByUserId, update, delete delegate correctly
- [ ] isExpired delegates to store
