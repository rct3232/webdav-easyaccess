# fileLikesRepository Spec

Target-contract spec (T0.5 like state — `docs/features/collections-platform.md` §3.3; routes: [fileLikes.md](../../server/routes/fileLikes.md)).

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role         | Viewer-scoped like state IO: the whole-viewer read that feeds `file.liked` on explorer listing rows plus the explicit set (toggle) write. Swallows failures into fallback values (collectionsRepository pattern) and carries a module-local change notifier (pub-sub fan-out after real success). |
| Used by      | `explorerGateway` (re-export + `listDirectory` `liked` merge); shell like handlers via the gateway — never imported by components/hooks directly (`docs/spec/client/services/explorerGateway.md` §2.6).                                                                                           |
| Does not own | Like presentation (context menu / action sheet / properties header / `MemberRowControls`), usage recording (server `fileLikesService`), collection member `liked` (rides `GET /collections/:id/items`).                                                                                           |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/fileLikesRepository.js`
- **Test file:** `client/src/services/__tests__/fileLikesRepository.test.js`
- **Decision (wave-2 integration):** the change notifier is co-located in this module (not a `fileLikesNotifier.js` twin) to keep the integration surface minimal; the subscribe/notify contract is identical to `collectionsNotifier.md`. A like carries no undo pointer (§4.11), so no journal fan-out is involved.

### 2.2 Main Functions

| Function                 | Input                       | Return                                                                                                                   | API called (see api.md)       |
| ------------------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| getLikedNodeIds          | —                           | `Promise<{ liked: number[] }>` — verbatim snake_case payload; `{ liked: [] }` on failure                                 | GET `/api/file-likes`         |
| getLikedItems            | `()`                        | `Promise<{ items: Array<object> }>` — verbatim snake_case; `{ items: [] }` on failure (P-5; full fetch under Decision B) | GET `/api/file-likes/items`   |
| setFileLike              | `(nodeId, liked, options?)` | `Promise<{ node_id, liked } \| null>` — payload only on 2xx; `null` on absorbed failure                                  | PUT `/api/file-likes/:nodeId` |
| subscribeFileLikesChange | `(callback: () => void)`    | `() => void` unsubscribe                                                                                                 | — (module-local pub-sub)      |

- `setFileLike` body is camelCase `{ liked: boolean }` (PLAN §6 request casing); responses stay snake_case and are returned verbatim.
- **Notify-after-real-success only:** `subscribeFileLikesChange` callbacks fire after a 2xx `setFileLike`; absorbed failures never notify.
- `getLikedNodeIds` never notifies (it is the read the subscribers converge on).
- `getLikedItems` (P-5 — the Likes-surface listing, `fileLikes.md` §2.4.2) mirrors
  `collectionsRepository.getCollectionItems`: **no query params** (`cursor`/`limit` RETIRED —
  Decision B, 2026-09-29; the complete row set arrives in ONE response), the read never rejects
  and never notifies (it is the read the like-change subscribers converge on); rows are
  consumed through the shell's `toMemberRow` adapter (member-parity).

### 2.3 Error Handling

- Reads never reject; failures log and return the fallback (`{ liked: [] }`).
- Mutations return `null` on absorbed failure and surface the error envelope once through `options.onError` (same side-channel contract as `collectionsRepository.md` §2.3/§2.4 — `errorCode`/`params` shape).
- Error codes are existing `serverErrors.files.*` keys (fileLikes.md §2.4.1) — no new locale keys.

### 2.4 Listing merge (explorerGateway)

- `explorerGateway.listDirectory` merges `liked` onto authenticated rows: after normalization (non-share path only — share listings keep no like state, §3.3 viewer-scoped auth read), each row gets `liked: likedIds.includes(nodeId)` from `getLikedNodeIds`. Read failure ⇒ every row lands `liked: false` (fallback), never a rejected listing.

### 2.5 Verification Scenarios

- [ ] `getLikedNodeIds` returns `{ liked: [...] }` verbatim on success and `{ liked: [] }` on failure (no throw).
- [ ] (P-5) `getLikedItems()` calls GET `/api/file-likes/items` (no query params — Decision B
      full fetch) and returns `{ items }` verbatim; on failure `{ items: [] }`, no throw, no notify.
- [ ] `setFileLike` posts `{ liked }`, returns `{ node_id, liked }` on 2xx, and calls subscribers exactly once.
- [ ] Failed mutation returns `null`, calls `onError` once with the envelope, and notifies nobody.
- [ ] `subscribeFileLikesChange` returns an unsubscribe function safe for effect cleanup.
- [ ] `listDirectory` (authenticated) rows carry merged `liked`; share-token listings and absorbed read failures leave the listing shape unchanged (`liked: false`).
- [ ] (P-4) Admin operator rule (PLAN §14 client half): no file-likes read/write is ever issued for an admin session — `explorerGateway.listDirectory` skips the `getLikedNodeIds` merge and no like affordance is offered, so this repository is hidden / never invoked for admin.
