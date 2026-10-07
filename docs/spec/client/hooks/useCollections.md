# useCollections Spec

Target-contract spec.

## 1. Overview

| Item                     | Description                                                                                                                                                                                                                                                   |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Role                     | Collections-list controller for the FileManager overlay: owns list state (`sort`/`include`), collection CRUD (rename/pin/archive/restore/permanent-delete), and merge-suggestion data. Prepares view models for `CollectionsListView` / `CollectionsSection`. |
| Used by components/pages | `FileManager` page shell (virtual-collection overlay), `CollectionsListView`, `MergeProposalCard` host wiring                                                                                                                                                 |
| Does not own             | Member-row listing (explorer listing seam + `MemberRowControls` contracts), tree row refresh (`useFolderTreeController` subscribes independently), toast/undo orchestration (`useUndoToast`), IO (`explorerGateway`)                                          |

---

## 2. Implementation Spec

### 2.1 File Path

- **Scope:** Page-local — **Source:** `client/src/pages/FileManager/hooks/useCollections.js`
- **Test file:** `client/src/pages/FileManager/hooks/__tests__/useCollections.test.js`
- **Spec placement:** `docs/spec/client/hooks/` even though the source is page-local.

### 2.2 Input Parameters

| Name       | Type     | Required | Description                                                                                                                                                                |
| ---------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| showError  | function | Y        | User-visible error feedback (from `useMessage`).                                                                                                                           |
| gateway    | object   | N        | Collections seams from `explorerGateway` §2.6 (default: the real gateway; mock seam for tests)                                                                             |
| onUndoable | function | N        | `(payload, textKey, params) => void` — forwards mutation `undo.action_id` to the undo-toast controller                                                                     |
| include    | string   | N        | `'mine,shared'` (default) \| `'mine,archived'` — driven by the active virtual route (shell passes it; the hook never derives it itself). An input prop, re-read on change. |

### 2.3 Return Value / State

| Key                                                        | Type                                                  | Meaning                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| collections                                                | Array<Collection>                                     | snake_case rows as returned (order = server order for the active `sort`)                                                                                                                                                                                                                     |
| loading                                                    | boolean                                               | Initial/refresh load state                                                                                                                                                                                                                                                                   |
| sort / setSort                                             | `'activity'\|'name'\|'created'\|'updated'\|'similar'` | List sort option; `setSort` re-fetches; ephemeral (no persistence; default `activity`)                                                                                                                                                                                                       |
| include                                                    | `'mine,shared'` \| `'mine,archived'`                  | Derived from the active virtual route (`__collections__` vs its `__archive__` child) — never user-set                                                                                                                                                                                        |
| refresh                                                    | `() => Promise<void>`                                 | Re-read the list (also runs on notifier events)                                                                                                                                                                                                                                              |
| renameCollection / setPinned / setPublishMode              | `(id, value) => Promise<payload ∥ null>`              | CRUD wrappers; success → refresh + `onUndoable`; absorbed failure → `showError`, no undo affordance                                                                                                                                                                                          |
| archiveCollection / restoreCollection                      | `(id) => Promise<payload ∥ null>`                     | Archive/restore flow: archive goes through ONE confirm dialog (a user-triggered change gets exactly one confirmation; the confirm is hosted by `CollectionsListView` §2.4 — the shell only calls this mutation after the view's final confirm); restore re-suffixes on collision server-side |
| deleteCollectionPermanent                                  | `(id) => Promise<boolean>`                            | Archived-only 2-step permanent delete (trash-parity); **no undo**; report-only success message                                                                                                                                                                                               |
| revokeOwnGrant                                             | `(id) => Promise<payload ∥ null>`                     | Grantee self-revocation (`DELETE /:id/grants/me`): instant, no confirm, **no undo toast** (re-grant is the owner's act); success → refresh (the shared-with-me row disappears from fetch state); absorbed failure → `showError` envelope (sibling card-action parity)                        |
| suggestions                                                | Array<MergeSuggestion>                                | `GET /merge-suggestions` rows, `score` desc; empty ⇒ cards render nothing                                                                                                                                                                                                                    |
| mergePair / dismissMergeSuggestion / rejectMergeSuggestion | `(id, otherId) => Promise<payload ∥ null>`            | Merge execution is immediate (the card IS the confirmation); success → refresh + undo toast via `onUndoable`                                                                                                                                                                                 |

### 2.4 Responsibilities (non-overlapping)

- **Owns:** list/sort/include state, CRUD call sequencing, merge-suggestion fetching, refresh-on-notify.
- **Does not own:** member item listing (`getCollectionItems` via `useFileManager`'s collection branch), card-menu product policy (view dispatches callbacks here), digest cursor math (`CollectionsListView` §2.5), pin semantics beyond the `pinned:true|false` write (auto-pin is server-side).

### 2.5 Dependencies

- **May use:** pure helpers only; `useMessage` outputs passed in as params.
- **Must route IO through:** `explorerGateway` §2.6 seams (`loadCollections`, CRUD, merge group, `subscribeToCollections`).
- **Must not use:** `collectionsRepository`/`collectionsNotifier` imports, `fetch`, browser storage.

### 2.6 Side Effects

- Initial load + subscription to `subscribeToCollections` (unsubscribe on unmount); every notification re-reads the list.
- `include` change (virtual-route switch) re-reads. No optimistic mutation of list rows (server is source of truth; absorbed failures make optimistic state wrong).

### 2.7 Error Handling

- Repository absorption means the hook branches on `null`/`false`: show `getServerErrorDisplay`-mapped error (409 `collections.notArchived` etc.), never an undo toast.
- 404 masquerade on list reads is indistinguishable from empty — renders empty list, no error.

### 2.8 Verification Scenarios

- [ ] Mount loads `mine,shared` default (`sort=activity`); archive route loads `mine,archived`.
- [ ] `setSort('similar')` re-fetches and rows carry `cluster_index` (passed through untouched for group headers).
- [ ] Successful archive → refresh + `onUndoable(payload…)`; absorbed failure → `showError` and no `onUndoable` call.
- [ ] `deleteCollectionPermanent` never yields an undo affordance (permanent delete-from-archive is unrecoverable — trash-parity).
- [ ] Notifier event refreshes the list; unsubscribe happens on unmount.
- [ ] Empty suggestions array is returned (not `null`) on read failure — merge slot renders zero footprint.

### 2.9 Edge Cases

- Concurrent mutations from other tabs: last notify-refresh wins; no client merge logic.
- Rename collision: server suffixes silently — the refreshed row shows the final name; no client error.
- Operator rule (admin is a pure operator): never invoked for admin — the shell mounts the hook per the rules of hooks but wires it to the inert gateway seam (share-link precedent), so no `/api/collections` read/mutation fires in an admin session.
