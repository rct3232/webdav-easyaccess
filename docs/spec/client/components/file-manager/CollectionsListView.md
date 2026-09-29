# CollectionsListView Spec

Target-contract spec.

## 1. Overview

| Item               | Description                                                                                                                                                                                                                                                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Role               | The `__collections__` surface: **list mode** (collection cards with similar-cluster headers, merge-card slot — the sort control lives in the shared toolbar, P-2) and **member mode** (an opened collection's stored ∪ derived − exclusions listing with digest + publish-pending banners). Explorer rows reused for members; collection cards for the list. |
| Used in            | FileManager page shell (virtual-collection overlay, alongside the `__recent__`/`__shared__`/`__trash__` precedents)                                                                                                                                                                                                                                          |
| Related components | MergeProposalCard, MemberRowControls, CollectionsSection (tree), FileList/FileGrid (member row rendering), CollectionPropertiesDialog, ConfirmDialog                                                                                                                                                                                                         |

---

## 2. Implementation Spec

### 2.1 File Path

- **Source:** `client/src/components/file-manager/CollectionsListView.js`
- **Test file:** `client/src/components/file-manager/__tests__/CollectionsListView.test.js`

### 2.2 Routes & Modes

- `/files/__collections__` — list mode (`include=mine,shared`).
- `/files/__collections__/collection/:id` — member mode (`GET /:id/items` cursor paging, activity-score order server-side).
- `/files/__collections__/__archive__` — list mode, `include=mine,archived`, permanent-delete affordances enabled (§3.2).
- **Decision:** route shapes extend the trash virtual-node pattern (`/files/__trash__/node/:id`).

### 2.3 Props (prepared by `useCollections` + listing seam — pure view)

| Name                            | Type        | Required | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ----------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| mode                            | string      | Y        | `'list' \| 'members'`                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| collections                     | array       | list     | snake_case rows for the active `sort`                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| sort                            | string      | list     | Render input only: the active server sort (`activity \| name \| created \| updated \| similar`); `'similar'` drives the cluster GROUP HEADERS (§2.4/§3.1). **Retired (P-2, 2026-09-29 owner ruling):** the private sort menu + `onSortChange` dispatch prop are removed — the toolbar's context-aware sort button (`FileManagerControls.md` §2.6, collections surface) owns the 5-option menu; sort stays EPHEMERAL (`useCollections.md` §2.3 decision — no localStorage). |
| mergeSlot                       | ReactNode   | list     | Host injects `MergeProposalCard`; **zero pending ⇒ zero layout footprint** (no placeholder, no padding)                                                                                                                                                                                                                                                                                                                                                                    |
| items / nextCursor / onLoadMore | array/fn/fn | members  | Member rows + cursor paging (`onLoadMore` fetches `nextCursor` — as-built prop name)                                                                                                                                                                                                                                                                                                                                                                                       |
| include                         | string?     | list     | `'mine,archived'` selects the `archiveEmpty` copy for the empty state (route-driven, view never derives)                                                                                                                                                                                                                                                                                                                                                                   |
| digest                          | object?     | members  | `{ added_since, removed_since }` + expanded reasons (see §2.5)                                                                                                                                                                                                                                                                                                                                                                                                             |
| publishPendingCount             | number?     | members  | Owner-only (`publish_pending_count`); grantee rows never carry it                                                                                                                                                                                                                                                                                                                                                                                                          |
| onCardAction                    | fn          | list     | `(action, collection) => void` — card context-menu dispatch (see §2.4)                                                                                                                                                                                                                                                                                                                                                                                                     |
| onMemberAction                  | fn          | members  | `(action, memberRow, anchorEl?) => void` — see `MemberRowControls.md`. **As-built (wave-2):** `'menu'` dispatches carry the row's `More` button element as the third argument so the hosting shell can anchor its single `MemberRowControls` instance (`§2.5` idiom).                                                                                                                                                                                                      |
| onPublishBatch                  | fn          | members  | Publish-pending banner batch action                                                                                                                                                                                                                                                                                                                                                                                                                                        |

### 2.4 List Mode

- Card: name, `item_count`, origin/status chips, shared icon chip (`granted_role != null`), auto-pin chip when `pinned_by='auto'` (subtle, with unpin CTA — §4.9b).
- **Sort `similar`:** server pre-groups rows (`cluster_index: 0|1|…`); view renders cluster GROUP HEADERS (unlabeled visual groups), not one path order (§3.1). Other sorts render a flat list. The `sort` value arrives as a render input only — the list view renders NO sort control (retired P-2; the toolbar's collections surface owns the menu, `FileManagerControls.md` §2.6).
- **Card context menu by origin (§3.2):** own (`user|system` rows): Open / Rename (→ server sets `name_locked`) / pin·unpin / archive (ONE confirm) / Sharing (opens CollectionPropertiesDialog Sharing tab) / Delete (visible ONLY in `__archive__`, second-step confirm, trash-parity, report-only toast). Viewer-received rows (`granted_role != null`): Open, `Revoke permission` (action `revoke-permission` — dispatched to the host, which runs `DELETE /:id/grants/me`; INSTANT, no confirm dialog — Path 1 self-grant revocation, 2026-09-29 owner ruling), NO mutations. **As-amended (P-1):** the former view-local `hiddenIds` recipient-hide is REMOVED — rows render straight from fetch state, the revoked row disappears on the next list read.
- **As-built decision (T0.4):** archived rows (`status=archived`, `__archive__` view) render **Restore in place of Archive** (own rows there: Open / Rename / pin·unpin / Restore / Sharing / Delete) — §2.2 "restore/permanent-delete affordances enabled" and `useFolderTreeController.md` §3 ("restore … affordances live in CollectionsListView") require the restore entry, which the menu list above omitted.

### 2.5 Member Mode — top-of-list banners (same digest surface, §4.7/§4.8)

- **Digest banner:** one line `+N / -M / 1 merge · expand` from `GET /:id/items?since=`; `since` = per-collection last-visit timestamp held client-side (localStorage; **Decision:** the server stamps its own cursor implicitly — the client copy exists only to request `digest` deltas on first paint after navigation). Expanded = per-entry rows with `why is this here` answers = item `reason` (matched predicate name, query-time, not a history table) + undo links for system-act entries (≤24h, §4.11 surface 2).
- **Publish-pending banner:** owner sees `N awaiting publish` (`publish_pending_count`) with batch/individual publish; only when the collection is live-shared and `publish_mode != auto`. Hidden for grantees (field absent server-side).
- **As-built (T0.4):** member rows render through the view's own lightweight member-row renderer (MUI row primitives + `getFileIcon`/`formatFileSize`/`formatDate`) — the FileList row components cannot carry the revoked placeholder/`shared_excluded` chip/inline menu trigger; the row menu trigger dispatches `onMemberAction('menu', row)` and the hosting shell owns the menu instance (T0.5 `MemberRowControls` integration — same single-instance idiom as `FileContextMenu`). Expanded digest renders `digest.entries` when the server exposes them; the shipped `GET /:id/items` digest is counts-only (`routes/collections.md` §GET /:id/items) — per-entry `why is this here` rows + undo links ride that follow-up (surface otherwise inert).
- Member rows carry icon/name/size/date from enrichment (search.md Decision reuse) and `MemberRowControls`-dispatched menus; row states: `state:'revoked'` ⇒ gray placeholder WITHOUT filename/thumbnail; `shared_excluded:true` ⇒ `Not owner's file — not shared` chip (owner view only); trashed-by-owner ⇒ absent (server hides).
- Initial `seed`/`search` members are already `published:true` (Q2) — never park in the banner retroactively.

### 2.6 Dependencies

- **imports:** MUI list/card primitives, `useTranslation`, format helpers, row components — NO services/gateways (props only).

### 2.7 i18n Keys

- ~~`fileManager.collectionsSort*`~~ — consumed by the toolbar's collections sort surface since P-2 (`FileManagerControls.md` §2.5); the view itself uses none of these keys. `fileManager.collectionsEmpty`, `fileManager.archiveEmpty`, `fileManager.digestLine`, `fileManager.digestExpand`/`digestCollapse`/`digestAdded`/`digestRemoved`, `fileManager.whyHere`, `fileManager.publishPending`, `fileManager.publishBatch`, `fileManager.sharedExcludedChip`, `fileManager.cardMenu*` (open/rename/pin/unpin/archive/restore/sharing/delete/revoke-permission), `fileManager.collectionsItemCount`, `fileManager.collectionsStatusArchived`, `fileManager.collectionsAutoPin`/`collectionsAutoPinUnpin`, `fileManager.collectionsUnavailable`, `fileManager.memberLoadMore`, `fileManager.archiveConfirmMessage`, `fileManager.permanentDeleteConfirm1`/`permanentDeleteConfirm2` (archive/permanent-delete confirms are hosted IN this view — dispatch fires only after the final confirm; the shell hosts the mutation itself)

### 2.8 Verification Scenarios

- [ ] View renders no sort control (private menu retired, P-2 — menu dispatch is covered in `FileManagerControls.md` §2.7); `sort='similar'` renders cluster headers per `cluster_index` runs, other sorts a flat list.
- [ ] Empty suggestions ⇒ no merge-card DOM node (zero footprint).
- [ ] Banner order: merge card (list) / digest + publish-pending (members); both co-render in member mode.
- [ ] Archive-mode cards expose Delete; live cards do NOT (2-step lifecycle enforced in UI).
- [ ] Viewer-received card menu has no mutation entries (Open + `Revoke permission` only; `revoke-permission` dispatches instantly, no confirm, no view-local hide — the card vanishes only when the next fetch omits it).
- [ ] Revoked member renders no name/thumbnail; grantee never sees `shared_excluded` chip or pending banner.
- [ ] `auto` publish_mode collection shows no pending banner even after adds.

### 2.9 Edge Cases

- Cursor list while definition re-evaluates between pages: de-dup by `node_id` client-side; no re-order of rendered pages (stability over freshness).
- Name collision rename: server suffixes; refresh shows final name.
