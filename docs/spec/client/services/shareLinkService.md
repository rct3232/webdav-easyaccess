# shareLinkService Spec

## 1. Overview

| Item | Description                                                                                     |
| ---- | ----------------------------------------------------------------------------------------------- |
| Role | Share links CRUD (create, list, get, update, delete), public info, check/add-to-my-permissions. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/shareLinkService.js`
- **Test file:** `client/src/services/__tests__/shareLinkService.test.js`

### 2.2 Main Functions

| Function                    | Input                        | Return                                         | API called                                   |
| --------------------------- | ---------------------------- | ---------------------------------------------- | -------------------------------------------- |
| createShareLink             | (fileNodeId, expiresInDays?) | Promise\<Object\>                              | POST /api/share-links                        |
| getShareLinks               | ()                           | Promise\<Array\>                               | GET /api/share-links                         |
| getShareLink                | (token)                      | Promise\<Object\>                              | GET /api/share-links/:token                  |
| updateShareLink             | (token, updates)             | Promise\<Object\>                              | PUT /api/share-links/:token                  |
| deleteShareLink             | (token)                      | Promise\<void\>                                | DELETE /api/share-links/:token               |
| getShareLinkUrl             | (token)                      | string                                         | Client-side URL: origin + /share/:token      |
| getPublicShareLinkInfo      | (token)                      | Promise\<Object\>                              | GET /api/share/:token/info (fetch, no auth)  |
| checkMyPermissionForShare   | (token)                      | Promise\<{ hasSufficientPermission } \| null\> | GET /api/share/:token/check-my-permission    |
| addShareLinkToMyPermissions | (token)                      | Promise\<{ message }>                          | POST /api/share/:token/add-to-my-permissions |

Wire contract:

- `createShareLink(fileNodeId, expiresInDays?)` posts `{ fileNodeId, expiresInDays }` to `POST /api/share-links`.
- `getPublicShareLinkInfo(token)` returns `{ token, nodeId, fileName, fileType, isDirectory, displayPath, createdAt, expiresAt, downloadCount }`. The response always carries `nodeId`, which the folder tree uses as `shareRootNodeId`.

### 2.3 Error Handling

- getPublicShareLinkInfo uses fetch; throws with err.response.data for errorCode
- Other methods via apiClient; errors propagated for getServerErrorDisplay
- `checkMyPermissionForShare` may resolve `null` when the underlying excluded `401` request is skipped by auth policy.

### 2.4 Verification Scenarios

- [ ] createShareLink(fileNodeId, expiresInDays) sends `{ fileNodeId, expiresInDays }` and returns link object
- [ ] getShareLinkUrl returns correct URL
- [ ] getPublicShareLinkInfo works without auth
- [ ] checkMyPermissionForShare, addShareLinkToMyPermissions require auth
- [ ] checkMyPermissionForShare forwards `null` when auth policy skips the excluded `401` request
