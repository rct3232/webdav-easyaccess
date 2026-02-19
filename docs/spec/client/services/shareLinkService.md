# shareLinkService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Share links CRUD (create, list, get, update, delete), public info, check/add-to-my-permissions. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/shareLinkService.js`
- **Test file:** `client/src/services/__tests__/shareLinkService.test.js`

### 2.2 Main Functions

| Function | Input | Return | API called |
|----------|-------|--------|------------|
| createShareLink | (filePath, expiresInDays?) | Promise\<Object\> | POST /api/share-links |
| getShareLinks | () | Promise\<Array\> | GET /api/share-links |
| getShareLink | (token) | Promise\<Object\> | GET /api/share-links/:token |
| updateShareLink | (token, updates) | Promise\<Object\> | PUT /api/share-links/:token |
| deleteShareLink | (token) | Promise\<void\> | DELETE /api/share-links/:token |
| getShareLinkUrl | (token) | string | Client-side URL: origin + /share/:token |
| getPublicShareLinkInfo | (token) | Promise\<Object\> | GET /api/share/:token/info (fetch, no auth) |
| checkMyPermissionForShare | (token) | Promise\<{ hasSufficientPermission }> | GET /api/share/:token/check-my-permission |
| addShareLinkToMyPermissions | (token) | Promise\<{ message }> | POST /api/share/:token/add-to-my-permissions |

### 2.3 Error Handling

- getPublicShareLinkInfo uses fetch; throws with err.response.data for errorCode
- Other methods via apiClient; errors propagated for getServerErrorDisplay

### 2.4 Verification Scenarios

- [ ] createShareLink returns link object
- [ ] getShareLinkUrl returns correct URL
- [ ] getPublicShareLinkInfo works without auth
- [ ] checkMyPermissionForShare, addShareLinkToMyPermissions require auth
