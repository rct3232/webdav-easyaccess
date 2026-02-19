# files routes Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Mount path | `/api/files` |
| Role | File and folder operations: list, download, upload, rename, batch move/copy/delete, metadata, conflicts, thumbnails, bulk job status. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/routes/files.js`
- **Test file:** `server/routes/__tests__/files.test.js`

### 2.2 Route List

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/list` | Token or share | List folder contents. Query: path. |
| GET | `/download` | Token or share | Download file. Query: path. |
| POST | `/upload` | Token | Upload file. Multipart: file, path. |
| PUT | `/rename` | Token | Rename. Body: oldPath, newName. |
| POST | `/batch-move` | Token | Move items. Body: moves, onConflict. |
| POST | `/batch-copy` | Token | Copy items. Body: copies, onConflict. |
| POST | `/batch-delete` | Token | Delete items. Body: paths. |
| POST | `/download-multiple` | Token or share | ZIP multiple files. Body: paths, downloadId. |
| GET | `/download-progress/:id` | Token or share | ZIP download progress. |
| GET | `/operation-progress/:id` | Token | Bulk operation progress. |
| GET | `/bulk-operation/:jobId` | Token | Bulk job status. |
| POST | `/bulk-operation/:jobId/cancel` | Token | Cancel bulk operation. |
| GET | `/thumbnail/:hash` | Token | Single thumbnail image. |
| POST | `/thumbnails/batch` | Token or share | Batch thumbnails. Body: paths. |
| POST | `/check-conflicts` | Token | Check name conflicts. Body: operations. |
| POST | `/metadata` | Token or share | Get file metadata. Body: paths. |

### 2.3 Middleware Used

- `authenticateTokenOrShare`, `authenticateToken`, `requireUser`, `requireAuth`
- `normalizePathParam`, `checkMetaPathAccess`

### 2.4 Request/Response Spec

- List, download, metadata, download-multiple, thumbnails: support share token (header/query)
- Path params normalized; meta path (/.wea) blocked for non-admin
- Bulk ops: returns jobId; poll via bulk-operation

### 2.5 Related Documents

- [api.md](../../../api.md), [shared-contracts.md](../../../shared-contracts.md)
- selectiveTransfer, selectiveDownload, selectiveDelete services

### 2.6 Integration Test Scenarios

- [ ] List returns files with correct permissions
- [ ] Download returns blob
- [ ] Upload accepts multipart
- [ ] Batch move/copy return jobId
- [ ] Share token allows list/download for valid token
