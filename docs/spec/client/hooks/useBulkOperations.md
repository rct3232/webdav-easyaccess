# useBulkOperations Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Transitional bulk-operation helper for FileManager. It currently encapsulates bulk move/copy/delete/download mechanics, conflict checks, folder-picker state, and polling, but in the target architecture it serves as an internal dependency that can be wrapped by `useExplorerCommands` rather than remaining the top-level owner of explorer command orchestration. |
| Used by components/pages | FileManager (current implementation); target usage may be via `useExplorerCommands`                                                                                                                                                                                                                                                                                     |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/pages/FileManager/hooks/useBulkOperations.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useBulkOperations.test.js`

### 2.2 Input Parameters

| Name                 | Type     | Required | Description                                             |
| -------------------- | -------- | -------- | ------------------------------------------------------- |
| selectedNodeIds      | Set      | Y        | Selected file nodeIds                                   |
| files                | array    | Y        | File list                                               |
| onOperationComplete  | function | Y        | Complete callback                                       |
| setTreeUpdateTrigger | function | Y        | Tree refresh                                            |
| setDropMessage       | function | N        | Drop message                                            |
| setSelectedFiles     | function | Y        | Set selection                                           |
| setSelectionMode     | function | Y        | Set selection mode                                      |
| getCurrentNodeId     | function | Y        | Current folder nodeId                                   |
| options              | object   | N        | markProcessing, clearProcessing, shareToken, onUndoable |

### 2.3 Return Value / State

| Key                       | Type                                             | Meaning                           |
| ------------------------- | ------------------------------------------------ | --------------------------------- |
| folderPickerOpen          | boolean                                          | Folder picker open                |
| folderPickerAction        | 'move' \| 'copy' \| null                         | Action                            |
| handleBulkMove            | () => void                                       | Open move picker                  |
| handleBulkCopy            | () => void                                       | Open copy picker                  |
| handleBulkDelete          | (retryData?, onConfirm?) => void                 | Delete                            |
| handleBulkDownload        | () => Promise                                    | Download                          |
| handleFolderPickerSelect  | (destinationParentNodeId, retryData?) => Promise | Pick folder, triggers move/copy   |
| handleRetry               | (progressId) => Promise                          | Retry failed operation            |
| handleCancelBulkOperation | (progressId) => Promise                          | Cancel bulk job                   |
| dismissFailedItems        | () => void                                       | Dismiss failed items              |
| setFolderPickerOpen       | function                                         | Set folder picker open            |
| setFolderPickerAction     | function                                         | Set folder picker action          |
| bulkConflictData          | object                                           | Conflict data                     |
| resolveBulkConflict       | (resolution) => Promise                          | Resolve conflict (overwrite/skip) |
| setBulkConflictData       | function                                         | Set conflict data                 |
| progressItems             | array                                            | Progress items                    |
| updateProgress            | function                                         | Update progress                   |

### 2.4 Boundaries

- **Currently owns**
  - Bulk move/copy/delete/download execution details
  - Folder picker coordination for bulk move/copy
  - Bulk conflict-check flow and retry/cancel mechanics for existing batch jobs
- **Does not own in target architecture**
  - Top-level explorer command ownership for FileManager page shell
  - Search/sort/view session state
  - Navigation orchestration (nodeId-based, `useExplorerNavigation`)
  - Progress drawer/list ownership as an explorer-core concern
  - Product overlay policies such as share-link restrictions

### 2.5 Dependencies

- fileService (batchMove, batchCopy, batchDelete, downloadMultipleFiles, checkConflicts, getBulkOperationStatus, cancelBulkOperation)
- useFileOperationProgress
- recentFilesNotifier (`notifyRecentFilesChange` — triggers a recent-files refresh; node ids are stable, so no path-mutation synchronization is needed)

### 2.6 Side Effects

- API calls for bulk ops
- Polling for batch job status (self-scheduling `setTimeout`, base interval `POLL_INTERVAL_MS`; see §2.6.1)
- dismissFailedItems before new op
- For bulk delete/move success paths, a recent-files refresh is triggered via `notifyRecentFilesChange()` (the hook no longer mutates recent entries directly).
- Bulk move/copy completion is asynchronous from the caller's perspective: `handleFolderPickerSelect()` may resolve before the background job reaches its final status, and completion is communicated through progress state plus `onOperationComplete`.
- **Undo-command seam (job-backed move/copy only):** when the terminal poll result carries `undo.action_id` (journaled batches — `services/batchOperationService.md` §5.4 on the server), the hook calls `options.onUndoable(job, labelKey, params, meta)` exactly once per COMMAND: `job` is the terminal payload exposing `undo`, `labelKey` is the already-chosen i18n key (`fileManager.bulkMoveToast` / `fileManager.bulkCopyToast`), `params` carry `{ count }` (succeeded items), and `meta` carries `{ action }` for host-side follow-up (copy undo trashes — the host fires the trash notification). The hook never renders the toast and never invents labels (`useUndoToast.md` §2.4); hosts without `onUndoable` simply drop the pointer.
- Bulk DELETE never routes through the undo seam: delete-to-trash undo belongs to the trash restore surface, and delete-batch jobs carry no journal pointer.

### 2.6.1 Job polling contract (scheduling, stalled job)

- **Scheduling:** one poller per job (`bulkJobPoller.js`), first read immediately, then a self-scheduling `setTimeout` chain at `POLL_INTERVAL_MS` (400 ms). No `setInterval`, and **at most one status request in flight**: the next tick is scheduled only after the current one settles. `dispose()` clears the timer and aborts the in-flight request (hook unmount / item dismissal).
- **Status read:** `getBulkOperationStatus(jobId)` with an explicit **10 s timeout** and **`maxRetries: 0`** — the poller owns retrying, so a hung request surfaces as one failed attempt instead of stacking the transport's `(3 retries + 5 min)` defaults.
- **Failure budget:** 5 consecutive read failures (network error, timeout, 5xx). Backoff after failures 1→4 is 400 / 800 / 1600 / 3200 ms; the 5th failure ends the poll. Fast connection failures therefore reach the stalled state in ~6 s; hanging requests in up to ~56 s (5 × 10 s + backoff). A successful read resets the counter.
- **Job expiry (`404`):** terminal-unknown immediately (no retry) — the in-memory job store loses records on restart/TTL, so the record can never come back.
- **Stalled state (one state for both triggers):** the progress item becomes `status:'error'`, `stalled:true`, `keepOnError:true` with `fileManager.bulkStatusUnavailable` ("작업 상태를 확인할 수 없습니다. 작업이 이미 반영되었을 수 있습니다."). The item is **not** auto-removed; only the existing `확인` dismisses it. No retry button and no refresh button — the user is not asked.
- **Automatic reconciliation:** entering the stalled state calls `onOperationComplete` (the host's `refreshNow`) **exactly once and before any other side effect**, so the listing reflects the server state without user action. A failed refresh (the same broken network) leaves the stale listing; the stalled message stays visible.
- **Completion ordering:** on a terminal job, `onOperationComplete` runs first; `notifyRecentFilesChange`, `notifyTrashChanged`, tree triggers, `clearProcessing`, the undo pointer and the progress updates are each isolated (one throwing side effect never skips the refresh or the others).
- **Cancel:** `handleCancelBulkOperation` POSTs the cancel and then performs **one forced status read** (`checkNow`). Success → the normal terminal handling (refresh included). Failure → the stalled state above (refresh + message). A cancelled job that succeeded on a prefix still routes its undo pointer exactly once.
- **Exactly-once:** terminal handling and stalled handling are each guarded by the poller's `finished` flag; a late response after `dispose()` is ignored.

### 2.7 Error Handling

- Conflict check -> bulkConflictData
- Progress updates for error/warning
- Job status reads follow §2.6.1: a status that cannot be read (5 failures or `404`) is surfaced through the stalled progress item + automatic listing refresh; it is never silent and never retried forever.

### 2.8 Verification Scenarios

- [ ] handleBulkMove, handleBulkCopy open picker
- [ ] handleBulkDelete with/without retry
- [ ] handleBulkDownload
- [ ] handleFolderPickerSelect triggers move/copy
- [ ] Job-backed bulk move/copy consumers wait for a visible completion anchor (`progressItems` final state, progress message, or a refreshed listing after `onOperationComplete`) instead of assuming the operation is complete immediately after folder selection
- [ ] Conflict flow
- [ ] When a bulk move/delete partially succeeds, the recent-files refresh still runs (`notifyRecentFilesChange`) and does not depend on all items succeeding.
- [ ] Terminal move/copy poll result with `undo.action_id` ⇒ `options.onUndoable(job, labelKey, { count }, { action })` fires exactly once; a second poll seeing the same terminal state does not re-fire it.
- [ ] Terminal result WITHOUT `undo.action_id` (delete job, zero-succeeded job, journaled-write failure, legacy `null`) ⇒ `onUndoable` is not called; an absent `onUndoable` option never throws.
- [ ] A `cancelled` terminal job that succeeded on a prefix still routes its undo pointer (partial batches stay undoable).
- [ ] The hook remains behavior-compatible while being documented as a lower-level dependency that can sit behind `useExplorerCommands`
- [ ] Status reads use one in-flight request and a self-scheduling `setTimeout` chain (§2.6.1): no overlapping `bulk-operation` GETs, no `setInterval`.
- [ ] 5 consecutive read failures OR a `404` moves the progress item to the single stalled state (`status:'error'`, `stalled:true`, `fileManager.bulkStatusUnavailable`) and fires the listing refresh exactly once with no user action; a late response never re-fires it.
- [ ] A successful read resets the failure counter; a terminal job after earlier read failures still runs the normal completion path.
- [ ] `handleCancelBulkOperation` performs one forced status read after the cancel POST: terminal → normal completion (refresh first), read failure → the stalled state (refresh + message).

### 2.9 Edge Cases

- retryData for retry
- Polling cleanup
- Partial success with skipped items: success-side follow-up work (including the recent-files refresh) must use only the succeeded items and must not invent updates for skipped items.
