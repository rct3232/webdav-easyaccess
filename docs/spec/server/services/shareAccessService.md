# shareAccessService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Public share access service. Resolves share tokens to nodes, serves public metadata, checks/adds user permissions on shared content, and streams preview/download blobs. All operations are nodeId-based. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/domains/sharing/services/shareAccessService.js`
- **Test file:** `server/domains/sharing/services/__tests__/shareAccessService.test.js`

### 2.2 Factory Function Signature

```js
function createShareAccessService({ shareLinkService, fileNodeService, blobStorageService, permissionStore, ownerNodeResolver }) {
  return {
    resolveShareLink(token),
    getShareLinkMetadata(token),
    checkUserSharePermission(token, userId),
    addToMyPermissions(token, userId),
    previewFile(token),
    downloadFile(token)
  };
}
```

### 2.3 Methods

#### `resolveShareLink(token)`

Validates token existence and expiration; returns the share link record. Throws a share-not-found or expired-link error (403/404) for invalid or expired tokens.

#### `getShareLinkMetadata(token)`

Returns public share metadata for the info endpoint.

**Returns:** `{ token, nodeId, fileName, fileType, isDirectory, displayPath, createdAt, expiresAt, downloadCount, isExpired }`

- `nodeId` and `displayPath` come from the shared node; `displayPath` resolved via `fileNodeService.getNodePath(nodeId)`.
- Node name (`fileName`) and type derived from `file_nodes` via `fileNodeService.getNode(nodeId)`.

#### `checkUserSharePermission(token, userId)`

Determines whether the user has sufficient READ access across the shared scope.

- Uses a closure-table descendant query via `fileNodeService.getDescendantIds(nodeId)` instead of walking path strings.
- **Returns:** `{ hasSufficientPermission, nodeId? }` — `nodeId` is the first missing node id; `null` (absent) when permission is sufficient.

#### `addToMyPermissions(token, userId)`

Grants the current user READ access on the shared node.

- Ownership guard via `ownerNodeResolver.isOwnerNode(userId, nodeId)`; own content is already accessible and is not re-granted.
- Directory share: grants via `permissionStore.grant(userId, nodeId, READ)`.
- File share: grants via `permissionStore.grantFilePermission(userId, nodeId, READ)`.

#### `previewFile(token)` / `downloadFile(token)`

Serves the shared file content.

- Resolves the shared node via `fileNodeService.getNode(nodeId)`.
- Downloads bytes via `blobStorageService.downloadBlob(nodeId)`.
- `fileName` taken from `node.name`; `previewFile` additionally returns `contentType` and streams inline (chunked response).
- `downloadFile` increments the link's `downloadCount`.

### 2.4 Dependencies

- `shareLinkService` — link lookup, expiration, download counting
- `fileNodeService` — `getNode(nodeId)`, `getNodePath(nodeId)`, `getDescendantIds(nodeId)`
- `blobStorageService` — `downloadBlob(fileNodeId)`
- `permissionStore` — `grant(userId, nodeId, permission)`, `grantFilePermission(userId, fileNodeId, permission)`
- `ownerNodeResolver` — `isOwnerNode(userId, nodeId)`

### 2.5 Error Cases

- Invalid or expired token → share-not-found / expired error (403/404) for info, preview, download
- Node missing after token resolution → not found (404)
- `downloadBlob` returning no buffer → blob error

### 2.6 Verification Scenarios

- [ ] resolveShareLink returns link for valid token; error for invalid/expired token
- [ ] getShareLinkMetadata returns nodeId, displayPath, fileName, fileType, isDirectory
- [ ] checkUserSharePermission uses getDescendantIds; returns first missing nodeId, null when sufficient
- [ ] addToMyPermissions grants READ on directory via permissionStore.grant
- [ ] addToMyPermissions grants READ on file via permissionStore.grantFilePermission
- [ ] addToMyPermissions skips re-grant when user is owner (isOwnerNode)
- [ ] previewFile/downloadFile resolve node and stream via blobStorageService.downloadBlob
- [ ] downloadFile increments download count
