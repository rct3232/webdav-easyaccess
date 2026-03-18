# explorerGateway Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | IO boundary for explorer core: listing, file/folder operations, and related IO concerns needed by explorer controller hooks. Provides a replaceable adapter layer over current service calls (and future WebDAV IO). |
| Used by | `useExplorerCommands`, and any explorer composition code in the FileManager shell. |
| Does not own | Product overlays such as share-link policy, virtual collections (`__recent__`, `__shared__`), sharing permission workflows. Those remain outside explorer core. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/explorerGateway.js`
- **Test file:** `client/src/services/__tests__/explorerGateway.test.js`

### 2.2 Main Functions

This gateway should be kept minimal for the current use cases. Prefer adding functions only when a controller truly needs them.

| Function | Input | Return | Notes |
|----------|-------|--------|------|
| listDirectory | ({ path, options? }) | Promise<{ files: Array<object>, meta?: object }> | Wraps current directory listing behavior. Must preserve hidden-file filtering and permission shaping as currently implemented (owned by callers or via options). |
| uploadToPath | ({ targetPath, files, options? }) | Promise<object> | Upload files to a path. Must preserve conflict behavior and progress integration hooks used today. |
| renamePath | ({ path, newName, options? }) | Promise<object> | Rename operation for file/folder. |
| movePaths | ({ paths, targetPath, options? }) | Promise<object> | Move operation (bulk-capable). |
| copyPaths | ({ paths, targetPath, options? }) | Promise<object> | Copy operation (bulk-capable). |
| deletePaths | ({ paths, options? }) | Promise<object> | Delete operation (bulk-capable). |
| downloadPaths | ({ paths, options? }) | Promise<object> | Download operation (bulk-capable). |

Notes:

- The exact input/output shapes should wrap existing service APIs without changing observable behavior during extraction.
- The gateway may expose additional “capability” helpers (e.g. `canWrite(path)`) only if the explorer controllers currently require them and the logic is not product-overlay-specific.

### 2.3 Error Handling

- Errors must preserve the same error codes and user-visible outcomes as today.
- The gateway should not display UI; it should return structured errors that callers can map to dialogs/snackbars.

### 2.4 Dependencies

- Existing service functions (file listing, file ops, bulk ops) and transport (`apiClient`) are internal to this gateway.
- The gateway must be the boundary: view components and pure helpers must not import service functions directly.

### 2.5 Verification Scenarios

Verify observable IO behavior from the caller perspective:

- [ ] `listDirectory` returns the same entries as the current listing behavior for a given path (including permission flags and hidden-file behavior as currently implemented).
- [ ] `uploadToPath` triggers the same conflict behavior and supports the same progress integration points as today.
- [ ] `renamePath`, `movePaths`, `copyPaths`, `deletePaths`, `downloadPaths` produce the same success/error outcomes as current service calls.

