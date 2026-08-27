# composition Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Singleton service factory that wires all Phase 2-4 services once at startup. Routes call `getComposition()` to obtain pre-configured, cached service instances rather than constructing dependencies per-request. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/composition.js`
- **Test file:** `server/service/__tests__/composition.test.js`

### 2.2 Exported Functions

#### `getComposition()`

Returns a cached composition object containing all wired service instances. On first call, invokes `createComposition()` with no arguments and caches the result in a module-level variable (`_composition`). Subsequent calls return the same instance.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | — | — | — |

**Returns:** composition object (see §2.3)

#### `__setCompositionForTests(overrides)`

Test-only override mechanism. Rebuilds the cached composition using `createComposition(overrides)`, allowing individual service instances to be substituted via the `overrides` parameter. Intended exclusively for unit and integration tests requiring mocked dependencies.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| overrides | object | no | Partial dependency map; any key matching a composition slot replaces the auto-created instance |

**Returns:** void (mutates `_composition` in place)

#### `resetComposition()`

Clears the cached composition by setting `_composition` to `null`. Restores cold-start state so subsequent `getComposition()` calls perform a fresh wiring cycle. Used for test isolation between test cases.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| *(none)* | — | — | — |

**Returns:** void

#### `createComposition(overrides)`

Internal factory function (also exported). Builds the full dependency graph from scratch, resolving each slot either from `overrides` or via the corresponding service factory. Used by `getComposition()` and `__setCompositionForTests()`.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| overrides | object | no | Partial dependency map for test injection |

**Returns:** composition object (see §2.3)

### 2.3 Composition Object Shape

```js
{
  fileNodesStore,          // file_nodes store instance
  blobStore,               // S3BlobStore or WebdavBlobStore adapter
  fileNodeService,         // tree management service
  blobStorageService,      // blob lifecycle service
  uploadService,           // multipart/single-part upload coordinator
  aclService,              // permission/ACL evaluation service
  fileService,             // high-level file operations (Phase 3)
  batchOperationService,   // bulk move/copy/delete operations (Phase 4)
  downloadService,         // streaming download service (Phase 4)
  gcService,               // two-tier orphaned-blob garbage collection (Phase 6)
  failSafeService          // orphaned_node scan + repair (Phase 6)
}
```

### 2.4 Configuration & Blob Store Selection

`createComposition()` determines the blob store adapter from `WEA_FILE_STORAGE`:

1. Checks `overrides.fileStorageMode` first (test injection).
2. Falls back to `process.env.WEA_FILE_STORAGE`.
3. Defaults to `'s3'` when both are absent or empty.

The value is passed through to `createBlobStore()`, which dispatches:

| `WEA_FILE_STORAGE` | Adapter |
|---------------------|---------|
| `'webdav'` | `WebdavBlobStore` (backed by `createFileStoreAdapter()`) |
| `'s3'` or undefined/empty | `S3BlobStore` (backed by `resolveS3Config()`) |

### 2.5 Service Dependency Graph

```
fileNodesStore ─────┐
                    ├─→ fileNodeService ───┐
blobStore ─────────┼───────────────────────┤
                   │                       ├─→ blobStorageService ──┐
fileStorageMode ───┘                       │                        ├─→ uploadService
                                          │                        │
                                          ├─────────────────────────┘
                                          │
                                          ├─→ fileService (also depends on aclService, uploadService)
                                          │
                                          ├─→ batchOperationService (depends on fileNodeService, fileService, aclService)
                                          │
                                          ├─→ downloadService (depends on fileNodeService, blobStorageService, aclService)
                                          │
                                          ├─→ gcService (depends on blobStore, fileNodesStore, fileStorageMode)
                                          │
                                          └─→ failSafeService (depends on fileNodeService, fileNodesStore)
```

---

## 3. Verification Scenarios

- [ ] First call to `getComposition()` returns a non-null object with all 11 keys present
- [ ] Second call to `getComposition()` returns the same instance (`===`)
- [ ] `resetComposition()` followed by `getComposition()` produces a new instance (`!==` previous)
- [ ] `__setCompositionForTests({ blobStore: mock })` yields composition containing `mock`
- [ ] `WEA_FILE_STORAGE=webdav` results in `WebdavBlobStore` adapter in the composition
- [ ] Default (no env var) results in `S3BlobStore` adapter
