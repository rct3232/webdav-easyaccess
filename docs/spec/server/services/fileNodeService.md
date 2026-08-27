# fileNodeService Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Filesystem tree management service. Orchestrates node creation/deletion/move/rename with transaction boundaries, cycle detection on moves, closure table maintenance via _ancestryHelper, and path resolution (nodeId→path, path→node). Factory function `createFileNodeService({ fileNodesStore, storage })`. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/fileNodeService.js`
- **Test file:** `server/service/__tests__/fileNodeService.test.js`

### 2.2 Factory Function Signature

```js
function createFileNodeService({ fileNodesStore, storage }) {
  return {
    createFile(parentNodeId, name),
    createDirectory(parentNodeId, name),
    renameNode(nodeId, newName),
    moveNode(nodeId, newParentId),
    deleteNode(nodeId),
    listDirectory(parentNodeId),
    getNodePath(nodeId),
    resolvePath(pathString),
    getDescendantIds(nodeId),
    updateSyncStatus(nodeId, status)
  };
}
```

### 2.3 Methods

#### `createFile(parentNodeId, name)` / `createDirectory(parentNodeId, name)`

Creates a new file/directory node with ancestor chain initialization. Wrapped in TX.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| parentNodeId | number \| null | yes | Parent node ID; null for root-level creation |
| name | string | yes | Node name (subject to UNIQUE constraint per parent) |

**Returns:** `{ id, parentId, name, type, syncStatus }`

**TX scope:** `createNode` + `buildAncestorsForNode` in single transaction.

#### `renameNode(nodeId, newName)`

Updates node name without affecting ancestor chain. No TX needed (single UPDATE).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the node to rename |
| newName | string | yes | New name for the node |

#### `moveNode(nodeId, newParentId)`

Moves a node (and its subtree) to a new parent. Includes cycle detection and closure table rebuild. Wrapped in TX.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the node to move |
| newParentId | number \| null | yes | New parent ID; null means move to root |

**Cycle detection:** Before move, calls `getDescendantIds(nodeId)` and rejects if `newParentId` is in the descendants set (cannot move a node into its own descendant).

#### `deleteNode(nodeId)`

Deletes a node and all its descendants. Explicit ancestor cleanup + CASCADE delete. Wrapped in TX.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the root node to delete |

**TX scope:** `cleanupAncestorsForDeletion` + `deleteNodeTree(descendantIds)` in single transaction. CASCADE handles object_map, filecache, node_ancestors FK rows.

#### `listDirectory(parentNodeId)`

Returns children of a directory with filecache metadata (LEFT JOIN). Read-only, no TX.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| parentNodeId | number | yes | ID of the parent directory |

**Returns:** `row[]` — each row includes file_nodes fields + size, mime_type, content_hash from filecache.

#### `getNodePath(nodeId)`

Resolves a node's full display path by traversing its ancestor chain. Read-only, no TX.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the target node |

**Returns:** string — e.g., `"/a/b/c/file.txt"`

#### `resolvePath(pathString)`

Resolves a path string to a node by sequential segment lookups. Read-only, no TX.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| pathString | string | yes | Display path (e.g., `/a/b/c/file.txt`) |

**Returns:** node object \| null if any segment doesn't exist. Special case: `"/"` returns root-level lookup.

#### `getDescendantIds(nodeId)`

Proxy to fileNodesStore.getDescendantIds. Returns self + all descendants.

#### `updateSyncStatus(nodeId, status)`

Updates sync_status of a node. No TX needed (single UPDATE).

### 2.4 Dependencies

- `fileNodesStore` — all DB operations
- `_ancestryHelper` — closure table maintenance (`buildAncestorsForNode`, `rebuildAncestorsAfterMove`, `cleanupAncestorsForDeletion`)
- `storage` — transaction helpers (`withTransaction`, `withSqliteTransaction`, `getBackend`)

### 2.5 Error Cases

- Duplicate name under same parent → UNIQUE constraint error from DB
- Move into own descendant → cycle detection throws before TX begins
- Non-existent path segment in resolvePath → returns null (no throw)

### 2.6 Verification Scenarios

- [ ] createFile at root (parent=null) creates node with ancestor chain = self only (depth=0)
- [ ] createFile at depth 1 produces ancestor chain including parent + grandparent
- [ ] createFile with duplicate name under same parent throws UNIQUE constraint error
- [ ] createDirectory behaves identically to createFile for tree operations
- [ ] renameNode updates name without affecting ancestors
- [ ] moveNode rebuilds subtree ancestors correctly after move
- [ ] moveNode rejects cycle (moving node into its own descendant)
- [ ] moveNode to root (newParentId=null) leaves only self-row in ancestor chain
- [ ] deleteNode on leaf removes node + ancestor rows
- [ ] deleteNode on directory triggers CASCADE for entire subtree
- [ ] listDirectory returns children ordered by name with filecache data
- [ ] getNodePath for root node returns `"/"`
- [ ] getNodePath at depth N returns correct full path like `"/a/b/c/file.txt"`
- [ ] resolvePath for valid path returns correct node
- [ ] resolvePath for non-existent segment returns null
- [ ] resolvePath for "/" returns appropriate result
