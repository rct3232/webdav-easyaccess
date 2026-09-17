# collectionsRepository Spec

Target-contract spec (docs-first; AI_FEATURE_PLAN §2/§3/§4.4–§4.9/§4.11/§4.16/§4.17; PLAN §6 "Client layering", §7 T0.3–T0.11/T2.x/T3.x consumers).

## 1. Overview

| Item         | Description                                                                                                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role         | IO boundary for the collections platform: collection CRUD, membership, preview, merge suggestions, grants, membership chips, hybrid search, undo-journal feed/execution, file suggestions. Owns request/response mapping and failure absorption. |
| Used by      | `explorerGateway` (re-export boundary — see `explorerGateway.md` §2.6). Controller hooks consume the gateway, never this module directly (ARCHITECTURE §7).                                                                                      |
| Does not own | Pub-sub fan-out (`collectionsNotifier`), UI state, toast/label mapping, endpoint behavior (see `docs/spec/server/routes/{collections,search,actions}.md`).                                                                                       |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/services/collectionsRepository.js`
- **Test file:** `client/src/services/__tests__/collectionsRepository.test.js`

### 2.2 Data Shapes (wire contract)

- **Decision:** the repository returns server payloads **verbatim in snake_case** (`collection_id`, `publish_mode`, `undo.action_id`, `result_ref`, `next_cursor`, …). PLAN §6 makes camelCase an internal server-boundary convention only; no client-side key remapping. Consumers map fields to UI labels at render time.
- Collection row, member item, merge suggestion, grant, action-feed row shapes are exactly the objects documented in `docs/spec/server/routes/collections.md` §2.4 and `actions.md` §2.4. Requests are camelCase nodeId-based bodies (`{ nodeIds }`, `{ seedNodeId }`, `{ userId, role }`, `{ confirmCascade }`).
- `getCollections`/`getCollectionItems` preserve all server fields (including `cluster_index`, `digest`, `publish_pending_count`, `reason`, `state`, `shared_excluded`).

### 2.3 Main Functions

| Function                              | Input ⇒ Return (failure ⇒ right side of `∥`)                                                                                                                             | API                                             |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------- |
| getCollections                        | `({ sort?, include? }) => Promise<{ collections: [] }>`                                                                                                                  | GET `/api/collections`                          |
| createCollection                      | `({ name, definition?, origin?, resultRef? }, options?) => Promise<payload ∥ null>`                                                                                      | POST `/api/collections`                         |
| updateCollection                      | `(id, { name?, pinned?, publishMode? }, options?) => Promise<payload ∥ null>`                                                                                            | PUT `/api/collections/:id`                      |
| archiveCollection / restoreCollection | `(id, options?) => Promise<payload ∥ null>`                                                                                                                              | POST `/:id/archive` / `/:id/restore`            |
| deleteCollection                      | `(id) => Promise<boolean>` — `true` on 204, `false` on failure; no undo pointer by contract (invariant 10)                                                               | DELETE `/:id`                                   |
| getCollectionItems                    | `(id, { cursor?, limit?, since? }) => Promise<{ items: [], next_cursor: null, publish_pending_count?: number, digest?: {...} }>`                                         | GET `/:id/items`                                |
| addCollectionItems                    | `(id, nodeIds, options?) => Promise<{ added, already_members, rejected_not_readable, undo } ∥ null>`                                                                     | POST `/:id/items`                               |
| removeCollectionItems                 | `(id, nodeIds, options?) => Promise<{ removed, excluded, ignored, undo } ∥ null>`                                                                                        | DELETE `/:id/items` (body)                      |
| publishItems                          | `(id, nodeIds, options?) => Promise<payload ∥ null>` — **Decision:** endpoint ships with T3.2 sharing; repository signature is stable now (server-doc gap tracked there) | POST `/:id/publish` (T3.2)                      |
| getMemberships                        | `(nodeIds) => Promise<{ memberships: [] }>`                                                                                                                              | POST `/for-nodes`                               |
| previewCollection                     | `({ seedNodeId? , definition? }) => Promise<{ count, sample, sample_truncated } ∥ null>`                                                                                 | POST `/preview`                                 |
| previewExisting                       | `(id) => Promise<same as previewCollection>`                                                                                                                             | POST `/:id/preview`                             |
| getMergeSuggestions                   | `() => Promise<{ suggestions: [] }>`                                                                                                                                     | GET `/merge-suggestions`                        |
| mergeCollections                      | `(id, otherId) => Promise<{ survivor, absorbed_id, undo } ∥ null>`                                                                                                       | POST `/:id/merge/:other`                        |
| dismissMerge / rejectMerge            | `(id, otherId) => Promise<payload ∥ null>`                                                                                                                               | POST `/:id/merge-dismiss` / `/:id/merge-reject` |
| getGrants                             | `(id) => Promise<{ grants: [] }>`                                                                                                                                        | GET `/:id/grants`                               |
| grantCollection                       | `(id, { userId, role }) => Promise<payload ∥ null>`                                                                                                                      | POST `/:id/grants`                              |
| revokeGrant                           | `(id, userId) => Promise<payload ∥ null>`                                                                                                                                | DELETE `/:id/grants?userId=`                    |
| runSearch                             | `({ query, resultRef? }) => Promise<search response ∥ null>` — `null` only on transport/5xx; `semantic_available:false` is a success payload                             | POST `/api/search`                              |
| getActions                            | `({ domain? }) => Promise<{ actions: [] }>`                                                                                                                              | GET `/api/actions`                              |
| undoAction                            | `(actionId, { confirmCascade? }) => Promise<structured result — see §2.5>`                                                                                               | POST `/api/actions/:id/undo`                    |
| getFileSuggestions                    | `() => Promise<{ suggestions: [] }>` — **Decision:** T3.3 server contract; seam stable now                                                                               | GET (T3.3)                                      |
| acceptFileSuggestions                 | `(nodeIds, options?) => Promise<payload ∥ null>` (checked rows → trash, command-unit undo)                                                                               | POST (T3.3)                                     |
| dismissFileSuggestion                 | `(suggestionId) => Promise<payload ∥ null>`                                                                                                                              | POST (T3.3)                                     |

`options` (mutations): `{ silent?: boolean }` — suppresses the notifier fan-out (parity with `recentFilesRepository`).

### 2.4 Failure-Absorption + Notify Contract

- No method rejects for ordinary API/storage failures; callers receive the contract-safe fallback in §2.3 and errors are logged for diagnostics.
- **Notifier fires after REAL success only:** a `null`/`false` result path must never call `collectionsNotifier.notifyCollectionsChange()` — including the best-effort fallback-read path (recentFilesRepository precedent). Success = server-acknowledged mutation (any 2xx from a write endpoint).
- Undo-pointer integrity: when a mutation returns `null`, callers must not surface an undo affordance (absorption prevents toasts that lie about journaling).

### 2.5 undoAction — Structured-Result Exception

- **Decision:** unlike the `∥ null` mutation precedent, `undoAction` never collapses 409s into `null`; it returns `{ ok: boolean, status?, undoneAt?, cascadeUndone?, itemsUndone?, itemsSkipped?, errorCode?, params? }` (camel keys allowed here — internal result object, not wire payload). 409 `actions.cascadeConfirmRequired` carries `params.laterChanges`, which the undo-toast controller needs to build the cascade-confirm dialog without a second round trip.

### 2.6 Dependencies

- Transport: `client/src/services/apiClient` (get, post, put, del).
- Notification: `client/src/services/collectionsNotifier` (`notifyCollectionsChange`).

### 2.7 Verification Scenarios

- [ ] `getCollections()` returns `{ collections: [...] }`; transport failure returns `{ collections: [] }` without throwing.
- [ ] Mutation success returns snake_case payload untouched (`undo.action_id` readable); failure returns `null` and does NOT notify subscribers.
- [ ] `addCollectionItems` success notifies unless `{ silent: true }`.
- [ ] `deleteCollection` returns `true`/`false` and its success result contains no undo pointer.
- [ ] `runSearch` with `semantic_available: false` resolves as success (not `null`); only network/5xx yields `null`.
- [ ] `undoAction` on 409 `cascadeConfirmRequired` returns `ok:false` with `errorCode` + `params.laterChanges`.
- [ ] Request bodies are camelCase (`{ nodeIds }`, `{ seedNodeId }`), response fields are consumed as snake_case.

### 2.8 Notes

- Seed/`search`-origin creation extras (`definition`, `origin`, `resultRef`) are additive request fields pending the T1.5/T1.6 route-doc update in `docs/spec/server/routes/collections.md`; until wired, `createCollection({ name })` covers P0.
- Permanent-delete tombstone semantics and 404 masquerades are server contracts (route specs); the repository treats 404 exactly like any other absorbed failure.
