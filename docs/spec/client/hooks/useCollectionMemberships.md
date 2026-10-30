# useCollectionMemberships Spec

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Collection-membership read controller. Batches the visible rows' nodeIds into `POST /api/collections/for-nodes` requests (chunked ≤100 ids per request) and maintains the `nodeId → containing-collection` map consumed by the properties `Member of` chips and `AddToCollectionMenu` checkmarks. |
| Used by components/pages | `FileManager` page shell (which slices the map for the opened properties target and computes the add-menu all-target intersection)                                                                                                                                                                |
| Does not own             | The HTTP call itself (`collectionsRepository.getMemberships`), chip/checkmark rendering, the collections list (owned by `useCollections` — this hook only borrows it to resolve names), selection/mutation flows                                                                                  |

---

## 2. Implementation Spec

### 2.1 File Path

- **Scope:** Page-local — **Source:** `client/src/pages/FileManager/hooks/useCollectionMemberships.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useCollectionMemberships.test.js`
- **Spec placement:** `docs/spec/client/hooks/` even though the source is page-local.

### 2.2 Input Parameters

| Name        | Type            | Required | Description                                                                                                                                                                                                                                                                                |
| ----------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| nodeIds     | Array\<number\> | Y        | Node ids on the current files surfaces. The hook de-dupes, drops nullish ids and ignores the rest of the ordering. An empty set ⇒ no IO, empty map. The shell also includes the currently opened properties target so its membership is available off-listing (`pages/FileManager.md` §7). |
| collections | Array\<object\> | Y        | `useCollections.collections` rows (`collection_id`/`name`). Name resolution + the stable slice order (collections-list order).                                                                                                                                                             |
| gateway     | object          | N        | Memberships seams from `explorerGateway` §2.6: `getMemberships`, `subscribeToCollections` (default: the real gateway; the shell passes the inert seam for admin and share-link sessions).                                                                                                  |

### 2.3 Return Value / State

| Key                 | Type                                | Meaning                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| membershipsByNodeId | `{ [nodeId]: Array<{ id, name }> }` | Containing-collection slice per node. Nodes with no membership are ABSENT (lookup yields `undefined`). Array identity is stable between re-reads; each re-read cycle (notifier, id-set change, collections-list change) rebuilds the map wholesale (member-adapter remap class) — no cross-run array reuse is attempted. |

### 2.4 Responsibilities

- **Batched read (chunking precedent, `explorerGateway.loadNodesMetadata`):** the endpoint accepts 1–200 ids and rejects over-cap bodies (`collections.emptyNodeIds`, `routes/collections.md`). The hook chunks the id set at **100 per request** and fires the chunks concurrently, merging the `memberships` arrays (`{ memberships: [{ node_id, collection_ids }] }`, snake_case verbatim per `collectionsRepository.md`).
- **Failure swallowing to no entries:** the repository seam absorbs transport/4xx failures into `{ memberships: [] }` and never rejects (client layering: IO failures degrade to fallback values). A failed chunk contributes nothing — targets covered only by that chunk are treated as unknown and get NO checkmarks (never a wrong checkmark). The hook surfaces no error UI (the underlying membership state is unaffected).
- **Name resolution:** each `collection_ids` entry maps through the collections rows; ids missing from the list are dropped; the resulting array preserves collections-list ORDER (stable regardless of the store's id order).
- **Refresh triggers:** re-read when (a) the de-duped id set changes (navigation/listing change), (b) the collections list changes (rename/create/archive shift names and order), or (c) the collections notifier fires (add/remove membership, publish, merge — any mutation fans `notifyCollectionsChange`). Subscribed via `gateway.subscribeToCollections`; unsubscribes on unmount (single coarse channel — payload-free re-read).
- **Stale-run guard:** an outdated in-flight read never commits its map (monotonic run token; the most recently started run wins).
- **Gating is host-side:** the shell passes the inert gateway for `isShareLinkMode || user?.is_admin` (operator rule — admin sessions are IO-silent on the collections seams, `pages/FileManager.md` §7). The inert seam resolves `{ memberships: [] }` and returns a no-op unsubscribe ⇒ zero HTTP. The hook itself performs no auth checks.
- **Listing contracts stay frozen:** this read NEVER merges into the file-listing payload (separate map, consumed as a distinct prop chain). The gateway listing seam must not call `getMemberships`.

### 2.5 Verification Scenarios

- [ ] 250 unique ids ⇒ exactly 3 `getMemberships` calls with chunk sizes 100/100/50; the merged map covers all present nodes.
- [ ] Failed chunk ⇒ its targets carry no entry, other chunks' targets still resolve (no-cascade), no throw.
- [ ] Collections list order is the slice order even when `collection_ids` arrive in a different order.
- [ ] Notifier event ⇒ one re-read batch, new map after resolve.
- [ ] `nodeIds` shrinks (navigation) ⇒ re-read for the remaining set only; removed nodes vanish from the map.
- [ ] Empty id set ⇒ zero IO, empty map.
- [ ] Unknown collection id ⇒ dropped (no consumer ever sees an unresolvable name).
- [ ] Inert gateway ⇒ zero `getMemberships` calls, empty map, no-op unsubscribe.
- [ ] Opened-properties target id supplied by the host is part of the requested set even when it is not a listing row.

### 2.6 Non-goals

- No persistence (map is transient view state), no optimistic updates (the notifier re-read is authoritative), no cache — chunk reads are cheap indexed `collection_items` lookups and the visible set is small.
- No member/liked-surface chrome: the read serves the properties `Member of` chips and add-menu checkmarks, not row badges.
