# trashNotifier Spec

## 1. Overview

| Item    | Description                                                                                                                                                                                                                                              |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role    | In-process pub-sub for trash-change events (DEF-16 P9). The pinned sidebar trash icon subscribes and plays its one-shot animation (lid open → close, color flash default → `error.main` → default, ~1.2s) whenever items are moved into or out of trash. |
| Used by | `useExplorerCommands.handleOperationComplete` (raises on delete-to-trash), `useTrashOperations` (raises on restore/purge/empty), `TrashSidebarItem` (subscribes)                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/trashNotifier.js`
- **Test file:** `client/src/services/__tests__/trashNotifier.test.js`

### 2.2 Main Functions

| Function                | Input                | Return       | Notes                                                                                    |
| ----------------------- | -------------------- | ------------ | ---------------------------------------------------------------------------------------- |
| subscribeToTrashChanged | `(callback) => void` | `() => void` | Register a callback; returns the unsubscribe function (mirror of `onRecentFilesChange`). |
| notifyTrashChanged      | `()`                 | `void`       | Fan-out to all subscribers; subscriber errors must not break the loop.                   |

### 2.3 Raise Sites (single stable seam)

- **Delete-to-trash:** `useExplorerCommands.handleOperationComplete` raises once per completed
  delete operation when `deletedNodeIds.length > 0` (covers single delete via context menu/action
  sheet AND bulk delete — both funnel through the bulk-delete completion path).
- **Trash-view ops:** `useTrashOperations` raises after successful restore / purge / empty runs.

### 2.4 Dependencies

- None (plain module state, mirroring `recentFilesNotifier.js`). No browser APIs, no storage.

### 2.5 Verification Scenarios

- [ ] `notifyTrashChanged` invokes every subscriber exactly once per call
- [ ] Subscriber errors do not prevent fan-out to remaining subscribers
- [ ] Unsubscribe stops later notifications

### 2.6 Edge Cases

- Module-level listener list is session-scoped; no cross-tab or persisted semantics.
