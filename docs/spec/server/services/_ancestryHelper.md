# _ancestryHelper Spec

## 1. Overview

| Item | Description |
|------|-------------|
| Role | Closure table (`node_ancestors`) maintenance for filesystem tree operations. Handles ancestor chain building on node creation, subtree rebuild after moves (BFS-based delete-then-insert), and explicit cleanup on deletion. Called exclusively by fileNodeService, never exposed to routes. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `server/service/_ancestryHelper.js`
- **Test file:** `server/service/__tests__/_ancestryHelper.test.js`

### 2.2 Factory Function Signature

```js
function createAncestryHelper(fileNodesStore) {
  return {
    buildAncestorsForNode(nodeId, parentId),
    rebuildAncestorsAfterMove(movedNodeId, newParentId),
    cleanupAncestorsForDeletion(nodeIds)
  };
}
```

### 2.3 Methods

#### `buildAncestorsForNode(nodeId, parentId)`

Builds ancestor rows when inserting a node. Copies all parent's ancestors + adds self (depth=0).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeId | number | yes | ID of the newly created node |
| parentId | number \| null | yes | Parent node ID; null for root-level nodes |

**Algorithm:**
- If `parentId === null`: insert only self-row `(nodeId, nodeId, depth=0)`
- Otherwise: fetch parent's ancestor chain via `getAncestorChain(parentId)`, then insert self-row + all parent ancestors with depth+1

#### `rebuildAncestorsAfterMove(movedNodeId, newParentId)`

Rebuilds ancestor rows for an entire subtree after a move. Uses delete-then-insert strategy (simplest correct approach).

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| movedNodeId | number | yes | ID of the node that was moved |
| newParentId | number \| null | yes | New parent ID; null means move to root |

**Algorithm:**
1. `getDescendantIds(movedNodeId)` → collect all descendant IDs (includes self)
2. `deleteAncestorByDescendant(descendantIds)` — remove all existing ancestor rows
3. Get new parent's chain: if `newParentId !== null`, call `getAncestorChain(newParentId)`
4. BFS through subtree starting from `movedNodeId`: for each node, compute ancestors = new parent chain + intermediate nodes + self (depth=0)
5. `insertAncestorRows(allRows)` — bulk insert all recomputed rows

#### `cleanupAncestorsForDeletion(nodeIds)`

Explicit ancestor cleanup on deletion. FK CASCADE handles this automatically, but explicit removal serves as a safety net.

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| nodeIds | number[] | yes | Array of descendant IDs to clean up |

### 2.4 Dependencies

- `fileNodesStore` — all DB operations go through this layer:
  - `insertAncestorRows`, `deleteAncestorByDescendant`, `getDescendantIds`, `getAncestorChain`, `getChildren`

### 2.5 Error Cases

- Cycle detection is not performed here (handled by fileNodeService before calling move)
- If `getAncestorChain` returns empty for a non-root node, the ancestor chain will be incomplete — this indicates closure table corruption and should be treated as an error condition upstream

### 2.6 Verification Scenarios

- [ ] buildAncestorsForNode at root (parentId=null) produces self-row only: `(id, id, depth=0)`
- [ ] buildAncestorsForNode at depth 1 produces self-row + parent ancestor rows with depth+1
- [ ] buildAncestorsForNode at depth N produces correct ancestor chain from root to self
- [ ] rebuildAncestorsAfterMove for leaf node updates all ancestor rows correctly
- [ ] rebuildAncestorsAfterMove for subtree updates all descendants' ancestor rows
- [ ] rebuildAncestorsAfterMove to root (newParentId=null) leaves only self-row per descendant
- [ ] cleanupAncestorsForDeletion removes descendant ancestor rows
