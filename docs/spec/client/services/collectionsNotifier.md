# collectionsNotifier Spec

Target-contract spec.

## 1. Overview

| Item         | Description                                                                                                                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | In-process pub-sub for "collections changed" events. `collectionsRepository` publishes after successful observable mutations; UI subscribers reload their collections-derived state from this signal. |
| Used by      | Publisher: `collectionsRepository`                                                                                                                                                                    |
| Used by      | Subscribers: `useCollections` (FileManager list + archive), `useFolderTreeController` (`__collections__`/`__archive__` tree rows), `CollectionsListView` host, merge-card consumers                   |
| Does not own | Any server IO, change payloads, or per-view dirty tracking                                                                                                                                            |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/collectionsNotifier.js`
- **Test file:** `client/src/services/__tests__/collectionsNotifier.test.js`

### 2.2 Main Functions

| Function                | Input => Return               |
| ----------------------- | ----------------------------- |
| onCollectionsChange     | `(callback) => unsubscribeFn` |
| notifyCollectionsChange | `() => void`                  |

`unsubscribeFn` contract (recentFilesNotifier parity):

- Must be a callable function.
- Must be safe to invoke during React effect cleanup even if the subscriber was already removed.
- Must be safe to invoke more than once.

### 2.3 Event Contract

- **Contract:** one coarse, payload-free channel — no event payload. Silent system evolution can change anything (create/split/archive/purge/merge) and there is no push channel in the stack (no SSE/websocket transport exists here); subscribers re-read via the gateway. Polling stays refresh-policy's job.
- Publish timing belongs to the publisher: only after a real 2xx mutation, never on absorbed failures (`collectionsRepository` §2.4).

### 2.4 Error Handling

- Subscriber callback exceptions must be caught and must not prevent other subscribers from running.
- Errors should be logged for diagnostics.

### 2.5 Dependencies

- None.

### 2.6 Verification Scenarios

- [ ] `onCollectionsChange` registers a listener and returns an unsubscribe function that removes it.
- [ ] Multiple subscribers are all invoked when `notifyCollectionsChange` fires.
- [ ] One subscriber throwing does not break notification fan-out.
- [ ] `useCollections` and `useFolderTreeController` can safely call the returned unsubscribe function during effect cleanup.
- [ ] Calling the returned unsubscribe function twice remains a no-op and does not throw.
