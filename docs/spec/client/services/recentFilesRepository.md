# recentFilesRepository Spec

## 1. Overview

| Item         | Description                                                                                                                                                                                                |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | IO boundary for persisting and reading user-specific “recent files” on the server. Provides server-backed operations and returns observable updated recent lists (unless silenced).                        |
| Used by      | Explorer/tree controllers and file operation flows that need recent list updates.                                                                                                                          |
| Does not own | Pub-sub subscriptions and change notification fan-out (that belongs to `recentFilesNotifier`).                                                                                                             |
| Does not own | Pure path mutation planning rules. `client/src/utils/recentFiles.js` was removed (Phase 5); recent entries are keyed by `nodeId`/`fileNodeId` and survive renames/moves without client-side path rewrites. |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/recentFilesRepository.js`
- **Test file:** `client/src/services/__tests__/recentFilesRepository.test.js`

---

### 2.2 Main Functions

Recent entry shape:

- Minimum contract:
  - `RecentEntry = { nodeId: number, name?: string, type?: 'file'|'directory', basename?: string, lastAccessed?: string | number | null, displayPath?: string }`
- `getRecentFiles()` may preserve additional server-provided fields beyond the minimum contract.
- Callers may rely on `lastAccessed` when present (for example, `useFileManager` maps it into the recent-view listing metadata).
- Recent entries are keyed by `nodeId`; nodeIds are stable across renames/moves.
- `addRecentFile(file)` sends `{ fileNodeId: file.nodeId }`.

| Function         | Input => Return                                    |
| ---------------- | -------------------------------------------------- |
| getRecentFiles   | `() => Promise<RecentEntry[]>`                     |
| addRecentFile    | `(file, options?) => Promise<RecentEntry[]>`       |
| removeRecentFile | `(fileNodeId, options?) => Promise<RecentEntry[]>` |
| clearRecentFiles | `() => Promise<void>`                              |

`options`:

- `{ silent?: boolean }`
  - When `silent === true`, the repository must avoid notifying subscribers and must avoid “refresh + notify” behavior. It may return `[]` as a compatibility result.

---

### 2.3 Side Effects

- On successful observable create/update/delete operations, the repository triggers `recentFilesNotifier.notifyRecentFilesChange()` unless `silent === true`.
- The repository must not notify subscribers merely because it performed a fallback read after a failed persistence call.
- Caller-facing refreshes happen indirectly: subscribers such as FileManager and folder-tree controllers re-read recent files after notification.

---

### 2.4 Dependencies

- Transport:
  - `client/src/services/apiClient` (get, post, del)
- Notification:
  - `client/src/services/recentFilesNotifier` (`notifyRecentFilesChange`)

---

### 2.5 API Endpoints

- GET `/recent-files`
- POST `/recent-files` (body: `{ fileNodeId }`)
- DELETE `/recent-files`
- DELETE `/recent-files/:fileNodeId`

---

### 2.6 Error Handling

- Network/auth errors must not throw UI-breaking exceptions for caller flows that rely on empty fallback.
- Repository methods are the compatibility boundary for recent-files IO. For expected transport/storage failures, callers should receive contract-safe fallback values instead of rejected promises.
- Default fallback:
  - `getRecentFiles` => `[]`
  - mutations => `[]` (or `void` for `clearRecentFiles`)
- Errors should be logged for diagnostics.
- Failed mutations may perform a best-effort fallback read, but that fallback read alone must not be treated as a successful change event.

---

### 2.7 Verification Scenarios

- [ ] `getRecentFiles` returns an array; on error it returns `[]`.
- [ ] Recent-files repository methods do not require caller-side rejection handling for ordinary API/storage failures.
- [ ] `addRecentFile` and `removeRecentFile` return an updated recent list when `silent` is not enabled.
- [ ] `addRecentFile`/`removeRecentFile` with `{ silent: true }` do not notify subscribers.
- [ ] Failed persistence paths do not emit `notifyRecentFilesChange()` unless a real successful recent-files mutation occurred earlier in the same flow.
- [ ] `addRecentFile(file)` sends `{ fileNodeId: file.nodeId }` to POST `/recent-files`.
- [ ] `removeRecentFile(fileNodeId)` calls DELETE `/recent-files/:fileNodeId` and returns the updated list.

---

### 2.8 Notes

- Return shapes and error fallbacks are intended to match current observable behavior prior to extraction, so higher-level hooks do not need behavioral changes in P8-S1.
- `getRecentFiles()` is the source of truth for the observable recent list. Mutation helpers may internally normalize payloads for outgoing writes, but the refreshed list returned to callers remains compatible with the server response shape.
