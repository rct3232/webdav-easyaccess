# recentFilesNotifier Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | In-process pub-sub for “recent files” change events. `recentFilesRepository` publishes change events here after successful observable updates, and UI subscribers reload their recent-derived state from this signal. |
| Used by      | Publisher: `recentFilesRepository`                                                                                                                                                                                    |
| Used by      | Subscribers: `FileManager` (`/__recent__` refresh) and `useFolderTreeController` (recent section refresh)                                                                                                             |
| Does not own | Any server IO or path mutation logic                                                                                                                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/recentFilesNotifier.js`
- **Test file:** `client/src/services/__tests__/recentFilesNotifier.test.js`

---

### 2.2 Main Functions

| Function                | Input => Return               |
| ----------------------- | ----------------------------- |
| onRecentFilesChange     | `(callback) => unsubscribeFn` |
| notifyRecentFilesChange | `() => void`                  |

`unsubscribeFn` contract:

- Must be a callable function.
- Must be safe to invoke during React effect cleanup even if the subscriber was already removed.
- Must be safe to invoke more than once.

---

### 2.3 Error Handling

- Subscriber callback exceptions must be caught and must not prevent other subscribers from running.
- Errors should be logged for diagnostics.

---

### 2.4 Dependencies

- None

---

### 2.5 Verification Scenarios

- [ ] `onRecentFilesChange` registers a listener and returns an unsubscribe function that removes it.
- [ ] Multiple subscribers are all invoked when `notifyRecentFilesChange` fires.
- [ ] One subscriber throwing does not break notification fan-out.
- [ ] `FileManager` and `useFolderTreeController` can safely call the returned unsubscribe function during effect cleanup.
- [ ] Calling the returned unsubscribe function twice remains a no-op and does not throw.
